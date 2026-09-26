// Interaction smoke: hover popups, placement arming, drag-pan, keyboard.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const server = require('../server');

const OUT = path.join(__dirname, 'smoke');
fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch('disable-http-cache');
const IGNORE = /Insecure Content-Security-Policy|Electron Security Warning/;

app.whenReady().then(() => {
  server.start(0, async (port) => {
    const win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { backgroundThrottling: false } });
    win.showInactive();
    const errors = [];
    win.webContents.on('console-message', (_e, level, message, line, src) => {
      if (level >= 2 && !IGNORE.test(message)) errors.push('[' + (src || '').split('/').pop() + ':' + line + '] ' + message);
    });

    await win.loadURL('http://127.0.0.1:' + port + '/');
    await wait(5000);

    const run = (js) => win.webContents.executeJavaScript(`(()=>{const c=window.__gameComponent,s=()=>c.state; ${js}})()`).catch((e) => { errors.push('EXEC: ' + e); return { err: String(e) }; });
    const shot = async (n) => fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG());

    await run(`c.startGame()`); await wait(1000);

    // 1) hover a resource chip -> popup  (chips sit in the top bar around y=25)
    const hover = await run(`
      const chip = document.elementFromPoint(650, 25);
      const target = chip && chip.closest('div');
      target && target.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
      return { at: chip && chip.tagName, resHover: s().resHover };
    `);
    await wait(500); await shot('int-1-reshover');

    // 2) arm a building for placement
    const place = await run(`
      c.dispatchEvent && 0;
      const cat = 'habitation';
      c.selectShelfItem(cat, SHELF_ITEMS[cat][0]);
      return { placing: s().placing && s().placing.mono };
    `);
    await wait(400); await shot('int-2-armed');

    // 3) pointer drag-pan across the viewport (events bubble to the viewport listener)
    const pan = await run(`
      c.cancelPlace && c.cancelPlace();
      const before = { x: s().buildPanX, y: s().buildPanY };
      function pe(t, x, y){ const el = document.elementFromPoint(x,y); el && el.dispatchEvent(new PointerEvent(t, {bubbles:true, clientX:x, clientY:y, pointerId:1, button:0})); }
      pe('pointerdown', 500, 300);
      pe('pointermove', 560, 360);
      pe('pointermove', 640, 420);
      pe('pointerup', 640, 420);
      return { before, after: { x: s().buildPanX, y: s().buildPanY } };
    `);
    await wait(300); await shot('int-3-panned');

    // 4) keyboard: space to pause, '2' speed
    const kb = await run(`
      document.dispatchEvent(new KeyboardEvent('keydown', {key:' ', code:'Space', bubbles:true}));
      const paused = s().gamePaused;
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'2', code:'Digit2', bubbles:true}));
      document.dispatchEvent(new KeyboardEvent('keydown', {key:' ', code:'Space', bubbles:true}));
      return { paused, speed: s().gameSpeed };
    `);

    // 5) let the sim tick a few times, confirm HUD numbers move
    const t0 = await run(`return { cr: s().resources.CR, cycle: s().cycle }`);
    await run(`c.setGameSpeed(4)`);
    await wait(6000);
    const t1 = await run(`return { cr: s().resources.CR, cycle: s().cycle }`);
    await shot('int-4-after-ticks');

    console.log(JSON.stringify({ hover, place, pan, kb, t0, t1, errors }, null, 2));
    app.quit();
  });
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
