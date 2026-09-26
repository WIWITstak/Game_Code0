// Drive the game through its main screens, screenshot each, flag console errors.
//   npx electron tools/smoke2.js
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

    const steps = [
      ['01-launch', null],
      ['02-hud',        `c.startGame()`],
      ['03-build',      `c.setState({activePanel:'build'})`],
      ['04-city',       `c.togglePanel('city')`],
      ['05-trade',      `c.togglePanel('trade')`],
      ['06-fleet',      `c.togglePanel('fleet')`],
      ['07-tech',       `c.openOverlay('tech')`],
      ['08-diplomacy',  `c.openOverlay('diplomacy')`],
      ['09-codex',      `c.openOverlay('codex')`],
      ['10-map',        `c.closeOverlay(); c.openMap && c.openMap()`],
      ['11-system',     `c.openSystem && c.openSystem()`],
      ['12-notif',      `c.closeOverlay(); c.setState({notifOpen:true})`],
      ['13-menu',       `c.setState({menuOpen:true})`],
      ['14-back-hud',   `c.setState({menuOpen:false, notifOpen:false})`],
    ];

    const results = [];
    for (const [name, js] of steps) {
      const mark = errors.length;
      if (js) {
        await win.webContents.executeJavaScript(`(()=>{const c=window.__gameComponent; ${js}; return 1;})()`).catch((e) => errors.push('EXEC ' + name + ': ' + e));
        await wait(900);
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
      const probe = await win.webContents.executeJavaScript(`(()=>{const c=window.__gameComponent,s=c.state;return{
        launched:s.launched, panel:s.activePanel, overlay:s.activeOverlay,
        visiblePanels:[...document.querySelectorAll('#dc-root [data-if]')].filter(e=>!e.hidden).length,
        buttons:document.querySelectorAll('#dc-root button:not([hidden] button)').length
      };})()`).catch((e) => ({ err: String(e) }));
      results.push({ name, newErrors: errors.slice(mark), probe });
    }

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log('=== STEP REPORT ===');
    for (const r of results) {
      console.log('\n' + r.name, JSON.stringify(r.probe));
      r.newErrors.forEach((e) => console.log('   !! ' + e));
    }
    console.log('\n=== TOTAL ERRORS: ' + errors.length + ' ===');
    app.quit();
  });
});

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
