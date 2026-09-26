// Validate the oklch->rgb converter against Chrome's own oklch implementation:
// for every distinct oklch() in the backup, compare converter output to what
// the browser computes for the original string.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const conv = require('./convert-colors-lib');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<!doctype html><meta charset=utf8><body><canvas id=c width=4 height=4></canvas>');

  const backup = FILES().map((f) => fs.readFileSync(path.join(ROOT, '.color-backup', f), 'utf8')).join('\n');
  const distinct = [...new Set(backup.match(/oklch\([^)]*\)/gi) || [])];

  const rows = [];
  for (const s of distinct) {
    const mine = conv.convertOne(s);
    const browser = await win.webContents.executeJavaScript(
      `(() => { const cx=document.getElementById('c').getContext('2d');
        cx.clearRect(0,0,4,4); cx.fillStyle='#000'; cx.fillStyle=${JSON.stringify(s)};
        cx.fillRect(0,0,4,4); const d=cx.getImageData(1,1,1,1).data;
        return [d[0],d[1],d[2],+(d[3]/255).toFixed(3)]; })()`);
    rows.push({ s, mine, browser });
  }

  // parse "rgb(a) a b c / d" or "rgba(...)" and my "#rrggbb"/"rgba()"
  const parse = (str) => {
    if (str[0] === '#') { const h = str.slice(1); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16), 1]; }
    const m = str.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m[3] == null ? 1 : m[3]];
  };

  let worst = 0, worstRow = null, alphaBad = 0, over1 = 0, over2 = 0;
  for (const r of rows) {
    const a = parse(r.mine), b = r.browser; // b already [r,g,b,a]
    // canvas premultiplies; compare only when opaque-ish, else just note
    const d = Math.max(Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]), Math.abs(a[2]-b[2]));
    const da = Math.abs(a[3]-b[3]);
    if (da > 0.02) alphaBad++;
    if (a[3] > 0.98) { if (d > 1) over1++; if (d > 2) over2++; }
    if (a[3] > 0.98 && d > worst) { worst = d; worstRow = { ...r, delta: d }; }
  }
  console.log('distinct colours checked:', rows.length);
  console.log('opaque colours with channel delta >1 vs Chrome:', over1);
  console.log('opaque colours with channel delta >2 vs Chrome:', over2);
  console.log('worst opaque channel delta:', worst, JSON.stringify(worstRow));
  console.log('alpha mismatches (>0.02):', alphaBad);
  console.log('\nsamples:');
  rows.slice(0, 8).forEach((r) => console.log(`  ${r.s}  -> mine ${r.mine}  chrome rgb(${r.browser.slice(0,3)}) a${r.browser[3]}`));
  app.quit();
});

function FILES() { return ['styles.css', 'index.html', 'game.js', 'game-data.js']; }
