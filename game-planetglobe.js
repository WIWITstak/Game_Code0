// Three.js home-planet (Luna) globe for the SECTOR MAP overlay's planet view.
// Sibling of game-solarsystem3d.js — same shape (init(canvas) / render(...) /
// dispose()), same "game.js owns all state and calls render() every frame from
// its 40ms loop" contract, same file:// texture-loading workaround.
//
// This replaces the old software-rasterised sphere (game-sphererender.js's
// drawMarsGlobe) plus the stack of CSS glow / polar-cap / terminator / rim
// divs that used to fake the lighting around it. Now it's a real lit sphere:
// a MeshStandardMaterial moon under one warm key light, so the terminator is
// genuine geometry, not a gradient — and no orange halo.
//
// Camera is a plain OrthographicCamera framed so the disc lands at exactly
// GLOBE_R/100 of the half-canvas (DISC below). That matches game-data.js's
// projectGlobe() 1:1, so the HTML sector-marker chips (still positioned by
// projectGlobe in renderVals) sit precisely on this sphere with no fudging —
// game.js hands the same planetYaw / planetPitch to both.
'use strict';

const PlanetGlobe3D = (function () {
  const DEG = Math.PI / 180;
  // projectGlobe() uses GLOBE_R = 94 in a 0..200 box -> the disc is 0.94 of the
  // half-frame. Match it so the sector chips overlay pixel-for-pixel.
  const DISC = 0.94;
  const H = 1 / DISC;                 // ortho frustum half-height for a unit sphere
  const TEX = (typeof TEX_BASE === 'string' ? TEX_BASE : 'assets/textures/');
  const MOON_URL = TEX + '2k_moon.jpg';
  const MOON_BUMP_URL = TEX + '2k_moon_height.jpg?v=2';   // ?v busts image cache when the height map content is swapped
  // Cosmetic longitude offset applied to the *texture* only (not the graticule
  // or the chips) so a maria-rich hemisphere faces the camera when the view
  // opens. A constant phase shift — chips and grid still track the drag 1:1.
  const FACE0 = -1.4;

  let renderer, scene, camera, canvasEl;
  let globeGroup, moonMesh, moonMat, graticule, rimMesh;
  let ready = false, mounted = false, holder = null, _forceRender = false;
  let lastW = 0, lastH = 0;

  function surfaceDir(latDeg, lonDeg, r) {
    const la = latDeg * DEG, lo = lonDeg * DEG;
    return new THREE.Vector3(
      Math.cos(la) * Math.sin(lo) * r,
      Math.sin(la) * r,
      Math.cos(la) * Math.cos(lo) * r
    );
  }

  // Lat/long grid as one LineSegments buffer, riding just above the surface as
  // a child of the globe group. depthTest hides the far-side lines behind the
  // opaque moon for free — no manual back-face culling like the old SVG needed.
  function buildGraticule() {
    const pts = [];
    const seg = (a, b) => { pts.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    const r = 1.004;
    for (let lon = -150; lon <= 180; lon += 30) {
      for (let lat = -90; lat < 90; lat += 4) seg(surfaceDir(lat, lon, r), surfaceDir(lat + 4, lon, r));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 4) seg(surfaceDir(lat, lon, r), surfaceDir(lat, lon + 4, r));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x93a9c6, transparent: true, opacity: 0.12, depthWrite: false
    }));
  }

  // A whisper of a cool Fresnel rim so the silhouette lifts off the black
  // starfield. Deliberately faint and blue-grey — the point of this rewrite
  // was to kill the heavy orange halo, not swap it for another one. The
  // camera is orthographic, so the view direction is a constant (0,0,1) in
  // view space and the rim falloff is just the view-space normal's z.
  function buildRim() {
    const geo = new THREE.SphereGeometry(1.045, 48, 32);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0.30, 0.40, 0.58) } },
      vertexShader:
        'varying vec3 vN;\n' +
        'void main(){ vN = normalize(normalMatrix * normal);\n' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 uColor; varying vec3 vN;\n' +
        'void main(){ float f = pow(1.0 - abs(vN.z), 3.2);\n' +
        '  gl_FragColor = vec4(uColor, f * 0.5); }'
    });
    return new THREE.Mesh(geo, mat);
  }

  // canvas may be omitted — the module then owns a persistent canvas parked in
  // an off-DOM holder, moved into the visible container by mount(). Warmed at
  // boot so the moon texture + bump map are uploaded before the first open.
  function init(canvas) {
    if (ready) return;   // idempotent
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 640;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:640px;visibility:hidden;pointer-events:none;z-index:-1';
      holder.appendChild(canvas);
      document.body.appendChild(holder);
    }
    canvasEl = canvas;
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 640;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // This scene is one sphere + a line grid + a shell — cheap enough to run at
    // full DPR (unlike the solar-system bloom chain, which is capped at 1.5).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;

    scene = new THREE.Scene();
    const asp = w / h;
    camera = new THREE.OrthographicCamera(-H * asp, H * asp, H, -H, 0.1, 100);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);

    // Deep-blue ambient so the night side reads as shadow, not a void; one warm
    // key light from upper-left-front carves the terminator; a dim cool
    // back-fill keeps the dark limb from crushing to pure black.
    scene.add(new THREE.AmbientLight(0x161f33, 0.6));
    const key = new THREE.DirectionalLight(0xfff1de, 2.15);
    key.position.set(-2.4, 1.35, 2.7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x2c3c5e, 0.4);
    fill.position.set(2.6, -0.6, -1.8);
    scene.add(fill);

    const loader = new THREE.TextureLoader();
    // Must be undefined (not '') so no crossOrigin attribute is set at all —
    // see the long note in game-solarsystem3d.js. file:// has no CORS headers.
    loader.crossOrigin = undefined;
    moonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
    moonMat.map = loader.load(
      MOON_URL,
      // async — guard against the module being disposed before the load lands
      // (fast open/close, or the preload warm-up), else renderer is null here
      (t) => { if (!renderer || !moonMat) return; t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); moonMat.needsUpdate = true; },
      undefined,
      () => { if (!moonMat) return; moonMat.map = null; moonMat.color.setHex(0x8f8f96); moonMat.needsUpdate = true; }
    );
    if (moonMat.map) moonMat.map.encoding = THREE.sRGBEncoding;
    // Height map (derived from albedo) as a bump map — maria read as sunken,
    // crater rims catch the terminator. Full-screen view, so a touch stronger
    // than the solar-system Moon. Failure just leaves it a smooth sphere.
    moonMat.bumpMap = loader.load(MOON_BUMP_URL, undefined, undefined, () => { if (moonMat) { moonMat.bumpMap = null; moonMat.needsUpdate = true; } });
    moonMat.bumpScale = 0.02;

    globeGroup = new THREE.Group();
    moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), moonMat);
    moonMesh.rotation.y = FACE0;      // texture-only phase shift (see FACE0)
    globeGroup.add(moonMesh);
    graticule = buildGraticule();
    globeGroup.add(graticule);
    scene.add(globeGroup);

    rimMesh = buildRim();
    scene.add(rimMesh);

    ready = true;
    lastW = w; lastH = h;
  }

  // game.js advances planetYaw (auto-rotate + drag) in React state and hands
  // the current angles straight in each frame, same as SolarSystem3D's sysT.
  function render(yawDeg, pitchDeg) {
    if (!ready || (!mounted && !_forceRender)) return;
    if (mounted && canvasEl && canvasEl.clientWidth && (canvasEl.clientWidth !== lastW || canvasEl.clientHeight !== lastH)) {
      resize(canvasEl.clientWidth, canvasEl.clientHeight);
    }
    globeGroup.rotation.set((pitchDeg || 0) * DEG, (yawDeg || 0) * DEG, 0);
    renderer.render(scene, camera);
  }

  function getCanvas() { return canvasEl; }
  function mount(host) {
    if (!ready || !host) return;
    if (canvasEl.parentNode !== host) host.appendChild(canvasEl);
    mounted = true;
    lastW = lastH = 0;
    resize(host.clientWidth || 640, host.clientHeight || 640);
  }
  function unmount() {
    mounted = false;
    if (holder && canvasEl && canvasEl.parentNode !== holder) holder.appendChild(canvasEl);
  }
  function warmRender() {
    if (!ready) return;
    _forceRender = true;
    try { render(0, -8); } finally { _forceRender = false; }
  }

  function resize(w, h) {
    if (!ready || !w || !h) return;
    lastW = w; lastH = h;
    const asp = w / h;
    camera.left = -H * asp; camera.right = H * asp;
    camera.top = H; camera.bottom = -H;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function dispose() {
    if (!ready) return;
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => { if (m.map) m.map.dispose(); if (m.bumpMap) m.bumpMap.dispose(); m.dispose(); });
      }
    });
    renderer.dispose();
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    renderer = scene = camera = canvasEl = holder = null;
    globeGroup = moonMesh = moonMat = graticule = rimMesh = null;
    ready = false; mounted = false;
    lastW = lastH = 0;
  }

  return { init, render, resize, dispose, mount, unmount, getCanvas, warmRender };
})();
