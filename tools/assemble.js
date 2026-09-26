// Build the new standard-HTML index.html from the converted markup + a fresh
// head/body shell (no React, no support.js — view.js instead).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(__dirname, 'converted-markup.html'), 'utf8').trim();

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./assets/fonts/fonts.css">
<link rel="stylesheet" href="./styles.css?v=4">
<script src="./assets/vendor/three.min.js?v=1"></script>
<script src="./assets/vendor/OrbitControls.js?v=1"></script>
<script src="./assets/vendor/CopyShader.js?v=1"></script>
<script src="./assets/vendor/LuminosityHighPassShader.js?v=1"></script>
<script src="./assets/vendor/EffectComposer.js?v=1"></script>
<script src="./assets/vendor/RenderPass.js?v=1"></script>
<script src="./assets/vendor/ShaderPass.js?v=1"></script>
<script src="./assets/vendor/MaskPass.js?v=1"></script>
<script src="./assets/vendor/UnrealBloomPass.js?v=1"></script>
<script src="./game-data.js?v=27"></script>
<script src="./game-i18n.js?v=27"></script>
<script src="./game-economy.js?v=19"></script>
<script src="./game-sphererender.js?v=3"></script>
<script src="./game-orbits.js?v=2"></script>
<script src="./game-solarsystem3d.js?v=57"></script>
<script src="./game-planetglobe.js?v=5"></script>
<script src="./game-preload.js?v=2"></script>
<script src="./game-save.js?v=7"></script>
<script src="./game.js?v=37"></script>
<script src="./view.js?v=1"></script>
</head>
<body>
<div id="boot-splash">
  <div class="bs-title">MARS: AWAKENING</div>
  <div class="bs-sub">Colony systems initializing</div>
  <div class="bs-bar"><div class="bs-fill"></div></div>
  <div class="bs-status">loading</div>
</div>
<div id="dc-root">
${markup}
</div>
<script>
  (function () {
    var Component = window.__defineGameComponent(window.__View, window.__viewReact);
    window.__mountView(Component, document.getElementById('dc-root'));
  })();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');
console.log('wrote index.html (' + html.length + ' chars)');
