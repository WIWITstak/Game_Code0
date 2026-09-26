// Replace every static oklch(...) literal with its sRGB equivalent
// (#rrggbb, or rgba(...) with alpha). Reads from .color-backup/ (the pristine
// pre-conversion copies) and writes the working files, so it is re-runnable.
//
//   node tools/convert-colors.js
'use strict';
const fs = require('fs');
const path = require('path');
const { convertOne } = require('./convert-colors-lib');

const ROOT = path.join(__dirname, '..');
const FILES = ['styles.css', 'index.html', 'game.js', 'game-data.js'];
const RE = /oklch\([^)]*\)/gi;

const cache = new Map();
let total = 0;
const failed = new Set();

for (const rel of FILES) {
  const srcPath = path.join(ROOT, '.color-backup', rel);
  const dstPath = path.join(ROOT, rel);
  const src = fs.readFileSync(fs.existsSync(srcPath) ? srcPath : dstPath, 'utf8');
  let n = 0;
  const out = src.replace(RE, (match) => {
    if (!cache.has(match)) cache.set(match, convertOne(match));
    const v = cache.get(match);
    if (v == null) { failed.add(match); return match; }
    n++; return v;
  });
  fs.writeFileSync(dstPath, out, 'utf8');
  console.log(`${rel}: ${n} replaced`);
  total += n;
}
console.log(`\ntotal ${total}, ${cache.size} distinct`);
if (failed.size) { console.log('UNPARSED:'); failed.forEach((f) => console.log('  ' + f)); }
