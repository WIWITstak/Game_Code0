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
    win.webContents.on('console-message', (_e, l, m, ln, src) => { if (l >= 2 && !IGNORE.test(m)) errors.push('[' + (src || '').split('/').pop() + ':' + ln + '] ' + m); });
    await win.loadURL('http://127.0.0.1:' + port + '/');
    await wait(5000);

    const run = (js) => win.webContents.executeJavaScript(`(()=>{const c=window.__gameComponent,s=()=>c.state,rv=()=>c.renderVals(); ${js}})()`).catch((e) => ({ err: String(e) }));
    const shot = async (n) => fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG());
    const dump = () => run(`return { active:s().story.activeId, node:s().story.node, open:rv().storyModal.open,
      speaker:rv().storyModal.speakerName, nChoices:rv().storyModal.choices.length,
      choice0:(rv().storyModal.choices[0]||{}).label, cycle:s().cycle,
      cr:s().resources.CR, wt:s().resources.WT, azure:(s().diploRelations||{}).azure, flags:s().story.flags }`);

    const log = [];
    await run(`c.beginNewGame(); c.setGameSpeed(4)`); await wait(900);
    log.push(['open', await dump()]);
    await shot('story-1-open');

    await run(`c.storyChoose(0)`); await wait(600);          // a -> b
    log.push(['node b', await dump()]);
    await shot('story-2-choices');

    await run(`c.storyChoose(1)`); await wait(600);          // b -> c_bold (choice 1)
    log.push(['picked bold', await dump()]);

    // modal still open (c_bold, end) — sim must stay frozen
    const cA = (await dump()).cycle; await wait(2500); const cB = (await dump()).cycle;
    log.push(['frozen while open?', { cycleBefore: cA, cycleAfter: cB, delta: cB - cA }]);
    await shot('story-3-final-node');

    await run(`c.storyChoose(0)`); await wait(600);          // close
    log.push(['closed', await dump()]);
    await shot('story-4-closed');

    // now sim should run
    const cC = (await dump()).cycle; await wait(3000); const cD = (await dump()).cycle;
    log.push(['runs after close?', { before: cC, after: cD, delta: cD - cC }]);

    console.log(JSON.stringify({ log, errors }, null, 2));
    app.quit();
  });
});
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
