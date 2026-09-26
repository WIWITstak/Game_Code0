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
  const clearStory = async () => { for(let i=0;i<10;i++){ if(!(await run(`return !!(s().story&&s().story.activeId)`))) break; await run(`c.storyChoose(0)`); await wait(250);} };

  await run(`c.startGame()`); await wait(1000); await clearStory();
  // give plenty of CR + a couple Colony Ships for testing
  await run(`c.setState({ resources: Object.assign({}, s().resources, { CR: 200000 }), fleets: s().fleets.concat([{id:'test_cs',name:'Colony Ship',type:'Colony Ship',count:3,status:'Docked'}]) })`);
  await wait(300);

  const r = [];
  await run(`c.openMap()`); await wait(600);
  await shot('sec-1-map');
  r.push(['map open', await run(`return { overlay:s().activeOverlay, nSectors: rv().mapSectors.length }`)]);

  await run(`c.selectSector('s07')`); await wait(500);
  r.push(['selected s07', await run(`return { sel:s().sectorSel, panel: rv().mapSectorPanel.statusLabel, revealed: rv().mapSectorPanel.revealed, showUnknown: rv().mapSectorPanel.showUnknown, act: (rv().mapSectorPanel.actions[0]||{}).label }`)]);
  await shot('sec-2-selected');

  const crBefore = await run(`return s().resources.CR`);
  await run(`c.scoutSector('s07')`); await wait(500);
  r.push(['scouted s07', await run(`return { status: c.sectorStatus('s07'), crSpent: ${crBefore} - s().resources.CR, hasDeposits: rv().mapSectorPanel.hasDeposits, depos: rv().mapSectorPanel.depoSummary.map(d=>d.label+d.count) }`)]);
  await shot('sec-3-scouted');

  await run(`c.selectSector('s07'); c.selectSector('s07')`); await wait(100); await run(`c.selectSector('s07')`); await wait(300);
  const cr2 = await run(`return s().resources.CR`); const ships0 = await run(`return Economy.fleetCount(s().fleets,'Colony Ship')`);
  await run(`c.claimSector('s07')`); await wait(500);
  r.push(['claimed s07', await run(`return { status: c.sectorStatus('s07'), crSpent: ${cr2} - s().resources.CR, shipsSpent: ${ships0} - Economy.fleetCount(s().fleets,'Colony Ship'), showTabs: rv().showRegionTabs, tabs: rv().regionTabs.map(t=>t.label) }`)]);
  await shot('sec-4-claimed');

  await run(`c.focusSector('s07')`); await wait(600);
  r.push(['focused s07', await run(`return { region: s().activeRegion, overlay: s().activeOverlay, viewportDeposits: rv().deposits.map(d=>d.label) }`)]);
  await shot('sec-5-building-in-sector');

  // AI sector
  await run(`c.setRegion('luna'); c.openMap(); c.selectSector('s13')`); await wait(500);
  r.push(['s13 (AI)', await run(`return { status: c.sectorStatus('s13'), label: rv().mapSectorPanel.statusLabel, note: !!rv().mapSectorPanel.note, revealed: rv().mapSectorPanel.revealed, act: (rv().mapSectorPanel.actions[0]||{}).label }`)]);
  await shot('sec-6-ai-sector');
  await run(`c.claimSector('s13')`); await wait(500);
  r.push(['retook s13', await run(`return { status: c.sectorStatus('s13'), owned: rv().mapSectors.filter(x=>x.statusLabel && x.id!=='s12').map(x=>x.id+':'+x.statusLabel) }`)]);

  console.log(JSON.stringify({ r, errs }, null, 2));
  app.quit();
}));
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
