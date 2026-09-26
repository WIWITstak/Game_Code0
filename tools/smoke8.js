'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const server = require('../server');
const OUT = path.join(__dirname, 'smoke'); fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch('disable-http-cache');
const IGN = /Insecure Content-Security-Policy|Electron Security Warning/;
app.whenReady().then(() => server.start(0, async (port) => {
  const win = new BrowserWindow({ show:false, width:1600, height:900, webPreferences:{ backgroundThrottling:false } });
  win.showInactive();
  const errs = [];
  win.webContents.on('console-message', (_e,l,m,ln,src)=>{ if(l>=2 && !IGN.test(m)) errs.push('['+(src||'').split('/').pop()+':'+ln+'] '+m); });
  await win.loadURL('http://127.0.0.1:'+port+'/'); await wait(5000);
  const run = (js)=>win.webContents.executeJavaScript(`(()=>{const c=window.__gameComponent,s=()=>c.state,rv=()=>c.renderVals(); ${js}})()`).catch(e=>({err:String(e)}));
  const shot = async (n)=>fs.writeFileSync(path.join(OUT,n+'.png'), (await win.webContents.capturePage()).toPNG());
  const clearDlg = async () => { for(let i=0;i<10;i++){ if(!(await run(`return !!(s().story&&s().story.activeId)`))) break; await run(`c.storyChoose(0)`); await wait(200);} };

  await run(`c.startGame()`); await wait(1000); await clearDlg();
  await run(`c.setState({ resources: Object.assign({}, s().resources, { CR: 300000 }) })`);
  const r = [];

  // s11 is allied by default (Azure) -> visit it right away
  await run(`c.openMap(); c.selectSector('s11')`); await wait(500);
  r.push(['s11 panel', await run(`return { status: c.sectorStatus('s11'), actions: rv().mapSectorPanel.actions.map(a=>a.label), revealed: rv().mapSectorPanel.revealed, hasDeposits: rv().mapSectorPanel.hasDeposits }`)]);
  await run(`c.focusSector('s11')`); await wait(600);
  r.push(['visiting s11', await run(`return {
    region: s().activeRegion, isBuildPanel: rv().isBuildPanel, banner: (({onLeave,...b})=>b)(rv().foreignBanner),
    nForeignBuildings: rv().foreignBuildings.length, activePanel: s().activePanel
  }`)]);
  await shot('foreign-1-ally-sector');

  // try to build while foreign -- should be refused
  await run(`c.togglePanel('build')`); await wait(300);
  r.push(['build blocked in ally territory', await run(`return { activePanel: s().activePanel, isBuildPanel: rv().isBuildPanel }`)]);
  await run(`c.selectShelfItem('habitation', SHELF_ITEMS.habitation[0])`); await wait(200);
  r.push(['selectShelfItem no-op', await run(`return { placing: s().placing }`)]);

  // leave via banner
  await run(`c.sectorReturnHome()`); await wait(400);
  r.push(['returned home', await run(`return { region: s().activeRegion, isBuildPanel: rv().isBuildPanel }`)]);

  // rival sector s13
  await run(`c.openMap(); c.selectSector('s13')`); await wait(400);
  r.push(['s13 panel', await run(`return { status: c.sectorStatus('s13'), actions: rv().mapSectorPanel.actions.map(a=>({l:a.label,d:a.disabled})) }`)]);
  await run(`c.focusSector('s13')`); await wait(600);
  r.push(['visiting s13', await run(`return {
    region: s().activeRegion, banner: (({onLeave,...b})=>b)(rv().foreignBanner), nForeignBuildings: rv().foreignBuildings.length,
    deposits: rv().deposits.map(d=>d.label)
  }`)]);
  await shot('foreign-2-rival-sector');
  await run(`c.startDemolish()`); await wait(200);
  r.push(['startDemolish no-op in rival territory', await run(`return { placing: s().placing }`)]);

  await run(`c.sectorReturnHome()`); await wait(300);

  console.log(JSON.stringify({ r, errs }, null, 2));
  app.quit();
}));
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
