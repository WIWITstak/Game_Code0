// Boot preloader + splash screen.
//
// Fills the browser HTTP cache with every texture and audio track the game
// will need, waits for the fonts and for the interface to mount, then does one
// hidden render of each WebGL scene (solar system + planet globe) so all
// shaders are compiled and all textures uploaded before the player ever opens
// those overlays. Drives #boot-splash (declared in index.html) and removes it
// when finished. Auto-runs on `window.load`.
//
// Depends on globals from game-data.js (TEX_BASE, SYS_TEX, MOON_TEX, SYS_BUMP,
// MOON_BUMP, MILKYWAY_TEX, TRACKS, SFX, I18N) and on the SolarSystem3D /
// PlanetGlobe3D modules — so it must load after all of those, before game.js.
'use strict';

const Preload = (function () {
  function uniq(a) { return Array.from(new Set(a)); }
  function vals(o) { try { return Object.keys(o).map(function (k) { return o[k]; }); } catch (e) { return []; } }

  function textureUrls() {
    var T = (typeof TEX_BASE === 'string' ? TEX_BASE : 'assets/textures/');
    var out = [];
    vals(typeof SYS_TEX !== 'undefined' && SYS_TEX).forEach(function (f) { out.push(T + f); });
    vals(typeof MOON_TEX !== 'undefined' && MOON_TEX).forEach(function (f) { out.push(T + f); });
    vals(typeof SYS_BUMP !== 'undefined' && SYS_BUMP).forEach(function (f) { out.push(T + f + '?v=2'); });
    vals(typeof MOON_BUMP !== 'undefined' && MOON_BUMP).forEach(function (f) { out.push(T + f + '?v=2'); });
    ['2k_earth_clouds.jpg', '2k_earth_daymap.jpg', '2k_earth_nightmap.jpg',
     '2k_saturn_ring_alpha.png', '2k_stars.jpg', '2k_moon.jpg'].forEach(function (f) { out.push(T + f); });
    ['2k_earth_normal_map.png?v=2', '2k_earth_specular_map.jpg?v=2'].forEach(function (f) { out.push(T + f); });
    if (typeof MILKYWAY_TEX === 'string') out.push(MILKYWAY_TEX);
    return uniq(out);
  }
  function audioUrls() {
    var out = [];
    try { TRACKS.forEach(function (t) { out.push(t.file); }); } catch (e) {}
    vals(typeof SFX !== 'undefined' && SFX).forEach(function (f) { out.push(f); });
    return uniq(out);
  }

  function loadImage(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = im.onerror = function () { res(); };
      im.src = url;
    });
  }
  function loadAudio(url) {
    return new Promise(function (res) {
      fetch(url).then(function (r) { return r.blob(); }).then(function () { res(); }, function () { res(); });
    });
  }
  function fontsReady() {
    return (document.fonts && document.fonts.ready) ? Promise.resolve(document.fonts.ready).catch(function () {}) : Promise.resolve();
  }
  function interfaceMounted() {
    return new Promise(function (res) {
      var n = 0;
      var t = setInterval(function () {
        var root = document.getElementById('dc-root');
        if ((root && root.childElementCount > 0) || ++n > 200) { clearInterval(t); res(); }
      }, 40);
    });
  }

  // Init both WebGL scenes now (each owns a persistent off-DOM canvas) and force
  // several renders spread over ~1.2s — every render uploads whatever textures
  // have finished decoding (they're already in the HTTP cache from the step
  // above) and compiles the shaders. The scenes then stay alive for the rest of
  // the session; opening an overlay just re-parents the canvas, so there is no
  // texture pop-in on first open.
  function warmScenes() {
    return new Promise(function (resolve) {
      var sys = (typeof SolarSystem3D !== 'undefined' && SolarSystem3D && SolarSystem3D.init) ? SolarSystem3D : null;
      var globe = (typeof PlanetGlobe3D !== 'undefined' && PlanetGlobe3D && PlanetGlobe3D.init) ? PlanetGlobe3D : null;
      try { if (sys) sys.init(null, function () {}); } catch (e) { console.warn('[preload] sys init', e); sys = null; }
      try { if (globe) globe.init(); } catch (e) { console.warn('[preload] globe init', e); globe = null; }
      if (!sys && !globe) { resolve(); return; }
      var at = [60, 220, 480, 820, 1250], i = 0;
      function shot() {
        try { if (sys) sys.warmRender(); } catch (e) {}
        try { if (globe) globe.warmRender(); } catch (e) {}
        i++;
        if (i < at.length) setTimeout(shot, at[i] - at[i - 1]);
        else resolve();
      }
      setTimeout(shot, at[0]);
      setTimeout(function () { resolve(); }, 6000);   // hard cap
    });
  }

  function run(onProgress) {
    var imgs = textureUrls(), auds = audioUrls();
    var total = imgs.length + auds.length + 3;   // + fonts + interface + scenes
    var n = 0;
    function step(label) { n++; if (onProgress) onProgress(Math.min(n / total, 0.99), label); }

    return Promise.all([].concat(
      imgs.map(function (u) { return loadImage(u).then(function () { step('loading textures'); }); }),
      auds.map(function (u) { return loadAudio(u).then(function () { step('loading audio'); }); })
    ))
      .then(function () {
        return Promise.all([
          fontsReady().then(function () { step('loading fonts'); }),
          interfaceMounted().then(function () { step('building interface'); })
        ]);
      })
      .then(function () { return warmScenes(); })
      .then(function () { step('warming render'); if (onProgress) onProgress(1, 'ready'); });
  }

  function boot() {
    var sp = document.getElementById('boot-splash');
    if (sp) {
      try {
        var L = ((typeof I18N !== 'undefined' && (I18N.ru || I18N.en)) || {}).launch || {};
        var tl = sp.querySelector('.bs-title'), sb = sp.querySelector('.bs-sub');
        if (L.title && tl) tl.textContent = L.title;
        if (L.tagline && sb) sb.textContent = L.tagline;
      } catch (e) {}
    }
    var fill = sp && sp.querySelector('.bs-fill');
    var status = sp && sp.querySelector('.bs-status');
    var high = 0;
    function prog(p, label) {
      if (fill) { high = Math.max(high, p); fill.style.width = Math.round(high * 100) + '%'; }
      if (status && label) status.textContent = label;
    }
    function finish() {
      if (!sp) return;
      sp.classList.add('bs-done');
      setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 700);
    }
    var guard = new Promise(function (r) { setTimeout(r, 25000); });   // never trap the player
    Promise.race([run(prog), guard]).then(finish, finish);
  }

  return { run: run, boot: boot, textureUrls: textureUrls, audioUrls: audioUrls };
})();

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') Preload.boot();
  else window.addEventListener('load', function () { Preload.boot(); });
}
