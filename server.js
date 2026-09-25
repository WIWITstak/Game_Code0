// Minimal static file server — zero dependencies, just Node's built-ins.
// Needed because WebGL refuses to upload local file:// images as textures
// (texImage2D throws "cross-origin data" — every file:// URL is its own
// origin to the browser, so there's no way around it from the page itself),
// and the DC runtime (support.js) does fetch(location.href), which file://
// also blocks. Serving over http://127.0.0.1 fixes both.
//
// Used two ways:
//   node server.js            -> dev server on :8080, opens nothing
//   require('./server.js')    -> { start(port?, cb) } for the Electron shell
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

function createServer() {
  return http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        // never let Chromium serve a stale index.html / script — this is a
        // local dev server, there is nothing to gain from caching
        'Cache-Control': 'no-store, must-revalidate'
      });
      res.end(data);
    });
  });
}

// Start listening. port 0 -> OS picks a free port. cb(actualPort).
function start(port, cb) {
  const srv = createServer();
  srv.listen(port || 0, '127.0.0.1', () => {
    const actual = srv.address().port;
    if (cb) cb(actual, srv);
  });
  return srv;
}

module.exports = { start, createServer };

// Direct run: classic dev server on 8080.
if (require.main === module) {
  start(8080, (p) => {
    console.log('MARS: AWAKENING — serving ' + ROOT);
    console.log('Open http://127.0.0.1:' + p + '/ in your browser.');
    console.log('Press Ctrl+C to stop.');
  });
}
