// Boot the game in Electron, collect console output + errors, screenshot.
//   npx electron tools/smoke.js [url]
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const server = require('../server');

const OUT = path.join(__dirname, 'smoke');
fs.mkdirSync(OUT, { recursive: true });

app.commandLine.appendSwitch('disable-http-cache');

app.whenReady().then(() => {
  server.start(0, async (port) => {
    const url = process.argv[2] || ('http://127.0.0.1:' + port + '/');
    const win = new BrowserWindow({
      show: false, width: 1600, height: 900,
      webPreferences: { backgroundThrottling: false }
    });
    const logs = [];
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const tag = ['LOG', 'WARN', 'ERROR', 'INFO'][level] || level;
      logs.push(tag + ': ' + message + (sourceId ? '  (' + sourceId.split('/').pop() + ':' + line + ')' : ''));
    });
    win.webContents.on('render-process-gone', (_e, d) => logs.push('RENDER GONE: ' + JSON.stringify(d)));
    win.webContents.on('unresponsive', () => logs.push('UNRESPONSIVE'));

    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, 6000));

    const probe = await win.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('dc-root');
      const comp = window.__gameComponent;
      return {
        rootKids: root ? root.childElementCount : -1,
        hasComp: !!comp,
        launched: comp && comp.state ? comp.state.launched : null,
        stageRef: !!(comp && comp.stageRef && comp.stageRef.current),
        audioRef: !!(comp && comp.audioRef && comp.audioRef.current),
        bodyText: (document.body.innerText || '').slice(0, 400),
        menuItems: document.querySelectorAll('#dc-root button').length,
        splash: !!document.getElementById('boot-splash')
      };
    })()`).catch((e) => ({ error: String(e) }));

    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'shot.png'), img.toPNG());
    fs.writeFileSync(path.join(OUT, 'console.txt'), logs.join('\n'), 'utf8');
    fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(probe, null, 2), 'utf8');

    console.log('--- PROBE ---');
    console.log(JSON.stringify(probe, null, 2));
    console.log('--- CONSOLE (' + logs.length + ' lines) ---');
    console.log(logs.join('\n'));
    app.quit();
  });
});
