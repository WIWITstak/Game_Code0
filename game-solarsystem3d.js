// Three.js solar-system scene. No React/DOM-framework coupling beyond the
// <canvas> element handed to init() — game.js owns all state (systemT,
// systemSpeed, systemSel, sysFleetsHidden, ...) and calls render(state)
// every tick from its existing 40ms animation loop. Selection clicks are
// reported back through a callback so React state stays the source of truth
// (the info side-panel is still plain HTML, fed the same way it always was).
//
// Requires THREE + OrbitControls + the bloom postprocessing chain
// (EffectComposer/RenderPass/ShaderPass/MaskPass/UnrealBloomPass, vendored
// locally — see index.html's <head>) and Orbits (game-orbits.js) for the
// shared orbital-position math.
//
// Extra look-and-feel on top of "just place textured spheres": ACES tone
// mapping + UnrealBloomPass so the sun and highlights actually glow, a fully
// procedural sun — churning fbm-plasma surface shader (no texture) with a
// noise-displaced silhouette, a BackSide sphere-shell corona whose streamer
// field is anchored in 3D (real parallax when you orbit), and a PointLight,
// all animated together — a 3D starfield (so the sky rotates correctly with
// the free camera, unlike a flat CSS backdrop), real per-planet axial tilt,
// Earth's own day/night shader with a drifting cloud layer, a slow
// atmospheric-flow texture scroll on gas/ice giants, and idle auto-rotate for
// a showcase feel.
// (A Fresnel rim-glow atmosphere shell was tried on both the planets and the
// sun and removed both times — it either looked like a solid shell or added
// nothing the corona/bloom didn't already give. Don't re-add without a ref.)
'use strict';

const SolarSystem3D = (function () {
  let renderer, scene, camera, controls, raycaster, canvasEl, onSelectCb;
  let mounted = false;   // is the (persistent) canvas currently parented into the visible overlay?
  let holder = null;     // off-DOM parking spot for the canvas while the overlay is closed
  let _forceRender = false;  // warm-up renders draw once even while unmounted (uploads textures)
  let composer, bloomPass, gradePass;
  let sunMesh, sunCorona, sunLight, ambient, dirLight, ringSel, starfield;
  let debugPanel = null, _onDebugKey = null;
  let _sunBaseIntensity = 4.6;  // render() adds a pulse on top; the debug panel drives this
  let bodyMeshes = {};   // id -> THREE.Mesh (planets, belt/Kuiper dwarfs, moons)
  let fleetSprites = {}; // id -> THREE.Mesh (small triangle cones)
  let beltPoints, kuiperPoints;
  let earthMat = null;         // day/night ShaderMaterial, needs a per-frame sun-direction update
  let earthClouds = null;      // spins a touch faster than the surface each frame
  let earthAtmo = null;        // additive Rayleigh/Mie scattering shell (child of the Earth mesh)
  let gasGiantMeshes = [];     // meshes whose map slowly scrolls for an atmospheric-flow feel
  let rimShaders = [];         // per-body onBeforeCompile shaders — uSunView updated each frame
  let bumpedMats = [];         // body materials with an elevation bumpMap — bumpScale is a debug knob
  const _sunView = new THREE.Vector3(); // sun position in view space (per-frame scratch)
  let textureLoader;
  let ready = false;
  let lastW = 0, lastH = 0;

  // oklch() -> linear-light OKLab -> linear sRGB -> gamma-encoded sRGB.
  // Reference algorithm: https://bottosson.github.io/posts/oklab/ — every
  // colour in this project is oklch(), and Three r128 has no built-in parser
  // for it (an earlier version of this relied on the browser's Canvas2D
  // colour parser accepting oklch() and silently fell back to flat grey on
  // browsers/contexts where it doesn't — this version needs no browser support).
  function oklchToRgb(str) {
    const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/.exec(str);
    if (!m) return { r: 0.5, g: 0.5, b: 0.5 };
    const L = parseFloat(m[1]) / 100, C = parseFloat(m[2]), hRad = parseFloat(m[3]) * Math.PI / 180;
    const a = C * Math.cos(hRad), b = C * Math.sin(hRad);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, mm = m_ * m_ * m_, s = s_ * s_ * s_;
    const rl = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s;
    const gl = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s;
    const enc = (c) => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    return { r: enc(rl), g: enc(gl), b: enc(bl) };
  }
  function cssColor(str) {
    const c = oklchToRgb(str);
    return new THREE.Color(c.r, c.g, c.b);
  }

  function loadColorTex(file) {
    const t = textureLoader.load(TEX_BASE + file);
    t.encoding = THREE.sRGBEncoding;
    // Default wrap is ClampToEdge, which is fine for a static texture but
    // tears into a hard seam the moment anything animates .offset.x (gas
    // giants below) — repeat wrapping keeps the scroll seamless.
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // Non-colour data maps (normal / specular / height): must stay LINEAR — no
  // sRGB decode — or the encoded vectors / masks come out wrong. The ?v tag
  // busts the browser image cache when a map's *content* is swapped in place
  // (these files have no version in their name); bump it when regenerating.
  const DATA_TEX_V = '?v=2';
  function loadLinearTex(file) {
    const t = textureLoader.load(TEX_BASE + file + DATA_TEX_V);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  // Warm limb-light: where a body's surface faces the camera at a grazing
  // angle AND still catches the sun, add a thin bright rim. It's what sells
  // "lit by a star" instead of "flat CG sphere" — the sunlit edge glows and
  // (being injected before tone-mapping) blooms a touch. uSunView = the sun's
  // position in view space, refreshed each frame in render() for every body.
  function addSunRim(mat) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uSunView = { value: new THREE.Vector3(0, 0, 0) };
      shader.uniforms.uRimStrength = { value: lighting.rimStrength };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRimN;\nvarying vec3 vRimP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRimN = normalize(normalMatrix * objectNormal);\n  vRimP = (modelViewMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform float uRimStrength;\nvarying vec3 vRimN;\nvarying vec3 vRimP;')
        .replace('#include <tonemapping_fragment>',
          '  {\n' +
          '    vec3 Nv = normalize(vRimN);\n' +
          '    vec3 Vv = normalize(-vRimP);\n' +
          '    vec3 Lv = normalize(uSunView - vRimP);\n' +
          '    float fres = pow(1.0 - clamp(dot(Nv, Vv), 0.0, 1.0), 3.0);\n' +
          '    float lit = smoothstep(-0.35, 0.25, dot(Nv, Lv));\n' +
          '    gl_FragColor.rgb += vec3(1.0, 0.83, 0.60) * fres * lit * uRimStrength;\n' +
          '  }\n' +
          '#include <tonemapping_fragment>');
      rimShaders.push(shader);
    };
  }

  function makeBodyMesh(radius, texFile, fallbackColor, roughness, bumpFile) {
    const geo = new THREE.SphereGeometry(radius, 32, 24);
    let mat;
    if (texFile) {
      mat = new THREE.MeshStandardMaterial({ map: loadColorTex(texFile), roughness: roughness != null ? roughness : 0.85, metalness: 0 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: cssColor(fallbackColor), roughness: roughness != null ? roughness : 0.9, metalness: 0 });
    }
    if (bumpFile) {
      // Real elevation now (LOLA / MOLA / MESSENGER, greyscale height) — used as
      // a screen-space-derivative bump (no tangent attribute needed). Strength
      // is the debug-panel "Relief · bodies" knob.
      mat.bumpMap = loadLinearTex(bumpFile);
      mat.bumpScale = lighting.bodyRelief;
      bumpedMats.push(mat);
    }
    addSunRim(mat);
    return new THREE.Mesh(geo, mat);
  }

  function buildOrbitLine(p) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const E = (i / 96) * Math.PI * 2;
      const o = Orbits.orbitXYZ(true, p, E);
      pts.push(new THREE.Vector3(o.px, o.py, o.pz));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: cssColor(p.color), transparent: true, opacity: 0.28 });
    return new THREE.Line(geo, mat);
  }

  // Built in the planet's *local* space (0,0,0) so it can ride along as a
  // child of the planet mesh — inherits position and axial-tilt rotation for
  // free, no per-frame syncing needed.
  function buildRing(planetRadius, tint) {
    const geo = new THREE.RingGeometry(planetRadius * 1.4, planetRadius * 2.6, 64);
    // RingGeometry UVs aren't radial by default -> remap so the alpha ramp
    // (transparent centre -> opaque bands -> fades out) reads correctly.
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r = (v.length() - planetRadius * 1.4) / (planetRadius * 1.2);
      uv.setXY(i, r, 1);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: textureLoader.load(TEX_BASE + '2k_saturn_ring_alpha.png'),
      color: cssColor(tint), transparent: true, side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2 - 0.35;
    return mesh;
  }

  // Procedural asteroid / Kuiper belt: a proper ring of thousands of chunks
  // with a centre-weighted radial spread, a couple of Kirkwood-style density
  // gaps, radius-scaled vertical thickness, per-particle size (mostly fine
  // dust, a few big rubble chunks) and a slow twinkle. `uUnlocked` eases in a
  // teal tint once the colony can actually mine the belt (P4.2), so the map
  // signals "this is yours now". Rotated as a group each frame in render().
  function buildAsteroidBelt(opts) {
    const N = opts.count;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const aSize = new Float32Array(N);
    const aSeed = new Float32Array(N);
    const c = new THREE.Color();
    // deterministic LCG so the belt is identical across reloads
    let s = (opts.seed || 20260906) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const band = opts.rOuter - opts.rInner;
    let written = 0, guard = 0;
    while (written < N && guard++ < N * 6) {
      // centre-weighted radius (sum of 3 uniforms ≈ triangular)
      const u = (rnd() + rnd() + rnd()) / 3;
      const rad = opts.rInner + u * band;
      const g = Math.sin(((rad - opts.rInner) / band) * Math.PI * (opts.gaps || 4));
      if (g > 0.86 && rnd() > 0.28) continue;            // thin out the gaps
      const ang = rnd() * Math.PI * 2;
      // vertical thickness grows a touch outward; power keeps most near the plane
      const t = rnd() * 2 - 1;
      const th = opts.thickness * (0.55 + 0.9 * (rad / opts.rOuter));
      pos[written * 3]     = Math.cos(ang) * rad;
      pos[written * 3 + 1] = Math.sign(t) * Math.pow(Math.abs(t), 2.0) * th;
      pos[written * 3 + 2] = Math.sin(ang) * rad;
      const L = opts.lBase + rnd() * opts.lSpread;
      const hue = opts.hue + (rnd() - 0.5) * (opts.hueSpread || 30);
      c.copy(cssColor('oklch(' + (L * 100).toFixed(1) + '% ' + opts.chroma + ' ' + hue.toFixed(1) + ')'));
      col[written * 3] = c.r; col[written * 3 + 1] = c.g; col[written * 3 + 2] = c.b;
      aSize[written] = opts.baseSize * (0.45 + Math.pow(rnd(), 3.2) * 4.2);  // rare big chunks
      aSeed[written] = rnd();
      written++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));

    const mat = new THREE.ShaderMaterial({
      // cssColor() already returns display-ready sRGB, and the raw shader below
      // writes straight to the framebuffer — no tone-mapping / encoding pass.
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uUnlocked: { value: 0 },
        uScale: { value: 330 * (Math.min(window.devicePixelRatio || 1, 1.5)) },
        uOpacity: { value: opts.opacity != null ? opts.opacity : 0.9 }
      },
      vertexShader:
        'attribute vec3 aColor;\n' +
        'attribute float aSize;\n' +
        'attribute float aSeed;\n' +
        'uniform float uTime;\n' +
        'uniform float uScale;\n' +
        'varying vec3 vColor;\n' +
        'varying float vTw;\n' +
        'void main() {\n' +
        '  vColor = aColor;\n' +
        '  float tw = 0.7 + 0.3 * sin(uTime * 0.7 + aSeed * 43.0);\n' +
        '  vTw = tw;\n' +
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n' +
        '  gl_PointSize = aSize * tw * (uScale / max(1.0, -mv.z));\n' +
        '  gl_Position = projectionMatrix * mv;\n' +
        '}',
      fragmentShader:
        'uniform float uUnlocked;\n' +
        'uniform float uOpacity;\n' +
        'varying vec3 vColor;\n' +
        'varying float vTw;\n' +
        'void main() {\n' +
        '  vec2 d = gl_PointCoord - 0.5;\n' +
        '  float r = length(d);\n' +
        '  float a = 1.0 - smoothstep(0.08, 0.5, r);\n' +          // soft round sprite
        '  float core = (1.0 - smoothstep(0.02, 0.34, r)) * 0.5;\n' + // brighter centre
        '  vec3 base = vColor * (0.85 + 0.4 * vTw) + core;\n' +
        '  vec3 tint = base * vec3(0.72, 1.12, 1.22) + vec3(0.0, 0.05, 0.06);\n' +
        '  vec3 col = mix(base, tint, uUnlocked * 0.7);\n' +
        '  gl_FragColor = vec4(col, a * uOpacity * (0.85 + 0.15 * uUnlocked));\n' +
        '}'
    });
    return new THREE.Points(geo, mat);
  }

  function buildStarfield() {
    const tex = loadColorTex('2k_stars.jpg');
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const geo = new THREE.SphereGeometry(3500, 32, 24);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false });
    return new THREE.Mesh(geo, mat);
  }

  // Earth gets its own day/night shader instead of MeshStandardMaterial: the
  // day map shows on the sun-facing side, the (dimmed) night map with city
  // lights fades in on the dark side. sunDirection + uCamLocal are in the
  // mesh's *local* space (see render()) so the terminator sweeps correctly as
  // it spins. Real SSS data maps on top: a tangent-space normal map perturbs
  // the surface normal (relief catches the terminator), and a specular/ocean
  // mask drives a Blinn-Phong sun-glint that only lights water on the day side.
  function buildEarthMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: loadColorTex('2k_earth_daymap.jpg') },
        nightMap: { value: loadColorTex('2k_earth_nightmap.jpg') },
        normalMap: { value: loadLinearTex('2k_earth_normal_map.png') },   // GEBCO elevation+bathymetry -> Sobel normal
        specMap: { value: loadLinearTex('2k_earth_specular_map.jpg') },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 40) },
        uNormalScale: { value: lighting.earthRelief },
        uHaze: { value: lighting.earthHaze }
      },
      vertexShader:
        'varying vec3 vNormal;\n' +
        'varying vec3 vLocalPos;\n' +
        'varying vec2 vUv;\n' +
        'void main() {\n' +
        '  vNormal = normalize(normal);\n' +
        '  vLocalPos = position;\n' +
        '  vUv = uv;\n' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
        '}',
      fragmentShader:
        'uniform sampler2D dayMap;\n' +
        'uniform sampler2D nightMap;\n' +
        'uniform sampler2D normalMap;\n' +
        'uniform sampler2D specMap;\n' +
        'uniform vec3 sunDirection;\n' +
        'uniform vec3 uCamLocal;\n' +
        'uniform float uNormalScale;\n' +
        'uniform float uHaze;\n' +
        'varying vec3 vNormal;\n' +
        'varying vec3 vLocalPos;\n' +
        'varying vec2 vUv;\n' +
        'void main() {\n' +
        '  vec3 N = normalize(vNormal);\n' +
        // Tangent frame for an equirect UV sphere: T east, B north. Degenerate
        // only exactly at the poles (ice, no detail there).
        '  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));\n' +
        '  vec3 B = cross(N, T);\n' +
        '  vec3 nTex = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;\n' +
        '  vec3 Np = normalize(T * (nTex.x * uNormalScale) + B * (nTex.y * uNormalScale) + N * nTex.z);\n' +
        '  vec3 L = normalize(sunDirection);\n' +
        '  float baseLit = dot(N, L);\n' +
        // map blend follows the *geometric* terminator so the normal map never
        // makes the day/night texture crossfade shimmer
        '  float mixFactor = smoothstep(-0.2, 0.25, baseLit);\n' +
        '  vec3 dayColor = texture2D(dayMap, vUv).rgb;\n' +
        '  vec3 nightColor = texture2D(nightMap, vUv).rgb * 1.4;\n' +
        '  vec3 color = mix(nightColor * 0.4, dayColor, mixFactor);\n' +
        // relief: the perturbed normal only *modulates* the day-side light
        // around its unperturbed value — hills catch light, valleys shade
        '  float relief = dot(Np, L) - baseLit;\n' +
        '  color *= mix(1.0, clamp(1.0 + relief * 1.8, 0.55, 1.5), mixFactor);\n' +
        // ocean sun-glint — Blinn-Phong, masked to water, day side only
        '  float ocean = texture2D(specMap, vUv).r;\n' +
        '  vec3 V = normalize(uCamLocal - vLocalPos);\n' +
        '  vec3 H = normalize(L + V);\n' +
        '  float glint = pow(max(dot(Np, H), 0.0), 55.0) * ocean * smoothstep(0.0, 0.30, baseLit);\n' +
        '  color += vec3(1.0, 0.93, 0.78) * glint * 0.85;\n' +
        // aerial perspective: toward the limb the line of sight crosses a long
        // column of air, so the surface (relief included) washes into a pale
        // blue haze — day side only, strongest right at the edge of the disc
        '  float airMass = pow(1.0 - abs(dot(N, V)), 3.2);\n' +
        '  vec3 hazeCol = vec3(0.42, 0.56, 0.82) * (0.35 + 0.65 * mixFactor);\n' +
        '  color = mix(color, hazeCol, clamp(airMass * uHaze, 0.0, 0.92) * mixFactor);\n' +
        '  gl_FragColor = vec4(color, 1.0);\n' +
        '}'
    });
    return mat;
  }

  // White-on-transparent cloud shell, slightly larger than the surface and
  // spinning a touch faster — reads as weather drifting over the terrain.
  function buildClouds(radius) {
    const tex = loadColorTex('2k_earth_clouds.jpg');
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, depthWrite: false });
    return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.015, 28, 20), mat);
  }

  // Earth's atmosphere — real single-scattering (Rayleigh + Mie), ported from
  // GLtracy's shadertoy model (lslXDr). An additive BackSide shell just outside
  // the clouds; the depth buffer (Earth drawn first) plus an early `hitP`
  // discard mean the scattering integral only runs for the *limb ring*, where
  // the view ray misses the surface. Along that ray we march NIN samples; at
  // each we march NOUT samples toward the sun for the light optical depth, so
  // the blue you see is genuine wavelength-dependent extinction — pale near the
  // surface, saturating to blue then indigo outward, and near-black on the
  // night side. Rides the Earth mesh as a child; render() refreshes uSunDir /
  // uCamLocal each frame (mesh-local space, same as the surface shader).
  function buildEarthAtmosphere(radius) {
    const RP = radius, RA = radius * 1.10;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 40) },
        uStrength: { value: lighting.earthAtmo },
        uRp: { value: RP },
        uRa: { value: RA }
      },
      vertexShader:
        'varying vec3 vP;\n' +
        'void main() {\n' +
        '  vP = position;\n' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
        '}',
      fragmentShader:
        'uniform vec3 uSunDir;\n' +
        'uniform vec3 uCamLocal;\n' +
        'uniform float uStrength;\n' +
        'uniform float uRp;\n' +
        'uniform float uRa;\n' +
        'varying vec3 vP;\n' +
        'const int NIN = 16;\n' +
        'const int NOUT = 5;\n' +
        'const vec3 K_RAY = vec3(3.8, 13.5, 33.1);\n' +
        'const vec3 K_MIE = vec3(21.0);\n' +
        // vec2(tNear, tFar); x > y means the ray misses
        'vec2 rsph(vec3 o, vec3 d, float r) {\n' +
        '  float b = dot(o, d);\n' +
        '  float h = b * b - dot(o, o) + r * r;\n' +
        '  if (h < 0.0) return vec2(1.0, -1.0);\n' +
        '  h = sqrt(h); return vec2(-b - h, -b + h);\n' +
        '}\n' +
        'float dens(vec3 p, float ph) { return exp(-max(length(p) - uRp, 0.0) / ph); }\n' +
        'float optic(vec3 p, vec3 q, float ph) {\n' +
        '  vec3 s = (q - p) / float(NOUT);\n' +
        '  vec3 v = p + s * 0.5;\n' +
        '  float sum = 0.0;\n' +
        '  for (int i = 0; i < NOUT; i++) { sum += dens(v, ph); v += s; }\n' +
        '  return sum * length(s);\n' +
        '}\n' +
        'void main() {\n' +
        '  vec3 ro = uCamLocal;\n' +
        '  vec3 rd = normalize(vP - ro);\n' +
        '  vec3 L = normalize(uSunDir);\n' +
        '  vec2 ea = rsph(ro, rd, uRa);\n' +
        '  if (ea.x > ea.y) discard;\n' +
        '  vec2 ep = rsph(ro, rd, uRp);\n' +
        '  if (ep.x < ep.y && ep.y > 0.0 && ep.x > 0.0) discard;\n' + // ray hits the planet -> surface (or its own atmosphere) wins there
        '  float near = max(ea.x, 0.0);\n' +
        '  float far = ea.y;\n' +
        '  if (far <= near) discard;\n' +
        '  float atm = uRa - uRp;\n' +
        '  float phR = atm * 0.10;\n' +
        '  float phM = atm * 0.028;\n' +
        '  float len = (far - near) / float(NIN);\n' +
        '  vec3 stp = rd * len;\n' +
        '  vec3 v = ro + rd * (near + len * 0.5);\n' +
        '  vec3 sumR = vec3(0.0);\n' +
        '  vec3 sumM = vec3(0.0);\n' +
        '  float nR = 0.0, nM = 0.0;\n' +
        '  for (int i = 0; i < NIN; i++) {\n' +
        '    float dR = dens(v, phR) * len;\n' +
        '    float dM = dens(v, phM) * len;\n' +
        '    nR += dR; nM += dM;\n' +
        '    vec2 f = rsph(v, L, uRa);\n' +
        '    vec3 u = v + L * f.y;\n' +
        '    vec3 att = exp(-((nR + optic(v, u, phR)) * K_RAY + (nM + optic(v, u, phM)) * K_MIE * 1.1));\n' +
        '    vec2 sp = rsph(v, L, uRp);\n' +                    // soft planet shadow on the light ray
        '    float pen = (sp.x < sp.y && sp.y > 0.0) ? max(min(sp.y, f.y) - max(sp.x, 0.0), 0.0) : 0.0;\n' +
        '    att *= exp(-pen / (atm * 0.8));\n' +
        '    sumR += dR * att;\n' +
        '    sumM += dM * att;\n' +
        '    v += stp;\n' +
        '  }\n' +
        '  float c = dot(rd, -L);\n' +
        '  float cc = c * c;\n' +
        '  float phaseR = 0.0596831 * (1.0 + cc);\n' +          // 3/(16*pi)
        '  float g = -0.80, gg = 0.64;\n' +
        '  float a = (1.0 - gg) * (1.0 + cc);\n' +
        '  float b = 1.0 + gg - 2.0 * g * c;\n' +
        '  b = b * sqrt(max(b, 1e-4)) * (2.0 + gg);\n' +
        '  float phaseM = 0.1193662 * a / b;\n' +               // 3/(8*pi)
        '  vec3 col = (sumR * K_RAY * phaseR + sumM * K_MIE * phaseM) * 24.0 * uStrength;\n' +
        '  col = vec3(1.0) - exp(-col * 1.1);\n' +              // graceful rolloff, keeps hue
        '  gl_FragColor = vec4(col, 1.0);\n' +
        '}'
    });
    return new THREE.Mesh(new THREE.SphereGeometry(RA, 56, 36), mat);
  }

  // Compact 3D value-noise for the sun surface shader — good enough for
  // churning plasma at the size the sun draws on screen, and far cheaper than
  // a real simplex-noise implementation. (The corona uses its own even
  // cheaper angular sine-harmonic noise; it doesn't need this.)
  //   fbm       — plain fractal noise, for the large hot/cool regions.
  //   ridgedFbm — 1-|2n-1| squared per octave: turns the smooth field into
  //               sharp bright veins, which is what gives the plasma its
  //               thread/filament look instead of soft cellular blobs.
  const GLSL_NOISE =
    'float hash(vec3 p) {\n' +
    '  p = fract(p * 0.3183099 + 0.1);\n' +
    '  p *= 17.0;\n' +
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));\n' +
    '}\n' +
    'float vnoise(vec3 x) {\n' +
    '  vec3 i = floor(x); vec3 f = fract(x);\n' +
    '  f = f * f * (3.0 - 2.0 * f);\n' +
    '  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),\n' +
    '                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),\n' +
    '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),\n' +
    '                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);\n' +
    '}\n' +
    'float fbm(vec3 p) {\n' +
    '  float v = 0.0, a = 0.5;\n' +
    '  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 11.1; a *= 0.5; }\n' +
    '  return v;\n' +
    '}\n' +
    'float ridgedFbm(vec3 p) {\n' +
    '  float v = 0.0, a = 0.5;\n' +
    '  for (int i = 0; i < 4; i++) {\n' +
    '    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);\n' +
    '    v += a * n * n;\n' +
    '    p = p * 2.07 + 7.3;\n' +
    '    a *= 0.5;\n' +
    '  }\n' +
    '  return v;\n' +
    '}\n';

  // Living sun surface: no texture at all. The vertex shader displaces each
  // vertex along its normal by an animated noise field (`uBump`) so the
  // silhouette bulges, and re-derives the normal so the bulges self-shade.
  // The fragment sums several noise scales (convection regions, granulation,
  // fine sparkle, ridged filament threads) plus a big low-freq field that
  // crushes the heat into dark maroon sunspot blotches, runs the result
  // through a red-dominant fire ramp (near-black floor -> deep red -> orange
  // -> gold -> white flare knots), then applies gentle limb darkening and a
  // warm emissive edge so the rim glows and blends into the corona.
  function buildSunMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBump: { value: 1.05 } },
      vertexShader:
        'uniform float uTime;\n' +
        'uniform float uBump;\n' +
        'varying vec3 vPos;\n' +
        'varying vec3 vNrm;\n' +
        'varying vec3 vView;\n' +
        GLSL_NOISE +
        // Radial displacement height: coarse fbm lumps drive the wobbly
        // silhouette, a finer ridged term adds prominence-like bulges.
        'float relief(vec3 dir) {\n' +
        '  float t = uTime * 0.05;\n' +
        '  float lump = fbm(dir * 3.4 + vec3(0.0, t, 0.0)) - 0.5;\n' +
        '  float prom = ridgedFbm(dir * 7.6 - vec3(t * 0.7)) - 0.3;\n' +
        '  return lump * 1.2 + prom * 0.5;\n' +
        '}\n' +
        'void main() {\n' +
        '  vec3 dir = normalize(position);\n' +
        '  float h = relief(dir);\n' +
        '  vec3 dispPos = position + normal * h * uBump;\n' +
        // Re-derive the normal from the height gradient over a tiny tangent
        // frame so the bulges catch the fragment limb term (self-shading).
        '  vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n' +
        '  vec3 tang = normalize(cross(up, dir));\n' +
        '  vec3 bit = cross(dir, tang);\n' +
        '  float e = 0.04;\n' +
        '  float hx = relief(normalize(position + tang * e));\n' +
        '  float hy = relief(normalize(position + bit * e));\n' +
        '  vec3 pn = normalize(normal - (tang * (hx - h) + bit * (hy - h)) * uBump * 3.4);\n' +
        '  vPos = position;\n' +
        '  vNrm = normalMatrix * pn;\n' +
        '  vec4 mv = modelViewMatrix * vec4(dispPos, 1.0);\n' +
        '  vView = -mv.xyz;\n' +
        '  gl_Position = projectionMatrix * mv;\n' +
        '}',
      fragmentShader:
        'uniform float uTime;\n' +
        'varying vec3 vPos;\n' +
        'varying vec3 vNrm;\n' +
        'varying vec3 vView;\n' +
        GLSL_NOISE +
        'void main() {\n' +
        '  vec3 p = normalize(vPos);\n' +
        '  float t = uTime * 0.04;\n' +
        // Gentle flow warp — small amplitude so it stirs the cells instead of
        // smearing everything into marble.
        '  vec3 w = vec3(fbm(p * 3.1 + vec3(0.0, t, 0.0)),\n' +
        '                fbm(p * 3.1 + vec3(t, 0.0, 4.0)),\n' +
        '                fbm(p * 3.1 + vec3(2.0, t, 0.0))) - 0.5;\n' +
        '  vec3 pw = p + w * 0.32;\n' +
        // Scales: slow convection regions, main granulation, fine sparkle,
        // ridged threads, and a big low-freq field for the dark sunspot blotches.
        // Frequencies pushed up ~1.9x so the whole surface reads finer-grained.
        '  float macro = fbm(pw * 4.2 + vec3(t * 0.5));\n' +
        '  float gran = fbm(pw * 11.5 - vec3(t * 1.1, 0.0, t * 0.7));\n' +
        '  float fine = fbm(pw * 21.0 + vec3(0.0, t * 1.8, 0.0));\n' +
        '  float fil = ridgedFbm(pw * 8.6 + vec3(t * 0.6, 0.0, -t * 0.4));\n' +
        '  float spots = fbm(pw * 5.6 - vec3(t * 0.25, 0.0, 0.0));\n' +
        '  float spotMask = smoothstep(0.20, 0.34, spots);\n' + // 0 inside a spot, 1 outside
        '  float heat = 0.10 + macro * 0.26 + gran * 0.34 + fine * 0.12;\n' +
        '  heat += pow(fil, 2.0) * 0.55;\n' +          // bright filament threads
        '  heat -= (1.0 - fil) * 0.12;\n' +            // dark lanes between them
        '  heat *= mix(0.32, 1.0, spotMask);\n' +      // crush the heat inside spots
        '  heat = clamp(heat, 0.0, 1.4);\n' +
        // Red-dominant fire ramp with a near-black maroon floor.
        '  vec3 col = mix(vec3(0.09, 0.012, 0.004), vec3(0.55, 0.09, 0.015), smoothstep(0.02, 0.28, heat));\n' +
        '  col = mix(col, vec3(0.95, 0.27, 0.03), smoothstep(0.24, 0.48, heat));\n' +
        '  col = mix(col, vec3(1.0, 0.52, 0.10), smoothstep(0.46, 0.70, heat));\n' +
        '  col = mix(col, vec3(1.0, 0.82, 0.40), smoothstep(0.70, 0.92, heat));\n' +
        '  col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(0.95, 1.20, heat));\n' +
        // Extra darkening + reddening right inside the spots (sunspot umbra).
        '  col = mix(col * vec3(0.45, 0.26, 0.20), col, spotMask);\n' +
        // Limb: gentle darkening across the disc, then a warm emissive edge so
        // the silhouette itself glows and hands off into the corona with no
        // hard seam (follows the displaced bumps via the perturbed normal).
        '  float ndv = clamp(dot(normalize(vNrm), normalize(vView)), 0.0, 1.0);\n' +
        '  col *= mix(0.62, 1.08, pow(ndv, 0.5));\n' +
        '  float edge = pow(1.0 - ndv, 2.5);\n' +
        '  col += vec3(1.0, 0.66, 0.36) * edge * 1.6;\n' +
        '  gl_FragColor = vec4(col * 1.1, 1.0);\n' +
        '}',
      toneMapped: false
    });
  }

  // Corona / aureole: a real sphere shell around the sun, `side: BackSide` so we
  // look through the near hemisphere and see the far one lit as a ring in the
  // annulus outside the sun's disc (the classic additive glow-shell trick).
  // Genuine 3D geometry -> the glow is anchored in space and has real parallax
  // when the camera orbits, not a flat billboard.
  //
  // Falloff: a thin bright collar hugging the limb + a broad Gaussian halo that
  // eases out over ~2x the sun's radius + a faint outer bloom, driven by the
  // radial coordinate `rr` (0 at the sun's limb -> 1 at the shell edge, from
  // each fragment's perpendicular distance to the camera->sun axis in view
  // space). The *reach* of the halo at each angle is then pushed in/out by a
  // slow 3D noise (`wob`) sampled from the shell direction, so the outer
  // boundary undulates — a few broad lobes plus a finer ripple — instead of
  // being a perfect circle. The bloom pass downstream inherits that shape.
  // The collar stays on the unperturbed `rr` so it hugs the sun cleanly.
  // Additive, no depth write; the opaque sun occludes the shell behind it.
  function buildCoronaShell(sunR) {
    const shellR = (lighting.coronaRadius || 2.6) * sunR;   // debug-panel knob
    const geo = new THREE.SphereGeometry(shellR, 96, 64);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunR: { value: sunR },
        uShellR: { value: shellR },
        uColorInner: { value: new THREE.Color(1.0, 0.92, 0.70) },
        uColorMid: { value: new THREE.Color(1.0, 0.5, 0.18) },
        uColorOuter: { value: new THREE.Color(1.0, 0.32, 0.09) },
        uWobAmp: { value: lighting.coronaWob },   // debug-panel knob: how ragged the outer edge is
        uGain: { value: lighting.coronaGain }     // debug-panel knob: overall corona brightness
      },
      vertexShader:
        'varying vec3 vVP;\n' +
        'varying vec3 vSunView;\n' +
        'varying vec3 vLP;\n' +
        'void main() {\n' +
        '  vLP = position;\n' +
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n' +
        '  vVP = mv.xyz;\n' +
        '  vSunView = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;\n' +
        '  gl_Position = projectionMatrix * mv;\n' +
        '}',
      fragmentShader:
        'uniform float uTime;\n' +
        'uniform float uSunR;\n' +
        'uniform float uShellR;\n' +
        'uniform vec3 uColorInner;\n' +
        'uniform vec3 uColorMid;\n' +
        'uniform vec3 uColorOuter;\n' +
        'uniform float uWobAmp;\n' +
        'uniform float uGain;\n' +
        'varying vec3 vVP;\n' +
        'varying vec3 vSunView;\n' +
        'varying vec3 vLP;\n' +
        GLSL_NOISE +
        'void main() {\n' +
        // perpendicular distance from this fragment to the camera->sun ray
        '  vec3 axis = normalize(vSunView);\n' +
        '  float perp = length(vVP - axis * dot(vVP, axis));\n' +
        '  if (perp < uSunR * 0.86) discard;\n' +
        // start `rr` a touch inside the nominal limb so the glow overlaps the
        // sun's bumpy silhouette with no dark gap
        '  float inner = uSunR * 0.90;\n' +
        '  float rr = clamp((perp - inner) / (uShellR - inner), 0.0, 1.0);\n' +
        // angular wobble: broad lobes + finer ripple, anchored to the shell so
        // it parallaxes correctly when the camera orbits. Gated to fade in past
        // the collar, so the halo edge goes wavy but the core stays tight.
        '  vec3 sp = normalize(vLP);\n' +
        '  float ta = uTime * 0.03;\n' +
        '  float lobes = fbm(sp * 1.6 + vec3(0.0, ta, 0.0)) - 0.5;\n' +
        '  float ripple = fbm(sp * 3.9 - vec3(ta * 0.7, 0.0, ta * 0.5)) - 0.5;\n' +
        '  float wob = lobes * 1.15 + ripple * 0.45;\n' +
        '  float rrw = clamp(rr - wob * uWobAmp * smoothstep(0.04, 0.6, rr), 0.0, 1.0);\n' +
        // thin bright collar on the limb (unperturbed rr), broad soft Gaussian
        // halo + faint tail on the wobbled coord
        '  float collar = smoothstep(0.10, 0.0, rr) * 0.75;\n' +
        '  float halo = exp(-rrw * rrw * 4.0) * 0.95;\n' +
        '  float tail = pow(1.0 - rrw, 3.0) * 0.12;\n' +
        '  float bright = collar + halo + tail;\n' +
        // clean fade to exactly 0 before the shell edge so no sphere shows
        '  bright *= 1.0 - smoothstep(0.80, 1.0, rrw);\n' +
        // mild brightness variation inside the glow so it is not a flat wash
        '  bright *= 0.82 + 0.36 * fbm(sp * 2.4 + vec3(ta * 0.5));\n' +
        // slow, gentle breathing only — no high-frequency flicker
        '  bright *= 0.95 + 0.05 * sin(uTime * 0.35);\n' +
        '  bright *= uGain;\n' +
        '  vec3 col = mix(uColorInner, uColorMid, smoothstep(0.0, 0.34, rrw));\n' +
        '  col = mix(col, uColorOuter, smoothstep(0.30, 0.82, rrw));\n' +
        '  gl_FragColor = vec4(col, clamp(bright, 0.0, 1.35));\n' +
        '}',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      toneMapped: false
    });
    return new THREE.Mesh(geo, mat);
  }

  const ROUGHNESS_BY_KIND = { gas: 0.55, ice: 0.5, ocean: 0.7 };

  // ---- Debug lighting panel ------------------------------------------------
  // Floating slider panel (top-left of the solar-system overlay) for live
  // tuning of every light + the bloom + the corona. Values persist to
  // localStorage; COPY dumps them as JSON to the console / clipboard so tuned
  // numbers can be pasted back into LIGHTING_DEFAULTS. Toggle collapse with the
  // L key or by clicking the header. Only exists while the scene is up.
  const LIGHTING_DEFAULTS = {
    sunColor: '#fff2e0', sunIntensity: 4.6, sunDistance: 720, sunDecay: 1.35,
    ambColor: '#1b2438', ambIntensity: 0.5,
    dirColor: '#cfe0ff', dirIntensity: 0.25, dirAzimuth: 135, dirElevation: 35,
    exposure: 0.66,
    bloomStrength: 0.95, bloomRadius: 0.62, bloomThreshold: 0.86,
    rimStrength: 0.55,
    bodyRelief: 0.03, earthRelief: 1.3, earthAtmo: 1.0, earthHaze: 0.6,
    coronaRadius: 2.6, coronaWob: 0.15, coronaGain: 1.0,
    toneMapping: 'ACES',   // None | Linear | Reinhard | Cineon | ACES
    gradeSaturation: 1.0, gradeContrast: 1.0, gradeBrightness: 1.0,
    gradeTemperature: 0.0, gradeTint: 0.0, gradeVignette: 0.0
  };
  const LIGHTING_KEY = 'ss3d_debug_lighting';
  let lighting = Object.assign({}, LIGHTING_DEFAULTS);
  const TONEMAP_MODES = {
    None: THREE.NoToneMapping, Linear: THREE.LinearToneMapping,
    Reinhard: THREE.ReinhardToneMapping, Cineon: THREE.CineonToneMapping,
    ACES: THREE.ACESFilmicToneMapping
  };

  // Final full-frame colour grade (last pass, after bloom). All knobs neutral
  // by default, so it's a no-op until the debug panel moves something.
  const GRADE_SHADER = {
    uniforms: {
      tDiffuse: { value: null },
      uSaturation: { value: 1.0 }, uContrast: { value: 1.0 }, uBrightness: { value: 1.0 },
      uTemperature: { value: 0.0 }, uTint: { value: 0.0 }, uVignette: { value: 0.0 }
    },
    vertexShader:
      'varying vec2 vUv;\n' +
      'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform sampler2D tDiffuse;\n' +
      'uniform float uSaturation;\n' +
      'uniform float uContrast;\n' +
      'uniform float uBrightness;\n' +
      'uniform float uTemperature;\n' +
      'uniform float uTint;\n' +
      'uniform float uVignette;\n' +
      'varying vec2 vUv;\n' +
      'void main() {\n' +
      '  vec3 c = texture2D(tDiffuse, vUv).rgb;\n' +
      '  c.r += uTemperature; c.b -= uTemperature;\n' +               // warm <-> cool
      '  c.g += uTint; c.r -= uTint * 0.5; c.b -= uTint * 0.5;\n' +   // green <-> magenta
      '  c = max(c, 0.0) * uBrightness;\n' +
      '  c = (c - 0.5) * uContrast + 0.5;\n' +
      '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n' +
      '  c = mix(vec3(l), c, uSaturation);\n' +
      '  float d = distance(vUv, vec2(0.5));\n' +
      '  c *= 1.0 - uVignette * smoothstep(0.30, 0.85, d);\n' +
      '  gl_FragColor = vec4(max(c, 0.0), 1.0);\n' +
      '}'
  };

  function loadLighting() {
    const c = Object.assign({}, LIGHTING_DEFAULTS);
    try { const raw = localStorage.getItem(LIGHTING_KEY); if (raw) Object.assign(c, JSON.parse(raw)); } catch (e) {}
    return c;
  }
  function saveLighting() {
    try { localStorage.setItem(LIGHTING_KEY, JSON.stringify(lighting)); } catch (e) {}
  }
  function applyLighting(c) {
    _sunBaseIntensity = c.sunIntensity;   // render() adds the pulse on top
    if (sunLight) { sunLight.color.set(c.sunColor); sunLight.distance = c.sunDistance; sunLight.decay = c.sunDecay; }
    if (ambient) { ambient.color.set(c.ambColor); ambient.intensity = c.ambIntensity; }
    if (dirLight) {
      dirLight.color.set(c.dirColor);
      dirLight.intensity = c.dirIntensity;
      const az = c.dirAzimuth * Math.PI / 180, el = c.dirElevation * Math.PI / 180;
      dirLight.position.set(1000 * Math.cos(el) * Math.cos(az), 1000 * Math.sin(el), 1000 * Math.cos(el) * Math.sin(az));
    }
    if (renderer) {
      const tm = TONEMAP_MODES[c.toneMapping] != null ? TONEMAP_MODES[c.toneMapping] : THREE.ACESFilmicToneMapping;
      if (renderer.toneMapping !== tm) {
        renderer.toneMapping = tm;
        // The tone-mapping function is compiled into each material's shader —
        // force the standard-material bodies to recompile so the change lands.
        if (scene) scene.traverse(function (o) {
          if (!o.material) return;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; });
        });
      }
      renderer.toneMappingExposure = c.exposure;   // ignored under 'None', scales 'Linear'
    }
    if (bloomPass) { bloomPass.strength = c.bloomStrength; bloomPass.radius = c.bloomRadius; bloomPass.threshold = c.bloomThreshold; }
    if (gradePass) {
      const g = gradePass.uniforms;
      g.uSaturation.value = c.gradeSaturation;
      g.uContrast.value = c.gradeContrast;
      g.uBrightness.value = c.gradeBrightness;
      g.uTemperature.value = c.gradeTemperature;
      g.uTint.value = c.gradeTint;
      g.uVignette.value = c.gradeVignette;
    }
    for (let i = 0; i < rimShaders.length; i++) rimShaders[i].uniforms.uRimStrength.value = c.rimStrength;
    for (let i = 0; i < bumpedMats.length; i++) bumpedMats[i].bumpScale = c.bodyRelief;
    if (earthMat) { earthMat.uniforms.uNormalScale.value = c.earthRelief; earthMat.uniforms.uHaze.value = c.earthHaze; }
    if (earthAtmo) earthAtmo.material.uniforms.uStrength.value = c.earthAtmo;
    if (sunCorona) {
      const u = sunCorona.material.uniforms;
      u.uWobAmp.value = c.coronaWob;
      u.uGain.value = c.coronaGain;
      const wantR = c.coronaRadius * u.uSunR.value;
      if (Math.abs(u.uShellR.value - wantR) > 1e-3) {
        // radius is baked into the geometry (BackSide shell) — swap it, keeping
        // the material. Cheap: one ~6k-vert sphere, only on an actual change.
        sunCorona.geometry.dispose();
        sunCorona.geometry = new THREE.SphereGeometry(wantR, 96, 64);
        u.uShellR.value = wantR;
      }
    }
  }

  const LIGHTING_SLIDERS = [
    ['sunIntensity', 'Sun · intensity', 0, 14, 0.05],
    ['sunDistance', 'Sun · distance', 100, 2400, 10],
    ['sunDecay', 'Sun · decay', 0, 3, 0.01],
    ['ambIntensity', 'Ambient · intensity', 0, 2.5, 0.01],
    ['dirIntensity', 'Dir light · intensity', 0, 4, 0.02],
    ['dirAzimuth', 'Dir light · azimuth°', 0, 360, 1],
    ['dirElevation', 'Dir light · elevation°', -90, 90, 1],
    ['exposure', 'Tonemap · exposure', 0.1, 2.5, 0.01],
    ['bloomStrength', 'Bloom · strength', 0, 3, 0.01],
    ['bloomRadius', 'Bloom · radius', 0, 1.5, 0.01],
    ['bloomThreshold', 'Bloom · threshold', 0, 1, 0.005],
    ['rimStrength', 'Planet rim · strength', 0, 2, 0.01],
    ['bodyRelief', 'Relief · bodies (bump)', 0, 0.12, 0.002],
    ['earthRelief', 'Relief · Earth (normal)', 0, 4, 0.05],
    ['earthAtmo', 'Earth · atmosphere', 0, 2.5, 0.02],
    ['earthHaze', 'Earth · limb haze', 0, 1.5, 0.02],
    ['coronaRadius', 'Corona · radius ×sun', 1.4, 4, 0.05],
    ['coronaWob', 'Corona · edge wobble', 0, 0.5, 0.005],
    ['coronaGain', 'Corona · brightness', 0, 3, 0.02],
    ['gradeSaturation', 'Grade · saturation', 0, 2, 0.01],
    ['gradeContrast', 'Grade · contrast', 0.4, 2, 0.01],
    ['gradeBrightness', 'Grade · brightness', 0.3, 2, 0.01],
    ['gradeTemperature', 'Grade · temperature', -0.35, 0.35, 0.005],
    ['gradeTint', 'Grade · tint', -0.35, 0.35, 0.005],
    ['gradeVignette', 'Grade · vignette', 0, 1, 0.01]
  ];
  const LIGHTING_COLORS = [['sunColor', 'Sun · colour'], ['ambColor', 'Ambient · colour'], ['dirColor', 'Dir light · colour']];
  const LIGHTING_SELECTS = [['toneMapping', 'Tone mapping', ['None', 'Linear', 'Reinhard', 'Cineon', 'ACES']]];

  function buildDebugPanel() {
    if (debugPanel || typeof document === 'undefined') return;
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;left:16px;top:96px;width:238px;max-height:calc(100vh - 130px);overflow-y:auto;z-index:60;background:rgba(18,24,34,0.93);backdrop-filter:blur(10px);border:1px solid rgba(220,230,240,0.16);color:#dfe6ee;font-family:"JetBrains Mono",monospace;font-size:10px;box-sizing:border-box';
    const head = document.createElement('div');
    head.textContent = '☀ LIGHTING  (L)';
    head.style.cssText = 'padding:8px 10px;font-weight:600;letter-spacing:0.08em;cursor:pointer;background:rgba(40,52,70,0.9);border-bottom:1px solid rgba(220,230,240,0.14);user-select:none';
    const body = document.createElement('div');
    body.style.cssText = 'padding:9px 10px;display:flex;flex-direction:column;gap:9px';
    head.addEventListener('click', function () { body.hidden = !body.hidden; });
    p.appendChild(head); p.appendChild(body);

    const fmt = function (n, step) { return (+n).toFixed(step < 0.01 ? 3 : (step < 1 ? 2 : 0)); };

    LIGHTING_SLIDERS.forEach(function (s) {
      const key = s[0], min = s[2], max = s[3], step = s[4];
      const row = document.createElement('div');
      const lab = document.createElement('div');
      lab.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:3px;color:#9fb0c2';
      const ls = document.createElement('span'); ls.textContent = s[1];
      const vs = document.createElement('span'); vs.textContent = fmt(lighting[key], step); vs.style.color = '#7fd6d0';
      lab.appendChild(ls); lab.appendChild(vs);
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = lighting[key];
      inp.style.cssText = 'width:100%;accent-color:#4fc3bd;cursor:pointer';
      inp.addEventListener('input', function () {
        lighting[key] = parseFloat(inp.value);
        vs.textContent = fmt(lighting[key], step);
        applyLighting(lighting); saveLighting();
      });
      row.appendChild(lab); row.appendChild(inp); body.appendChild(row);
    });

    LIGHTING_COLORS.forEach(function (s) {
      const key = s[0];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#9fb0c2';
      const ls = document.createElement('span'); ls.textContent = s[1];
      const inp = document.createElement('input');
      inp.type = 'color'; inp.value = lighting[key];
      inp.style.cssText = 'width:46px;height:20px;padding:0;border:1px solid rgba(220,230,240,0.22);background:none;cursor:pointer';
      inp.addEventListener('input', function () { lighting[key] = inp.value; applyLighting(lighting); saveLighting(); });
      row.appendChild(ls); row.appendChild(inp); body.appendChild(row);
    });

    LIGHTING_SELECTS.forEach(function (s) {
      const key = s[0];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;color:#9fb0c2';
      const ls = document.createElement('span'); ls.textContent = s[1];
      const sel = document.createElement('select');
      sel.style.cssText = 'font-family:inherit;font-size:9px;background:rgba(38,50,68,0.9);color:#dfe6ee;border:1px solid rgba(220,230,240,0.22);padding:2px 4px;cursor:pointer';
      s[2].forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt; if (lighting[key] === opt) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { lighting[key] = sel.value; applyLighting(lighting); saveLighting(); });
      row.appendChild(ls); row.appendChild(sel); body.appendChild(row);
    });

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;margin-top:2px';
    const mkBtn = function (txt, fn) {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'flex:1;padding:5px 0;font-family:inherit;font-size:9px;letter-spacing:0.05em;background:rgba(38,50,68,0.85);border:1px solid rgba(79,195,189,0.4);color:#8fd8d2;cursor:pointer';
      b.addEventListener('click', fn);
      return b;
    };
    btns.appendChild(mkBtn('COPY', function () {
      const str = JSON.stringify(lighting, null, 2);
      try { if (navigator.clipboard) navigator.clipboard.writeText(str); } catch (e) {}
      try { console.log('[ss3d lighting]\n' + str); } catch (e) {}
    }));
    btns.appendChild(mkBtn('RESET', function () {
      lighting = Object.assign({}, LIGHTING_DEFAULTS);
      applyLighting(lighting); saveLighting();
      destroyDebugPanel(); buildDebugPanel();
    }));
    body.appendChild(btns);

    document.body.appendChild(p);
    debugPanel = p;

    _onDebugKey = function (e) {
      const tag = (e.target && e.target.tagName) || '';
      if ((e.key === 'l' || e.key === 'L') && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        p.style.display = (p.style.display === 'none') ? '' : 'none';   // hide / show the whole panel
      }
    };
    document.addEventListener('keydown', _onDebugKey);
  }

  function destroyDebugPanel() {
    if (_onDebugKey) { document.removeEventListener('keydown', _onDebugKey); _onDebugKey = null; }
    if (debugPanel) { debugPanel.remove(); debugPanel = null; }
  }

  // canvas may be omitted — the module then owns a persistent canvas that lives
  // in an off-DOM holder while the overlay is closed and is moved into the
  // visible container by mount(). Warmed once at boot (see game-preload.js) so
  // every texture is decoded + uploaded before the player first opens the view.
  function init(canvas, selectCallback) {
    if (ready) { if (selectCallback) onSelectCb = selectCallback; return; }   // idempotent — warmed once at boot, re-called on first open
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 1600; canvas.height = 900;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab';
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:0;top:0;width:1600px;height:900px;visibility:hidden;pointer-events:none;z-index:-1';
      holder.appendChild(canvas);
      document.body.appendChild(holder);
    }
    canvasEl = canvas;
    onSelectCb = selectCallback || function () {};
    lighting = loadLighting();   // must be set before buildCoronaShell / addSunRim read it
    const w = canvas.clientWidth || 1600, h = canvas.clientHeight || 900;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Capped at 1.5 rather than 2: the bloom chain (RenderPass + multi-MIP
    // UnrealBloomPass) runs at this ratio, so on a HiDPI display the extra
    // step to 2.0 nearly doubles GPU cost for a scene that's mostly soft glow.
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.66;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, w / h, 1, 6000);
    camera.position.set(0, 260, 520);

    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 72;   // keep the camera outside the corona shell (max radius ~4x sunR = 64)
    controls.maxDistance = 2200;
    controls.target.set(0, 0, 0);
    // Slow ambient drift when idle, like a showcase orrery — the user's own
    // drag still takes over instantly and this resumes once they let go.
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.12;

    // The sun is the light source: a PointLight at the origin (where the sun
    // mesh sits). Near-white with a touch of warmth — starlight, not a sodium
    // lamp. A gentle distance falloff (three's non-physical decay curve, not
    // inverse-square) gives the system real depth: Mercury blazes, the Kuiper
    // dwarfs sit in moody half-light — but `distance` is set well past Eris so
    // nothing goes fully black, and the cool ambient fills the night sides.
    ambient = new THREE.AmbientLight(0x1b2438, 0.5);
    scene.add(ambient);
    sunLight = new THREE.PointLight(0xfff2e0, _sunBaseIntensity, 720, 1.35);
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);
    // Optional artistic fill from a fixed angle (the sun is a point light at
    // the centre, so far planets have no "sky" side without this). Off-ish by
    // default; the debug panel drives intensity / colour / angle. Only touches
    // the standard-material bodies, not the sun/corona/Earth custom shaders.
    dirLight = new THREE.DirectionalLight(0xcfe0ff, 0.25);
    scene.add(dirLight);
    scene.add(dirLight.target);   // target stays at world origin

    textureLoader = new THREE.TextureLoader();
    // Three defaults to crossOrigin:"anonymous", which makes the browser
    // fetch images in CORS mode — file:// (or a cross-context load) has no
    // CORS headers to satisfy. ImageLoader's internal check is
    // `this.crossOrigin !== undefined`, so '' still counts as "anonymous"
    // (per the HTML spec, crossOrigin:'' *is* "anonymous", not "no CORS") —
    // it has to be undefined so the img.crossOrigin attribute is never set
    // at all, matching how every other <img>/Image() texture in this app
    // already loads locally without one.
    textureLoader.crossOrigin = undefined;

    starfield = buildStarfield();
    scene.add(starfield);

    // Procedural churning-plasma surface (buildSunMaterial) — toneMapped:false
    // + its >1 output keeps the sun reading as a genuine light source under
    // ACES and reliably clears the bloom threshold. Higher poly count than the
    // planets since the noise is evaluated per-fragment over a close subject.
    // Higher segment count than the planets: the sun's vertex shader displaces
    // these along the normal, so the silhouette needs enough geometry to
    // deform smoothly instead of showing facets.
    sunMesh = new THREE.Mesh(new THREE.SphereGeometry(16, 144, 104), buildSunMaterial());
    scene.add(sunMesh);
    sunCorona = buildCoronaShell(16);
    scene.add(sunCorona);

    SYSTEM_PLANETS.forEach(p => {
      const roughness = ROUGHNESS_BY_KIND[p.id === 'earth' ? 'ocean' : p.kind];
      let mesh;
      if (p.id === 'earth') {
        earthMat = buildEarthMaterial();
        mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, 32, 24), earthMat);
        earthClouds = buildClouds(p.r);
        mesh.add(earthClouds);
        earthAtmo = buildEarthAtmosphere(p.r);
        mesh.add(earthAtmo);
      } else {
        mesh = makeBodyMesh(p.r, SYS_TEX[p.id], p.color, roughness, SYS_BUMP[p.id]);
        if (p.kind === 'gas' || p.kind === 'ice') gasGiantMeshes.push(mesh);
      }
      mesh.userData.id = p.id;
      // Axial tilt is a one-time local rotation; per-frame spin then happens
      // around the mesh's own (now-tilted) local Y axis via rotateY, so the
      // rings/atmosphere children (added below) automatically tilt and spin
      // with it — no per-frame position/rotation syncing needed.
      mesh.rotateZ((p.tilt || 0) * Math.PI / 180);
      scene.add(mesh);
      bodyMeshes[p.id] = mesh;
      scene.add(buildOrbitLine(p));

      if (p.id === 'saturn' || p.id === 'uranus') {
        mesh.add(buildRing(p.r, p.id === 'saturn' ? 'oklch(80% 0.05 88)' : 'oklch(80% 0.06 202)'));
      }

      (p.moons || []).forEach(m => {
        const mm = makeBodyMesh(m.r, MOON_TEX[m.id], 'oklch(70% 0.008 235)', null, MOON_BUMP[m.id]);
        mm.userData.id = m.id;
        mm.userData.parent = p.id;
        scene.add(mm);
        bodyMeshes[m.id] = mm;
      });
    });

    // Main belt sits with the dwarf planets (ceres/vesta/pallas/hygiea orbit
    // ~158-179); Kuiper belt is wider, fainter and cooler, beyond Neptune.
    beltPoints = buildAsteroidBelt({
      count: 560, rInner: 146, rOuter: 190, thickness: 5.5, gaps: 4,
      lBase: 0.42, lSpread: 0.26, chroma: 0.035, hue: 66, hueSpread: 34,
      baseSize: 1.9, opacity: 0.92, seed: 20260906
    });
    kuiperPoints = buildAsteroidBelt({
      count: 320, rInner: 378, rOuter: 520, thickness: 14, gaps: 3,
      lBase: 0.5, lSpread: 0.2, chroma: 0.02, hue: 232, hueSpread: 26,
      baseSize: 1.6, opacity: 0.5, seed: 71104
    });
    scene.add(beltPoints);
    scene.add(kuiperPoints);

    SYS_FLEETS.forEach(fl => {
      const col = cssColor(FLEET_KIND_COLOR[fl.kind] || 'oklch(78% 0.13 88)');
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 6), new THREE.MeshBasicMaterial({ color: col }));
      mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      fleetSprites[fl.id] = mesh;
    });

    ringSel = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 48),
      new THREE.MeshBasicMaterial({ color: cssColor('oklch(78% 0.13 195)'), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    scene.add(ringSel);

    raycaster = new THREE.Raycaster();
    canvas.addEventListener('click', onCanvasClick);

    composer = new THREE.EffectComposer(renderer);
    composer.setPixelRatio(pr);
    composer.addPass(new THREE.RenderPass(scene, camera));
    // strength, radius, threshold. A wider radius spreads the sun's aureole
    // into a softer, further-reaching bloom; threshold stays high so only the
    // sun + hottest highlights bloom, not the planets.
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.95, 0.62, 0.86);
    composer.addPass(bloomPass);
    gradePass = new THREE.ShaderPass(GRADE_SHADER);   // final colour grade, last pass
    composer.addPass(gradePass);
    composer.setSize(w, h);

    ready = true;
    lastW = w; lastH = h;

    applyLighting(lighting);   // push stored/default values onto the fresh (warmed) scene
    // NB: the debug panel is built in mount() — i.e. only while the solar-system
    // overlay is actually open — not here at boot warm-up.
  }

  function onCanvasClick(e) {
    if (!ready || !onSelectCb) return;
    const rect = canvasEl.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(Object.values(bodyMeshes), false);
    if (hits.length) onSelectCb(hits[0].object.userData.id);
  }

  function resize(w, h) {
    if (!ready || !w || !h || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
  }

  function fleetPos3d(fl) {
    if (fl.at) {
      const base = bodyMeshes[fl.at] ? bodyMeshes[fl.at].position : new THREE.Vector3();
      const a = (fl.ang || 0) * Math.PI / 180 + performance.now() * 0.0002;
      return new THREE.Vector3(base.x + Math.cos(a) * 14, base.y + 2, base.z + Math.sin(a) * 14);
    }
    const from = bodyMeshes[fl.route[0]], to = bodyMeshes[fl.route[1]];
    if (!from || !to) return new THREE.Vector3();
    const t = (((performance.now() * 0.00002 * (fl.speed || 0.3)) + (fl.phase || 0) / 100) % 1 + 1) % 1;
    return new THREE.Vector3().lerpVectors(from.position, to.position, t).setY(3);
  }

  // `sysTOverride` lets game.js advance the orbital clock as a plain instance
  // value and hand it in each frame, instead of round-tripping it through
  // React state (which would re-run its whole renderVals() 25x/second).
  function render(state, sysTOverride) {
    if (!ready || (!mounted && !_forceRender)) return;
    const sysT = sysTOverride != null ? sysTOverride : (state.systemT || 0);

    SYSTEM_PLANETS.forEach(p => {
      const E = (p.phase + sysT * p.speed * 0.1) * Math.PI / 180;
      const o = Orbits.orbitXYZ(true, p, E);
      const mesh = bodyMeshes[p.id];
      mesh.position.set(o.px, o.py, o.pz);
      mesh.rotateY(0.004); // spins around its own (already-tilted) local axis
      if (p.id === 'earth' && earthMat) {
        // Sun sits at world (0,0,0); worldToLocal gives its direction in the
        // mesh's own (spinning, tilted) frame, so the terminator sweeps
        // across the surface correctly as Earth rotates. The camera position
        // gets the same treatment for the ocean-glint view vector.
        earthMat.uniforms.sunDirection.value.copy(mesh.worldToLocal(new THREE.Vector3(0, 0, 0))).normalize();
        earthMat.uniforms.uCamLocal.value.copy(mesh.worldToLocal(camera.position.clone()));
        if (earthAtmo) {
          earthAtmo.material.uniforms.uSunDir.value.copy(earthMat.uniforms.sunDirection.value);
          earthAtmo.material.uniforms.uCamLocal.value.copy(earthMat.uniforms.uCamLocal.value);
        }
      }

      (p.moons || []).forEach(m => {
        const ma = (m.phase + sysT * m.speed) * Math.PI / 180;
        const mm = bodyMeshes[m.id];
        if (!mm) return;
        mm.position.set(mesh.position.x + Math.cos(ma) * (p.r + m.dist), mesh.position.y, mesh.position.z + Math.sin(ma) * (p.r + m.dist));
      });
    });

    const sel = bodyMeshes[state.systemSel];
    if (sel) {
      ringSel.visible = true;
      ringSel.position.copy(sel.position);
      const pulse = 1 + Math.sin(performance.now() * 0.0025) * 0.06;
      const rr = (sel.geometry.parameters.radius || 3) * 1.4 * pulse;
      ringSel.scale.set(rr, rr, rr);
      ringSel.rotation.x = Math.PI / 2;
      ringSel.rotation.z += 0.01;
    } else {
      ringSel.visible = false;
    }

    const fleetsHidden = !!state.sysFleetsHidden;
    SYS_FLEETS.forEach(fl => {
      const mesh = fleetSprites[fl.id];
      if (!mesh) return;
      mesh.visible = !fleetsHidden;
      if (!fleetsHidden) mesh.position.copy(fleetPos3d(fl));
    });

    if (earthClouds) earthClouds.rotateY(0.0011); // drifts a touch faster than the surface
    gasGiantMeshes.forEach(m => { if (m.material.map) m.material.map.offset.x += 0.00025; });
    sunMesh.rotation.y += 0.0009; // slow spin; the surface shader does the real motion
    const now = performance.now();
    sunMesh.material.uniforms.uTime.value = now * 0.001;

    // Belts drift as a group (prograde, tied to the sim clock so they pause
    // with everything else); the shader twinkles on wall-clock time. The main
    // belt eases into a teal tint once the colony can mine it (P4.2).
    const beltOn = (state.techOverride || {})[BELT_TECH_ID] === 'unlocked' ? 1 : 0;
    if (beltPoints) {
      beltPoints.rotation.y = -sysT * 0.00045;
      const u = beltPoints.material.uniforms;
      u.uTime.value = now * 0.001;
      u.uUnlocked.value += (beltOn - u.uUnlocked.value) * 0.02;
    }
    if (kuiperPoints) {
      kuiperPoints.rotation.y = -sysT * 0.00012;
      kuiperPoints.material.uniforms.uTime.value = now * 0.0007;
    }
    // Corona is a real sphere shell now — no billboarding, just advance time.
    if (sunCorona) sunCorona.material.uniforms.uTime.value = now * 0.001;
    // A faint, slow pulse on the sun's own light — a fixed intensity reads
    // dead for something meant to look like an active fusion furnace.
    if (sunLight) sunLight.intensity = _sunBaseIntensity + Math.sin(now * 0.0006) * 0.25;
    controls.update();
    // Sun (world origin) in view space, shared by every body's limb-light shader.
    if (rimShaders.length) {
      _sunView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
      for (let i = 0; i < rimShaders.length; i++) rimShaders[i].uniforms.uSunView.value.copy(_sunView);
    }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function resetCamera() {
    if (!controls) return;
    controls.reset();
  }

  // ---- persistent-canvas lifecycle ----
  function getCanvas() { return canvasEl; }

  // Move the live canvas into the visible overlay container (called when the
  // overlay opens). The WebGL context / uploaded textures survive the reparent.
  function mount(host) {
    if (!ready || !host) return;
    if (canvasEl.parentNode !== host) host.appendChild(canvasEl);
    mounted = true;
    const w = host.clientWidth || lastW || 1600, h = host.clientHeight || lastH || 900;
    lastW = lastH = 0;   // force resize() to run
    resize(w, h);
    buildDebugPanel();   // the tuning panel exists only while the overlay is open
  }
  // Park the canvas back off-DOM (overlay closed). Everything stays alive; the
  // next mount() is instant — no re-init, no texture re-upload.
  function unmount() {
    mounted = false;
    destroyDebugPanel();
    if (holder && canvasEl && canvasEl.parentNode !== holder) holder.appendChild(canvasEl);
  }
  // Draw once regardless of mount state — used by the boot warm-up to force the
  // GPU upload of every texture / compile of every shader.
  function warmRender(state) {
    if (!ready) return;
    _forceRender = true;
    try { render(state || { systemSel: null, sysFleetsHidden: false, techOverride: {}, systemT: 0 }, 0); }
    finally { _forceRender = false; }
  }
  // OrbitControls r128 keeps dollyIn/dollyOut private, so zoom buttons move
  // the camera along the target->camera ray by hand instead.
  function dolly(dir) {
    if (!controls || !camera) return;
    const factor = dir > 0 ? 0.82 : 1 / 0.82;
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    const dist = offset.length();
    if (dist < controls.minDistance || dist > controls.maxDistance) return;
    camera.position.copy(controls.target.clone().add(offset));
    controls.update();
  }

  // Frees GPU resources (geometries/materials/textures/context) so opening
  // and closing this overlay repeatedly doesn't leak WebGL contexts.
  function dispose() {
    if (!ready) return;
    destroyDebugPanel();
    canvasEl.removeEventListener('click', onCanvasClick);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          if (m.alphaMap) m.alphaMap.dispose();
          if (m.bumpMap) m.bumpMap.dispose();
          // ShaderMaterial (earthMat/atmosphere glow) keeps its textures in
          // uniforms rather than .map, where the generic check above can't see them.
          if (m.uniforms) Object.keys(m.uniforms).forEach((k) => {
            const v = m.uniforms[k].value;
            if (v && v.isTexture) v.dispose();
          });
          m.dispose();
        });
      }
    });
    // This vendored EffectComposer (r128) has no dispose() — only its render
    // targets need freeing. Guard it so exiting the overlay never throws (a
    // throw here used to strand _sys3dReady=true and blank the scene on
    // re-entry). bloomPass owns its own MIP render-target chain.
    if (composer) {
      if (composer.renderTarget1) composer.renderTarget1.dispose();
      if (composer.renderTarget2) composer.renderTarget2.dispose();
      if (typeof composer.dispose === 'function') composer.dispose();
    }
    if (bloomPass && typeof bloomPass.dispose === 'function') bloomPass.dispose();
    if (gradePass && gradePass.material) gradePass.material.dispose();
    if (controls && typeof controls.dispose === 'function') controls.dispose();
    if (renderer) renderer.dispose();
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    holder = null; mounted = false;
    bodyMeshes = {};
    fleetSprites = {};
    gasGiantMeshes = [];
    rimShaders = [];
    bumpedMats = [];
    sunMesh = sunCorona = sunLight = ambient = dirLight = ringSel = beltPoints = kuiperPoints = starfield = composer = bloomPass = gradePass = earthMat = earthClouds = earthAtmo = null;
    ready = false;
  }

  return { init, resize, render, dispose, resetCamera, dolly, mount, unmount, getCanvas, warmRender };
})();
