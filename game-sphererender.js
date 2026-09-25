// Pure canvas sphere rendering — orthographic reprojection of an equirectangular
// texture via piecewise drawImage (latitude row bands x longitude segments).
// No getImageData -> works from file:// without tainting the canvas.
// One call site in game.js: the solar-system info panel's small auto-spinning
// preview (fixed top-left light, no pitch). Doesn't touch `this`/state/refs —
// game.js just resolves the canvas/image and hands them in. (The big home-planet
// globe used to live here too; it's a real Three.js scene now — PlanetGlobe3D.)
'use strict';

const SphereRender = {

  // Solar-system info-panel preview: small, auto-spinning, fixed top-left light.
  drawInfoSphere(ctx, size, img, fallbackColor) {
    const D = size, R = D / 2, cx = R, cy = R, r = R - 3;
    ctx.clearRect(0, 0, D, D);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const ready = img && img.complete && img.naturalWidth > 0;
    if (ready) {
      const IW = img.naturalWidth, IH = img.naturalHeight, PI = Math.PI, RAD = PI / 180;
      const spinT = ((Date.now() * 0.02 / 360) % 1 + 1) % 1;
      const ROWS = 52, SEG = 34, rowH = (2 * r) / ROWS, over = rowH * 0.5;
      for (let rr = 0; rr < ROWS; rr++) {
        const yTop = cy - r + rr * rowH, yBot = yTop + rowH;
        let nyT = (yTop - cy) / r, nyB = (yBot - cy) / r;
        if (nyT < -0.99999) nyT = -0.99999;
        if (nyB > 0.99999) nyB = 0.99999;
        const nyM = (nyT + nyB) / 2, hw = Math.sqrt(1 - nyM * nyM) * r;
        if (hw < 0.4) continue;
        let sTop = (0.5 - Math.asin(-nyT) / PI) * IH;
        let sBot = (0.5 - Math.asin(-nyB) / PI) * IH;
        if (sTop < 0) sTop = 0;
        if (sBot > IH) sBot = IH;
        const bandH = Math.max(0.5, sBot - sTop), dy = yTop - over, dh = rowH + over * 2;
        for (let k = 0; k < SEG; k++) {
          const aD = -90 + 180 * k / SEG, bD = -90 + 180 * (k + 1) / SEG;
          const xA = Math.sin(aD * RAD) * hw, xB = Math.sin(bD * RAD) * hw;
          let uA = spinT + aD / 360, uB = spinT + bD / 360;
          uA -= Math.floor(uA); uB -= Math.floor(uB);
          if (uB <= uA) uB += 1;
          if (uB <= 1.00001) {
            ctx.drawImage(img, uA * IW, sTop, (uB - uA) * IW, bandH, cx + xA, dy, (xB - xA) || 0.5, dh);
          } else {
            const f = (1 - uA) / (uB - uA), xM = xA + (xB - xA) * f;
            ctx.drawImage(img, uA * IW, sTop, (1 - uA) * IW, bandH, cx + xA, dy, (xM - xA) || 0.5, dh);
            ctx.drawImage(img, 0, sTop, (uB - 1) * IW, bandH, cx + xM, dy, (xB - xM) || 0.5, dh);
          }
        }
      }
    } else {
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      g.addColorStop(0, fallbackColor || 'oklch(62% 0.05 235)');
      g.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, D, D);
    }
    // light from the upper-left
    const ux = -0.5, uy = -0.58, L = 0, S = D;
    let gg = ctx.createRadialGradient(cx + ux * r * 0.35, cy + uy * r * 0.35, r * 0.15, cx, cy, r * 1.02);
    gg.addColorStop(0, 'rgba(0,0,0,0)');
    gg.addColorStop(0.5, 'rgba(6,5,14,0.14)');
    gg.addColorStop(0.82, 'rgba(4,3,12,0.62)');
    gg.addColorStop(1, 'rgba(2,2,8,0.95)');
    ctx.fillStyle = gg; ctx.fillRect(L, L, S, S);
    gg = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    gg.addColorStop(0, 'rgba(0,0,0,0)');
    gg.addColorStop(0.85, 'rgba(0,0,0,0.14)');
    gg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = gg; ctx.fillRect(L, L, S, S);
    const sx = cx + ux * r * 0.4, sy = cy + uy * r * 0.4;
    gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.45);
    gg.addColorStop(0, 'rgba(255,252,242,0.42)');
    gg.addColorStop(1, 'rgba(255,252,242,0)');
    ctx.fillStyle = gg; ctx.fillRect(L, L, S, S);
    ctx.restore();
  }
};
