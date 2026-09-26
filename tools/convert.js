// One-shot: run the browser-side template converter inside a hidden Electron
// window (we need real SVG-aware HTML parsing + DOMParser), write the result.
//
//   npx electron tools/convert.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><body>x</body>');

  // The live index.html is already converted; the legacy <x-dc> template only
  // survives in the pre-migration backup.
  const src = fs.readFileSync(path.join(ROOT, '.dc-backup', 'index.html'), 'utf8');
  const m = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/);
  if (!m) { console.error('no <x-dc> block found in .dc-backup/index.html'); app.exit(1); return; }

  const converter = fs.readFileSync(path.join(__dirname, 'converter-browser.js'), 'utf8');

  const out = await win.webContents.executeJavaScript(
    converter + '\n;(' + '() => { const html = __convert(' + JSON.stringify(m[1]) +
    '); return JSON.stringify({ html, warnings: window.__warnings || [] }); }' + ')();'
  );

  const { html, warnings } = JSON.parse(out);
  fs.writeFileSync(path.join(__dirname, 'converted-markup.html'), html, 'utf8');
  console.log('wrote tools/converted-markup.html (' + html.length + ' chars)');
  if (warnings.length) {
    console.log('\nWARNINGS (' + warnings.length + '):');
    warnings.forEach((w) => console.log('  - ' + w));
  } else {
    console.log('no warnings');
  }
  app.quit();
});
