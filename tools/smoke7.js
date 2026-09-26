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

  await run(`c.startGame()`); await wait(1000);
  for(let i=0;i<8;i++){ if(!(await run(`return !!(s().story&&s().story.activeId)`))) break; await run(`c.storyChoose(0)`); await wait(150); }
  await run(`c.setState({ resources: Object.assign({}, s().resources, { CR: 400000, BM: 9000, WT: 12000 }) })`);
  const r = [];
  r.push(['ally fresh', await run(`return { strength: s().ally.strength, tech: s().ally.tech.length }`)]);

  let offersSeen = 0, allAccepted = true;
  for (let sol = 1; sol <= 44; sol++) {
    await run(`c.setState({ cycle: ${sol*24 - 1} })`); await wait(15);
    await run(`c._runEconomyTick()`); await wait(35);
    const active = await run(`return s().story && s().story.activeId`);
    if (active && /^__ally_/.test(active)) {
      offersSeen++;
      const before = await run(`return s().resources.CR`);
      const hint = await run(`return (rv().storyModal.choices[0]||{}).hint || ''`);
      const spk = await run(`return rv().storyModal.speakerName`);
      await run(`c.storyChoose(0)`); await wait(50);
      const pend = await run(`return s().ally.pendingOfferId`);
      r.push(['offer '+offersSeen+' (sol '+sol+')', { spk, hint, pendCleared: pend===null }]);
      if (pend !== null) allAccepted = false;
    } else if (active) { await run(`c.storyChoose(0)`); await wait(50); }
  }
  r.push(['ally @sol44', await run(`return {
    strength: s().ally.strength, buildings: s().ally.buildings, cr: s().ally.cr,
    tech: s().ally.tech, sectorsHeld: Ally.sectors(s()), sectorsClaimed: s().ally.sectorsClaimed,
    logTop: s().ally.log.slice(0,6).map(e=>'s'+e.sol+': '+e.text.ru)
  }`)]);
  r.push(['player sectorState', await run(`return s().sectorState`)]);
  r.push(['offersSeen', offersSeen, 'allAccepted', allAccepted]);

  await run(`c.openOverlay('diplomacy')`); await wait(700);
  r.push(['allyPanel', await run(`return { visible: rv().allyPanel.visible, standing: rv().allyPanel.standingLabel, strength: rv().allyPanel.strength, tech: rv().allyPanel.techLabel, research: rv().allyPanel.researchLabel, caps: rv().allyPanel.caps.map(x=>x.label), logLen: rv().allyPanel.log.length }`)]);
  await shot('ally-1-diplo');
  console.log(JSON.stringify({ r, errs }, null, 2));
  app.quit();
}));
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
