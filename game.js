// Game logic for the strategy UI — extracted from index.html.
// The DC runtime (support.js) evaluates the inline <script data-dc-script> with
// (DCLogic, StreamableLogic, React) in scope; that one-liner calls this factory
// and returns the Component class. Data constants and I18N strings live in
// game-data.js / game-i18n.js (loaded before this file, same global scope).
window.__defineGameComponent = function (DCLogic, React) {
  'use strict';

// The subset of state that actually represents game progress — used both as
// the component's initial state and to reset everything on "New Game"
// (matches SaveSystem.FIELDS, which is what gets written to a save slot).
function freshColonyState() {
  return {
    colonyNameOverride: null,
    techOverride: {},
    selectedTechId: 't1a',
    // Research is pure flow: RP never stockpiles, it funds the head of this
    // queue each tick (Economy.runTick). researchProgress maps nodeId -> RP
    // banked so far. researchOutput is last tick's RP/cycle figure (display).
    researchQueue: [],
    researchProgress: {},
    researchOutput: 0,
    policyChoice: Object.assign({}, POLICY_DEFAULTS),
    tradeStatus: {},
    tradeAdded: [],
    diploRelations: {},
    diploTreaties: {},
    diploLog: [{ init: true }],
    sysFleetsHidden: false,
    // Copied from the static seed, then mutated by commission/disband —
    // Cargo Transports gate trade capacity, Naval Escorts blunt trade risk,
    // Reconnaissance drones fund a small research trickle (see Economy).
    fleets: FLEET_GROUPS.map(f => Object.assign({}, f)),
    placed: [
      { id: 'seed1', mono: 'HS', name: 'Habitat Spire', category: 'Habitation', col: 28, row: 11, x: 1710, y: 690 },
      { id: 'seed2', mono: 'AF', name: 'Algae Bioreactor', category: 'Ecology', col: 31, row: 13, x: 1890, y: 810 },
      { id: 'seed3', mono: 'WH', name: 'Warehouse', category: 'Logistics', kind: 'warehouse', col: 26, row: 13, x: 1590, y: 810 },
      // Algae Bioreactor is a chain building (needs Culture Stock -> Biomass)
      // — seeding its source connected means the starting colony is a real,
      // working chain from cycle one instead of silently stalling for lack
      // of input.
      { id: 'seed4', mono: 'KT', name: 'Algae Cultivator', category: 'Extraction', col: 33, row: 13, x: 2010, y: 810 },
      // Every colony starts with its Town Hall already standing (see
      // SHELF_ITEMS `unique` — a second one can never be built).
      { id: 'seed5', mono: 'TW', name: 'Town Hall', category: 'Public Works', col: 28, row: 13, x: 1710, y: 810 },
      // A tier-1 Landing Pad — colonists can only arrive through a spaceport,
      // so the seed colony ships with one already connected.
      { id: 'seed6', mono: 'LP', name: 'Landing Pad', category: 'Habitation', col: 30, row: 11, x: 1830, y: 690 }
    ],
    // Starter roads already connect the seed colony — new buildings need the
    // player to route their own roads/conveyors/pipes before they produce.
    links: [
      { id: 'lk_seed1', type: 'road', a: { col: 28, row: 11 }, b: { col: 26, row: 13 } },
      { id: 'lk_seed2', type: 'road', a: { col: 28, row: 11 }, b: { col: 31, row: 13 } },
      { id: 'lk_seed3', type: 'road', a: { col: 31, row: 13 }, b: { col: 33, row: 13 } },
      { id: 'lk_seed4', type: 'road', a: { col: 28, row: 11 }, b: { col: 28, row: 13 } },
      { id: 'lk_seed5', type: 'road', a: { col: 28, row: 11 }, b: { col: 30, row: 11 } }
    ],
    resources: { CR: 50000, OR: 1840, BM: 920, WT: 2600 },
    population: 10,
    cycle: 0,
    lastDeltas: { CR: 0, PO: 0 },
    // Fractional pop-growth pool (see Economy.runTick) and the arrival
    // notifications it produces once a sol — both real game progress, so
    // they survive save/load and reset with a new colony like everything
    // else in this function.
    popGrowthAccum: 0,
    colonyEvents: [],
    // П3: objective checklist progress + timed hazard effects in flight.
    objectivesDone: [],
    activeHazards: [],
    // Story: `seen` gates once-only dialogues, `flags` records the choices
    // made (branches future beats + is readable by other systems),
    // `activeId`/`node` = the dialogue currently shown (non-blocking panel).
    story: { seen: {}, flags: {}, activeId: null, node: null },
    // П4.3: surveyed bodies (id -> sol) and claimed outposts (id -> {level}).
    surveys: {},
    outposts: {},
    // Sectors: id -> 'scouted' | 'owned'. Absent = the SECTORS default status
    // (sectorStatus()). Scout an unexplored sector to reveal its deposits, then
    // claim it (CR + Colony Ship) to unlock it as a build region.
    sectorState: {},
    // Per-region build camera for every region except home ('luna' keeps
    // buildPanX/buildPanY). { belt:{x,y}, s07:{x,y}, ... }
    regionCam: {},
    // Ally AI (Azure Compact) — its own colony sim (game-ally.js).
    ally: (typeof Ally !== 'undefined') ? Ally.fresh() : null,
    // Haulers currently dispatched. The ceiling is Economy.haulerCapacity
    // (built-in base + every Hangar); assigned here on the warehouse panel.
    whMachines: 2
  };
}

// Turns an Economy.runTick() `arrival` breakdown ({ total, worker?,
// engineer?, scientist?, military?, dependents? }) into one localized
// notification line — same "count + plural noun" convention as
// buildShelfTooltip's staff-type rows (game-data.js), just listing every
// category this batch touched instead of one.
function formatArrivalText(arrival, t) {
  const tp = t.pop || {};
  const order = ['worker', 'engineer', 'scientist', 'military', 'dependents'];
  const parts = order.reduce((acc, key) => {
    if (arrival[key]) acc.push(fmtNum(arrival[key]) + ' ' + (tp[key] || key));
    return acc;
  }, []);
  const prefix = t.notifArrival || 'New settlers arrived';
  return prefix + ' (+' + fmtNum(arrival.total) + '): ' + parts.join(', ');
}

// Same shape for the runTick `casualties` breakdown ({ total, starve,
// dehydrate, emigrate }) — one localized "−N colonists lost" line naming
// whichever causes actually contributed.
function formatCasualtiesText(cas, t) {
  const cp = (t.casualty) || {};
  const parts = ['starve', 'dehydrate', 'emigrate'].reduce((acc, key) => {
    if (cas[key]) acc.push(fmtNum(cas[key]) + ' ' + (cp[key] || key));
    return acc;
  }, []);
  const prefix = t.notifCasualties || 'Colonists lost';
  return prefix + ' (−' + fmtNum(cas.total) + ')' + (parts.length ? ': ' + parts.join(', ') : '');
}

// A runTick `hazard` object -> one localized notification line.
function formatHazardText(hz, t) {
  const h = (t.hazard && t.hazard[hz.type]) || {};
  const base = h.name || hz.type;
  if (hz.type === 'storm') return base + ' — ' + (h.effect || 'solar output cut, production reduced');
  if (hz.type === 'breakdown') return base + ' — ' + (hz.targetName || '') + ' ' + (h.effect || 'crippled, needs repair');
  if (hz.type === 'raid') {
    if (hz.fizzled) return base + ' — ' + (h.fizzled || 'repelled by the garrison');
    if (hz.lostAmount > 0) return base + ' — ' + (h.effect || 'raiders took') + ' ' + fmtNum(hz.lostAmount) + ' ' + ((t.resName && t.resName[hz.lostCode]) || hz.lostCode || '');
    return base + ' — ' + (h.effectEmpty || 'raiders found nothing to take');
  }
  return base;
}

class Component extends DCLogic {
  stageRef = React.createRef();
  audioRef = React.createRef();
  marsCanvasRef = React.createRef();
  sysPanelCanvasRef = React.createRef();
  sysCanvasRef = React.createRef();
  // freshColonyState() supplies everything that's actual game progress
  // (placed/links/resources/population/tech/policy/trade/diplomacy/...);
  // everything here is UI/session state that a save never touches and "New
  // Game" doesn't need to reset via freshColonyState (it's already correct).
  state = Object.assign({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    launched: false,
    launchScreen: null,
    newGameName: 'Meridian',
    newGameDiff: 'standard',
    newGameSite: 'plain',
    prefReduceMotion: false,
    activeOverlay: null,
    activePanel: 'build',
    notifOpen: false,
    objectivesOpen: false,
    codexLoc: 'moon',
    resHover: null,
    menuOpen: false,
    selectedBuilding: {
      name:'Habitat Spire', category:'Habitation', hasProduction:false,
      inputs:[], output:{mono:'',current:0}, efficiency:0,
      upkeep:'-12 CR', durability:96, energyUse:'-2 PW', health:100
    },
    techFilter: 'All',
    techTab: 'tree',
    tradeSel: null,
    tradeNewOpen: false,
    tradeNewDest: null,
    tradeNewCargo: null,
    diploTab: 'azure',
    lang: 'ru',
    activeChain: null,
    chainSelected: 'building',
    buildCategory: 'habitation',
    buildingPanelOpen: false,
    connectorStart: null,
    buildPanX: -750,
    buildPanY: -150,
    // P4.2 — which build region the viewport shows. Belt gets its own camera.
    activeRegion: 'luna',
    beltPanX: -750,
    beltPanY: -150,
    sectorSel: null,          // sector id selected on the sector map
    placing: null,
    placeHover: null,
    demolishHover: null,
    actionError: null,
    shelfHover: null,
    selectedPlacedId: null,
    moduleMenuOpen: false,
    placingModule: null,
    placedHover: null,
    // Colony sim clock — 1 economy cycle every 4s at ×1; the fast-forward
    // control scales that. `gamePaused` freezes it entirely.
    gameSpeed: 1,
    gamePaused: false,
    whMachines: 2,
    musicPlaying: false,
    musicTrack: 0,
    musicPos: 0,
    musicDur: 0,
    musicVol: 0.7,
    mapZoom: 0.9,
    mapPanX: 0,
    mapPanY: 0,
    mapDragging: false,
    mapPlanet: false,
    planetYaw: 0,
    planetPitch: -8,
    planetRoll: 0,
    systemSel: 'luna',
    systemT: 0,
    systemSpeed: 1,
    systemPaused: false,
    selectedFleetId: null,
    policyRenewable: true,
    policyOvertime: false
  }, freshColonyState());

  componentDidMount() {
    this.updateScale();
    this._ro = new ResizeObserver(() => this.updateScale());
    if (this.stageRef.current) this._ro.observe(this.stageRef.current);
    window.addEventListener('resize', this.updateScale);
    // Safety net: don't rely solely on the 4s autosave tick if the tab/app
    // closes right before one lands.
    this._onBeforeUnload = () => { if (this.state.launched) SaveSystem.save('auto', this.state); };
    window.addEventListener('beforeunload', this._onBeforeUnload);
    this._reduceMotion = false;
    try { this._reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (this._reduceMotion) this.setState({ systemPaused: true });
    // One clock drives both the render loop and the colony sim. The sim
    // advances an economy cycle every 4000ms of *game* time; `gameSpeed`
    // scales real -> game time and `gamePaused` stops it.
    this._econAccum = 0;
    this._spin = setInterval(() => {
      const s = this.state;
      // Cheap frame while the window is backgrounded — skip the heavy 3D render
      // but keep the sim + input alive. (Fully bailing here froze the game when
      // the Electron window opened without foreground focus.)
      const bg = typeof document !== 'undefined' && document.hidden;
      // Story dialogues are non-blocking — the sim keeps running behind them.
      if (s.launched && !s.gamePaused) {
        this._econAccum += 40 * (s.gameSpeed || 1);
        let guard = 0;
        while (this._econAccum >= 4000 && guard++ < 8) {
          this._econAccum -= 4000;
          this._runEconomyTick(() => {
            // autosave at most every few real seconds, not every fast-forward cycle
            const now = Date.now();
            if (now - (this._lastAutosave || 0) >= 3000) { this._lastAutosave = now; SaveSystem.save('auto', this.state); }
          });
        }
      }
      // WASD pan of the build viewport (held keys)
      if (this._keysDown && this._keysDown.size && s.launched && !s.activeOverlay && !s.menuOpen) {
        const step = 16;
        let dx = 0, dy = 0;
        if (this._keysDown.has('a')) dx += step;
        if (this._keysDown.has('d')) dx -= step;
        if (this._keysDown.has('w')) dy += step;
        if (this._keysDown.has('s')) dy -= step;
        if (dx || dy) this.setState(st => this._panPatch(
          this._clampBuildPanX(this._curPanX() + dx),
          this._clampBuildPanY(this._curPanY() + dy)
        ));
      }
      const planetView = s.mapPlanet && s.activeOverlay === 'map';
      if (planetView && !this._mapDrag && !this._reduceMotion) this.setState(st => ({ planetYaw: (st.planetYaw || 0) + 0.16 }));
      // Both 3D scenes are init'd once (warmed at boot by game-preload.js) and
      // never disposed on close — opening an overlay just re-parents the live
      // canvas into it, so textures/shaders are already resident (no pop-in).
      if (planetView) {
        if (!this._globe3dReady) { PlanetGlobe3D.init(); this._globe3dReady = true; }
        if (this.marsCanvasRef.current && !this._globeMounted) { PlanetGlobe3D.mount(this.marsCanvasRef.current); this._globeMounted = true; }
        if (!bg) PlanetGlobe3D.render(s.planetYaw || 0, s.planetPitch || 0);
      } else if (this._globeMounted) {
        PlanetGlobe3D.unmount();
        this._globeMounted = false;
      }
      if (s.activeOverlay === 'system') {
        if (!this._sys3dReady) {
          SolarSystem3D.init(null, (id) => this.selectSystemPlanet(id));
          this._sys3dReady = true;
          this._sysT = s.systemT || 0;
          this._sysFrame = 0;
        }
        if (this.sysCanvasRef.current && !this._sysMounted) { SolarSystem3D.mount(this.sysCanvasRef.current); this._sysMounted = true; }
        this._sysFrame = (this._sysFrame || 0) + 1;
        // The info-panel sphere is a ~1.8k-drawImage software raster — fine
        // at a few fps, wasteful every frame beside the WebGL scene.
        if (!bg && this._sysFrame % 3 === 0) this._drawPanelSphere();
        const spd = s.systemPaused ? 0 : (s.systemSpeed || 1);
        if (spd) this._sysT = (this._sysT || 0) + spd;
        // Hand the live clock straight to the renderer; only sync it back to
        // React ~1x/sec so the date HUD updates without a full renderVals()
        // + template reconcile on every single frame.
        if (!bg) SolarSystem3D.render(s, this._sysT);
        if (spd && this._sysFrame % 25 === 0) this.setState({ systemT: this._sysT });
      } else if (this._sysMounted) {
        // Flush the last un-synced clock value so save/HUD stay accurate.
        if (this._sysT != null && this._sysT !== this.state.systemT) this.setState({ systemT: this._sysT });
        SolarSystem3D.unmount();
        this._sysMounted = false;
      }
    }, 40);
    const a = this.audioRef.current;
    if (a) {
      a.src = TRACKS[this.state.musicTrack].file; a.volume = this.state.musicVol; a.load();
      // Try to start the main-menu music straight away; browsers that block
      // autoplay-with-sound reject the promise, so fall back to starting on
      // the visitor's first click/keypress anywhere on the page.
      const p = a.play();
      if (p && p.catch) p.catch(() => {
        const start = () => {
          document.removeEventListener('pointerdown', start);
          document.removeEventListener('keydown', start);
          const a2 = this.audioRef.current;
          if (a2 && a2.paused) { const p2 = a2.play(); if (p2 && p2.catch) p2.catch(() => {}); }
        };
        document.addEventListener('pointerdown', start, { once: true });
        document.addEventListener('keydown', start, { once: true });
      });
    }
    // UI click sounds: preload once, play a fresh clone per click so rapid
    // presses don't cut each other off. Delegated on the stage so every
    // <button> gets a sound with no per-button wiring; close/back controls
    // and a couple of primary CTAs (data-sfx="...") override the default.
    this._sfx = {};
    Object.keys(SFX).forEach(k => { const au = new Audio(SFX[k]); au.volume = 0.32; this._sfx[k] = au; });
    const stage = this.stageRef.current;
    if (stage) {
      this._onUiClick = (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.ov-close, .x-btn, [data-sfx="back"]')) { this._playSfx('back'); return; }
        if (t.closest('[data-sfx="confirm"]')) { this._playSfx('confirm'); return; }
        const btn = t.closest('button');
        if (btn && !btn.disabled) this._playSfx('click');
      };
      stage.addEventListener('click', this._onUiClick, true);
    }
    // Keyboard: Esc = menu, Space = pause, 1/2/3 = speed, WASD = pan the map
    // (held keys applied each frame in the _spin loop).
    this._keysDown = new Set();
    this._onKey = (e) => {
      if (!this.state.launched) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        this.setState(s => s.menuOpen
          ? { menuOpen: false }
          : { menuOpen: true, activeOverlay: null, activePanel: null, notifOpen: false });
        return;
      }
      if (this.state.activeOverlay || this.state.menuOpen) return;
      if (e.code === 'Space') { e.preventDefault(); this.setState(s => ({ gamePaused: !s.gamePaused })); }
      else if (e.key === '1') this.setGameSpeed(1);
      else if (e.key === '2') this.setGameSpeed(2);
      else if (e.key === '3') this.setGameSpeed(4);
      else { const k = e.key.toLowerCase(); if (k === 'w' || k === 'a' || k === 's' || k === 'd') this._keysDown.add(k); }
    };
    this._onKeyUp = (e) => this._keysDown.delete((e.key || '').toLowerCase());
    this._onBlurKeys = () => this._keysDown.clear();
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlurKeys);
    // The home-planet globe (SECTOR MAP -> planet view) is its own Three.js
    // scene now — PlanetGlobe3D, init/disposed from the _spin loop above. It
    // loads its own moon texture; nothing to preload here.
    // Info-panel: preload every planet / moon map for the rotating preview sphere
    this._bodyImgs = {};
    const _lb = (k, f) => { const im = new Image(); im.src = TEX_BASE + f; this._bodyImgs[k] = im; };
    Object.keys(SYS_TEX).forEach(k => _lb(k, SYS_TEX[k]));
    Object.keys(MOON_TEX).forEach(k => _lb(k, MOON_TEX[k]));
  }

  // The solar-system info-panel preview sphere is still a game-sphererender.js
  // software raster (cheap, runs a few fps beside the WebGL scene). The big
  // home-planet globe moved to Three.js — see PlanetGlobe3D.
  _drawPanelSphere() {
    const cv = this.sysPanelCanvasRef.current;
    if (!cv) return;
    const ctx = (this._panelCtx && this._panelCtx.canvas === cv) ? this._panelCtx : (this._panelCtx = cv.getContext('2d'));
    SphereRender.drawInfoSphere(ctx, cv.width, this._bodyImgs[this._panelKey], this._panelColor);
  }
  _playSfx(name) {
    const src = this._sfx && this._sfx[name];
    if (!src) return;
    try {
      const node = src.cloneNode(true);
      node.volume = src.volume;
      const p = node.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
  componentWillUnmount() {
    if (this._ro) this._ro.disconnect();
    window.removeEventListener('resize', this.updateScale);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    clearInterval(this._spin);
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    if (this._onKeyUp) document.removeEventListener('keyup', this._onKeyUp);
    if (this._onBlurKeys) window.removeEventListener('blur', this._onBlurKeys);
    clearTimeout(this._actionErrTimer);
    try { SolarSystem3D.dispose(); } catch (e) {}
    try { PlanetGlobe3D.dispose(); } catch (e) {}
    this._sys3dReady = this._globe3dReady = this._sysMounted = this._globeMounted = false;
    if (this._onVolMove) {
      window.removeEventListener('pointermove', this._onVolMove);
      window.removeEventListener('pointerup', this._onVolUp);
    }
    if (this._onUiClick && this.stageRef.current) this.stageRef.current.removeEventListener('click', this._onUiClick, true);
    const a = this.audioRef.current;
    if (a) { try { a.pause(); } catch (e) {} }
  }

  _setVol(v) {
    v = Math.max(0, Math.min(1, v));
    this.setState({ musicVol: v });
    const a = this.audioRef.current;
    if (a) a.volume = v;
  }
  _volFromEvent = (ev) => {
    if (!this._volCenter) return;
    const dx = ev.clientX - this._volCenter.x;
    const dy = ev.clientY - this._volCenter.y;
    let ang = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (ang < -135) ang = -135;
    if (ang > 135) ang = 135;
    this._setVol((ang + 135) / 270);
  };
  volPointerDown = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    this._volCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this._onVolMove = (ev) => this._volFromEvent(ev);
    this._onVolUp = () => {
      window.removeEventListener('pointermove', this._onVolMove);
      window.removeEventListener('pointerup', this._onVolUp);
      this._onVolMove = null;
    };
    window.addEventListener('pointermove', this._onVolMove);
    window.addEventListener('pointerup', this._onVolUp);
    this._volFromEvent(e);
  };
  volWheel = (e) => {
    if (e.preventDefault) e.preventDefault();
    this._setVol((this.state.musicVol == null ? 0.7 : this.state.musicVol) + (e.deltaY < 0 ? 0.06 : -0.06));
  };

  _loadTrack(i, play) {
    const a = this.audioRef.current;
    this.setState({ musicTrack: i, musicPos: 0, musicDur: 0 }, () => {
      if (!a) return;
      a.src = TRACKS[i].file;
      a.load();
      if (play) { const p = a.play(); if (p && p.catch) p.catch(function () {}); }
    });
  }
  toggleMusic = () => {
    const a = this.audioRef.current;
    if (!a) return;
    if (!a.src) a.src = TRACKS[this.state.musicTrack].file;
    if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(function () {}); }
    else a.pause();
  };
  musicNext = () => this._loadTrack((this.state.musicTrack + 1) % TRACKS.length, this.state.musicPlaying);
  musicPrev = () => this._loadTrack((this.state.musicTrack + TRACKS.length - 1) % TRACKS.length, this.state.musicPlaying);
  onAudioTime = () => {
    const a = this.audioRef.current;
    if (!a) return;
    if (this._durFix) {
      this._durFix = false;
      if (a.duration && isFinite(a.duration)) this.setState({ musicDur: a.duration });
      try { a.currentTime = 0; } catch (e) {}
      return;
    }
    const patch = { musicPos: a.currentTime };
    if ((!this.state.musicDur || !isFinite(this.state.musicDur)) && a.duration && isFinite(a.duration)) patch.musicDur = a.duration;
    this.setState(patch);
  };
  onAudioMeta = () => {
    const a = this.audioRef.current;
    if (!a) return;
    if (a.duration && isFinite(a.duration)) { this.setState({ musicDur: a.duration }); return; }
    // Some MP3s report Infinity/NaN until the file is scanned — force it.
    this._durFix = true;
    try { a.currentTime = 1e7; } catch (e) {}
  };
  onAudioPlay = () => this.setState({ musicPlaying: true });
  onAudioPause = () => this.setState({ musicPlaying: false });
  onAudioDur = () => this.onAudioMeta();
  onAudioEnded = () => this._loadTrack((this.state.musicTrack + 1) % TRACKS.length, true);
  updateScale = () => {
    const el = this.stageRef.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(w / 1920, h / 1080);
    const offsetX = (w - 1920 * scale) / 2;
    const offsetY = (h - 1080 * scale) / 2;
    this.setState({ scale, offsetX, offsetY });
  };

  openOverlay(id) { this.setState({ activeOverlay: id, activePanel: null, notifOpen: false }); }
  closeOverlay = () => this.setState({ activeOverlay: null, mapPlanet: false });
  // "How to Play" opens from the pause menu, so it has to close the menu too.
  openHelp = () => this.setState({ menuOpen: false, activeOverlay: 'codex', activePanel: null, notifOpen: false });
  setCodexLoc = (id) => this.setState({ codexLoc: id });
  // Colony sim fast-forward. Speed 0 => pause; otherwise ×1/×2/×4.
  setGameSpeed = (n) => this.setState(n === 0 ? { gamePaused: true } : { gameSpeed: n, gamePaused: false });

  openMap = () => this.setState({ activeOverlay: 'map', activePanel: null, notifOpen: false, mapZoom: 0.3, mapPanX: 0, mapPanY: 0, mapDragging: false, mapPlanet: false, sectorSel: null });

  openSystem = () => this.setState({ activeOverlay: 'system', activePanel: null, notifOpen: false });
  selectSystemPlanet(id) { this.setState({ systemSel: id }); }

  // P4.3 — planetary colonisation.
  surveyBody = (id) => {
    const def = COLONISABLE[id];
    if (!def || (this.state.surveys || {})[id] != null) return;
    if ((this.state.resources.CR || 0) < def.surveyCost) { this._flashActionError('insufficient'); return; }
    this.setState(s => ({
      resources: Object.assign({}, s.resources, { CR: (s.resources.CR || 0) - def.surveyCost }),
      surveys: Object.assign({}, s.surveys, { [id]: s.cycle || 0 })
    }));
  };
  claimBody = (id) => {
    const def = COLONISABLE[id];
    const s = this.state;
    if (!def || (s.surveys || {})[id] == null || (s.outposts || {})[id]) return;
    if ((s.resources.CR || 0) < def.claimCost) { this._flashActionError('insufficient'); return; }
    if (Economy.fleetCount(s.fleets, 'Colony Ship') < 1) { this._flashActionError('noColonyShip'); return; }
    this.setState(st => {
      // spend one Colony Ship
      let spent = false;
      const fleets = st.fleets.map(f => {
        if (spent || f.type !== 'Colony Ship' || (f.count || 0) < 1) return f;
        spent = true;
        return Object.assign({}, f, { count: f.count - 1 });
      }).filter(f => (f.count || 0) > 0);
      return {
        resources: Object.assign({}, st.resources, { CR: (st.resources.CR || 0) - def.claimCost }),
        outposts: Object.assign({}, st.outposts, { [id]: { level: 1 } }),
        fleets
      };
    });
  };
  upgradeOutpost = (id) => {
    const def = COLONISABLE[id];
    const o = (this.state.outposts || {})[id];
    if (!def || !o || o.level >= 3) return;
    const cost = def.upgradeCost[o.level - 1] || 0;
    if ((this.state.resources.CR || 0) < cost) { this._flashActionError('insufficient'); return; }
    this.setState(s => ({
      resources: Object.assign({}, s.resources, { CR: (s.resources.CR || 0) - cost }),
      outposts: Object.assign({}, s.outposts, { [id]: { level: o.level + 1 } })
    }));
  };

  // --- Sectors ---------------------------------------------------------
  // Live status of a map sector: player progress overrides the SECTORS default.
  sectorStatus(id) {
    const st = (this.state.sectorState || {})[id];
    if (st) return st;
    const sc = SECTORS.find(x => x.id === id);
    return sc ? sc.status : 'unexplored';
  }
  selectSector = (id) => this.setState(s => ({ sectorSel: s.sectorSel === id ? null : id }));
  scoutSector = (id) => {
    if (this.sectorStatus(id) !== 'unexplored') return;
    if ((this.state.resources.CR || 0) < SECTOR_SCOUT_COST) { this._flashActionError('insufficient'); return; }
    this.setState(s => ({
      resources: Object.assign({}, s.resources, { CR: (s.resources.CR || 0) - SECTOR_SCOUT_COST }),
      sectorState: Object.assign({}, s.sectorState, { [id]: 'scouted' })
    }));
  };
  // The Azure "joint pressure" offer (game-ally.js) sets this flag — honour the
  // discount it promised rather than leaving it dead weight.
  _retakeCost() {
    const softened = this.state.story && this.state.story.flags && this.state.story.flags.s13Softened;
    return softened ? Math.round(SECTOR_RETAKE_COST / 2) : SECTOR_RETAKE_COST;
  }
  claimSector = (id) => {
    const cur = this.sectorStatus(id);
    const s = this.state;
    const ai = cur === 'ai';
    if (cur !== 'scouted' && !ai) return;
    const cost = ai ? this._retakeCost() : SECTOR_CLAIM_COST;
    if ((s.resources.CR || 0) < cost) { this._flashActionError('insufficient'); return; }
    if (Economy.fleetCount(s.fleets, 'Colony Ship') < 1) { this._flashActionError('noColonyShip'); return; }
    this.setState(st => {
      let spent = false;
      const fleets = st.fleets.map(f => {
        if (spent || f.type !== 'Colony Ship' || (f.count || 0) < 1) return f;
        spent = true; return Object.assign({}, f, { count: f.count - 1 });
      }).filter(f => (f.count || 0) > 0);
      return {
        resources: Object.assign({}, st.resources, { CR: (st.resources.CR || 0) - cost }),
        sectorState: Object.assign({}, st.sectorState, { [id]: 'owned' }),
        fleets
      };
    });
  };
  // "Move" to a sector and make it the active build region. Owned/home sectors
  // are yours to build in; allied/ai sectors open in read-only observation —
  // setRegion() already clears any armed tool, and togglePanel()/selectShelfItem()/
  // startDemolish() refuse to open the build shelf while _isForeignRegion().
  focusSector = (id) => {
    const st = this.sectorStatus(id);
    if (st !== 'owned' && st !== 'home' && st !== 'allied' && st !== 'ai') return;
    if (id === 's12') { this.setRegion('luna'); this.closeOverlay(); return; }
    this.setRegion(id);
    // Foreign territory has no build shelf — don't leave the rail's build
    // button looking pressed over a panel that isn't there.
    if (st === 'allied' || st === 'ai') this.setState({ activePanel: null });
    this.closeOverlay();
  };
  // True while the player is standing in a sector they don't own — build
  // tools are hidden/refused there, and a banner names the owner.
  _isForeignRegion() {
    const r = this.state.activeRegion;
    if (!r || r === 'luna' || r === 'belt') return false;
    const st = this.sectorStatus(r);
    return st === 'allied' || st === 'ai';
  }
  sectorReturnHome = () => this.setRegion('luna');
  // Deterministic flavor layout for a foreign sector's buildings — the ally
  // and the rival don't have a real placed[] of their own (their progress is
  // abstract: strength/buildings counters, see game-ally.js), so this just
  // gives visiting somewhere non-empty to look at, seeded on the sector id so
  // it doesn't reshuffle every render.
  _foreignLayout(sectorId, count, mono, color) {
    const g = BUILD_GRID;
    const used = new Set(ALL_DEPOSITS.filter(d => d.region === sectorId).map(d => d.col + ',' + d.row));
    let seed = 0;
    for (let i = 0; i < sectorId.length; i++) seed += sectorId.charCodeAt(i) * (i + 7);
    const rand = (n) => { const x = Math.sin(seed + n * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const out = [];
    for (let i = 0; i < count; i++) {
      let col, row, key, tries = 0;
      do {
        col = 6 + Math.floor(rand(i * 2 + 1) * (g.cols - 12));
        row = 4 + Math.floor(rand(i * 2 + 2) * (g.rows - 8));
        key = col + ',' + row;
        tries++;
      } while (used.has(key) && tries < 8);
      used.add(key);
      out.push({
        id: sectorId + '_fb' + i,
        leftPx: (col * g.cell + g.cell / 2) + 'px',
        topPx: (row * g.cell + g.cell / 2) + 'px',
        mono,
        color,
        bg: withAlpha(color, 0.22)
      });
    }
    return out;
  }
  // Camera is now Three.js's OrbitControls (drag/scroll handled natively by
  // it) — these just poke the scene module, which owns the actual camera.
  sysZoomIn = () => { if (this._sys3dReady) SolarSystem3D.dolly(1); };
  sysZoomOut = () => { if (this._sys3dReady) SolarSystem3D.dolly(-1); };
  sysResetCamera = () => { if (this._sys3dReady) SolarSystem3D.resetCamera(); };
  sysSpeed = (v) => this.setState({ systemSpeed: v, systemPaused: false });
  sysTogglePause = () => this.setState(s => ({ systemPaused: !s.systemPaused }));
  sysToggleFleets = () => this.setState(s => ({ sysFleetsHidden: !s.sysFleetsHidden }));

  _clampPan(v) { return Math.max(-4600, Math.min(4600, v)); }

  toggleMapScope = () => this.setState(s => {
    const global = (s.mapZoom || 0.9) > 0.45;
    return { mapZoom: global ? 0.16 : 0.9, mapPanX: 0, mapPanY: 0, mapDragging: false, mapPlanet: false };
  });

  togglePlanet = () => this.setState(s => ({ mapPlanet: !s.mapPlanet, mapZoom: 0.16, mapPanX: 0, mapPanY: 0, mapDragging: false, planetYaw: 0, planetPitch: -8, planetRoll: 0 }));

  mapZoomBy = (dir) => this.setState(s => {
    let z = (s.mapZoom || 0.9) * (dir > 0 ? 1.2 : 1 / 1.2);
    z = Math.max(0.12, Math.min(1.7, z));
    return { mapZoom: z, mapDragging: false };
  });
  mapZoomIn = () => this.mapZoomBy(1);
  mapZoomOut = () => this.mapZoomBy(-1);
  mapZoomReset = () => this.setState({ mapZoom: 0.9, mapPanX: 0, mapPanY: 0, mapDragging: false });

  mapWheel = (e) => {
    if (e.preventDefault) e.preventDefault();
    if (this.state.mapPlanet) return;
    this.mapZoomBy(e.deltaY > 0 ? -1 : 1);
  };
  mapPointerDown = (e) => {
    const s = this.state;
    this._mapDrag = {
      x: e.clientX, y: e.clientY, moved: false,
      px: s.mapPanX || 0, py: s.mapPanY || 0,
      yaw: s.planetYaw || 0, pitch: s.planetPitch || 0
    };
  };
  mapPointerMove = (e) => {
    if (!this._mapDrag) return;
    const dx = e.clientX - this._mapDrag.x, dy = e.clientY - this._mapDrag.y;
    if (!this._mapDrag.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) this._mapDrag.moved = true;
    if (this.state.mapPlanet) {
      this.setState({
        planetYaw: this._mapDrag.yaw + dx * 0.45,
        planetPitch: Math.max(-16, Math.min(16, this._mapDrag.pitch - dy * 0.4))
      });
      return;
    }
    const patch = {
      mapPanX: this._clampPan(this._mapDrag.px + dx),
      mapPanY: this._clampPan(this._mapDrag.py + dy)
    };
    if (this._mapDrag.moved) patch.mapDragging = true;
    this.setState(patch);
  };
  mapPointerUp = () => {
    this._mapDrag = null;
    if (this.state.mapDragging) this.setState({ mapDragging: false });
  };
  togglePanel(id) {
    if (id === 'build' && this._isForeignRegion()) return;   // read-only territory — no build shelf
    this.setState(s => {
      const opening = s.activePanel !== id;
      const patch = { activePanel: opening ? id : null, activeOverlay: null };
      // Build menu and the selected-building panel share the bottom-right slot.
      if (opening && id === 'build') { patch.selectedPlacedId = null; patch.buildingPanelOpen = false; }
      return patch;
    });
  }
  closePanel = () => this.setState({ activePanel: null });
  toggleNotif = () => this.setState(s => ({ notifOpen: !s.notifOpen }));
  toggleObjectives = () => this.setState(s => ({ objectivesOpen: !s.objectivesOpen }));
  toggleMenu = () => this.setState(s => ({ menuOpen: !s.menuOpen, notifOpen: false }));
  closeMenu = () => this.setState({ menuOpen: false });
  // "Continue" on the main menu resumes the autosave if one exists, else
  // just enters the still-fresh session state as-is.
  startGame = () => {
    const data = SaveSystem.load('auto');
    this.setState(Object.assign({}, data || {}, { launched: true, menuOpen: false }), this._maybeStartStory);
  };
  toMainMenu = () => this.setState({ launched: false, menuOpen: false, launchScreen: null, activeOverlay: null, activePanel: 'build' });
  openLaunchScreen = (id) => this.setState({ launchScreen: id });
  backLaunch = () => this.setState({ launchScreen: null });
  setNewGameName = (v) => this.setState({ newGameName: v });
  setNewGameDiff = (v) => this.setState({ newGameDiff: v });
  setNewGameSite = (v) => this.setState({ newGameSite: v });
  // Explicitly resets progress — ignores any autosave, unlike Continue.
  beginNewGame = () => this.setState(Object.assign({}, freshColonyState(), {
    colonyNameOverride: this.state.newGameName,
    launched: true, launchScreen: null, menuOpen: false
  }), this._maybeStartStory);
  loadSave = (slotId) => {
    const data = SaveSystem.load(slotId);
    if (!data) return;
    this.setState(Object.assign({}, data, { launched: true, launchScreen: null, menuOpen: false }), this._maybeStartStory);
  };

  // --- Story / dialogue -------------------------------------------------
  // Migrate an older save with no `story` field, then let Story.pick fire the
  // opening beat right on launch (rather than waiting for the first sol tick).
  _maybeStartStory = () => {
    const s = this.state;
    if (!s.launched || typeof Story === 'undefined') return;
    if (!s.story) { this.setState({ story: { seen: {}, flags: {}, activeId: null, node: null } }, this._maybeStartStory); return; }
    if (s.story.activeId) return;
    const hit = Story.pick(s);
    if (!hit) return;
    const d = Story.dialogue(hit);
    this.setState(st => ({ story: Object.assign({}, st.story, { activeId: hit, node: (d && d.start) || 'a' }) }));
  };
  // A choice was clicked (index into the current node's choices).
  storyChoose = (i) => {
    this.setState(prev => {
      const cur = prev.story;
      if (!cur || !cur.activeId) return null;
      const info = Story.node(cur.activeId, cur.node, prev.lang || 'ru', cur.flags);
      if (info && info.choices[i] && info.choices[i].locked) return null;
      const res = Story.applyChoice(prev, cur.activeId, cur.node, i);
      const story = Object.assign({}, cur);
      story.flags = Object.assign({}, cur.flags, res.flags);
      const isAlly = /^__ally_/.test(cur.activeId);
      if (res.nextNode) {
        story.node = res.nextNode;
      } else {
        if (!isAlly) story.seen = Object.assign({}, cur.seen, { [cur.activeId]: true });
        story.activeId = null;
        story.node = null;
      }
      const patch = Object.assign({}, res.patch, { story });
      // Ally offer resolved: free the dynamic dialogue + clear the pending flag,
      // and apply the ally-specific effects (sector hand-over).
      if (isAlly && !res.nextNode) {
        if (typeof Story !== 'undefined') Story.clearDynamic(cur.activeId);
        if (prev.ally) patch.ally = Object.assign({}, prev.ally, { pendingOfferId: null });
        const fx = res.effects || {};
        if (fx.sectorGrant) {
          patch.sectorState = Object.assign({}, patch.sectorState || prev.sectorState, { [fx.sectorGrant]: 'owned' });
          if (patch.ally) {
            patch.ally = Object.assign({}, patch.ally, { sectorsClaimed: (patch.ally.sectorsClaimed || []).filter(x => x !== fx.sectorGrant) });
          }
        }
      }
      return patch;
    }, () => { if (!this.state.story || !this.state.story.activeId) this._maybeStartStory(); });
  };
  // Manual save from the in-game pause menu always writes slot s1, kept
  // distinct from the "auto" slot Continue resumes.
  saveGame = () => { SaveSystem.save('s1', this.state); this.closeMenu(); };
  gotoLoadFromMenu = () => this.setState({ launched: false, menuOpen: false, launchScreen: 'load' });
  togglePrefReduceMotion = () => this.setState(s => { const v = !s.prefReduceMotion; this._reduceMotion = v; return { prefReduceMotion: v }; });

  selectShelfItem(catId, item) {
    if (this._isForeignRegion()) return;   // read-only territory
    const gate = TECH_UNLOCK_BUILDING[item.mono];
    if (gate && this.techStatus(gate) !== 'unlocked') { this._flashActionError('locked'); return; }
    if (item.connector) {
      this.setState({
        selectedPlacedId: null,
        moduleMenuOpen: false,
        activeChain: null,
        placing: { kind: 'connector', type: item.connector, mono: item.mono, name: item.name, category: 'Infrastructure', cost: item.cost || 0 },
        connectorStart: null
      });
      return;
    }
    const catLabel = BUILD_CATS.find(c => c.id === catId).label;
    const rate = item.rate || 0;
    const out = item.chain ? item.chain.outputMono : (item.out || '');
    this.setState({
      selectedPlacedId: null,
      moduleMenuOpen: false,
      selectedBuilding: {
        name: item.name, category: item.warehouse ? 'Logistics' : catLabel,
        kind: item.warehouse ? 'warehouse' : 'building',
        warehouseFor: item.warehouseFor || null,
        hasProduction: !item.warehouse && !!out,
        inputs: item.chain ? item.chain.sources.map(function(x){ return { mono:x.inputMono, current:0, needed:5 }; }) : [],
        output: { mono: out, current: rate, rate: rate },
        efficiency: item.warehouse ? 0 : 100,
        modules: [],
        upkeep: '-' + Math.max(1, Math.round(item.cost / 20)) + ' CR',
        durability: 100,
        energyUse: item.chain ? '-4 PW' : '-1 PW',
        health: 100
      },
      activeChain: item.chain ? Object.assign({ buildingMono: item.mono, buildingName: item.name, buildingCategory: catLabel, buildingCost: item.cost }, item.chain) : null,
      chainSelected: 'building',
      placing: item.chain ? null : { mono: item.mono, name: item.name, category: item.warehouse ? 'Logistics' : catLabel, kind: item.warehouse ? 'warehouse' : 'building', cost: item.cost || 0, unique: !!item.unique, depositBased: !!item.depositBased, depositType: item.depositType || null }
    });
  }

  cancelPlace = () => { clearTimeout(this._actionErrTimer); this.setState({ placing: null, placingModule: null, moduleMenuOpen: false, placeHover: null, connectorStart: null, actionError: null, demolishHover: null }); };

  // Simulation itself lives in game-economy.js (pure, no `this`) — this is
  // just the setInterval -> setState wiring, plus turning a sol-boundary
  // `arrival` batch into an actual notification (colony events are UI
  // concerns, not something the pure economy module should know about).
  _runEconomyTick = (afterUpdate) => this.setState(st => {
    const patch = Economy.runTick(st);
    const t = I18N[st.lang || 'ru'] || I18N.ru;
    let events = null;
    if (patch.arrival) {
      const evt = { text: formatArrivalText(patch.arrival, t), time: t.notifJustNow || 'just now', sev: 'info' };
      events = [evt].concat(st.colonyEvents || []);
    }
    if (patch.casualties) {
      const evt = { text: formatCasualtiesText(patch.casualties, t), time: t.notifJustNow || 'just now', sev: 'bad' };
      events = [evt].concat(events || st.colonyEvents || []);
    }
    if (patch.research) {
      const node = TECH_NODES.find(n => n.id === patch.research.id);
      const nm = (t.d && t.d.tech && t.d.tech[patch.research.id] && t.d.tech[patch.research.id].name) || patch.research.name;
      const evt = { text: (t.notifResearch || 'Research complete') + ': ' + nm, time: t.notifJustNow || 'just now', sev: 'info' };
      events = [evt].concat(events || st.colonyEvents || []);
    }
    if (patch.wearAlert) {
      const evt = { text: (t.notifWear || 'Buildings need maintenance') + ' (' + patch.wearAlert + ')', time: t.notifJustNow || 'just now', sev: 'bad' };
      events = [evt].concat(events || st.colonyEvents || []);
    }
    if (patch.objectivesJustDone) {
      patch.objectivesJustDone.forEach(od => {
        const on = (t.objectives && t.objectives[od.id]) || {};
        const rewardBits = ['+' + fmtNum(od.cr) + ' CR'];
        if (od.res) for (const k in od.res) rewardBits.push('+' + fmtNum(od.res[k]) + ' ' + k);
        const evt = { text: (t.notifObjective || 'Objective complete') + ': ' + (on.name || od.id) + ' (' + rewardBits.join(', ') + ')', time: t.notifJustNow || 'just now', sev: 'info' };
        events = [evt].concat(events || st.colonyEvents || []);
      });
    }
    if (patch.hazard) {
      events = [{ text: formatHazardText(patch.hazard, t), time: t.notifJustNow || 'just now', sev: patch.hazard.fizzled ? 'info' : 'bad' }].concat(events || st.colonyEvents || []);
    }
    delete patch.arrival;
    delete patch.casualties;
    delete patch.research;
    delete patch.wearAlert;
    delete patch.objectivesJustDone;
    delete patch.hazard;

    let story = st.story || { seen: {}, flags: {}, activeId: null, node: null };

    // --- Ally AI (Azure Compact) — one step per sol boundary --------------
    let allyOffer = null;
    const newCycle = patch.cycle != null ? patch.cycle : st.cycle;
    if (typeof Ally !== 'undefined' && Math.floor(newCycle / 24) > Math.floor((st.cycle || 0) / 24)) {
      const sol = Math.floor(newCycle / 24);
      const after = Object.assign({}, st, patch);
      let ar = null;
      try { ar = Ally.tick(after, sol); } catch (e) { console.error('Ally.tick:', e); }
      if (ar) {
        patch.ally = ar.ally;
        if (ar.scout) patch.sectorState = Object.assign({}, patch.sectorState || st.sectorState, { [ar.scout]: 'scouted' });
        if (ar.claim) patch.sectorState = Object.assign({}, patch.sectorState || st.sectorState, { [ar.claim]: 'allied' });
        if (ar.aid) {
          patch.resources = Object.assign({}, patch.resources || st.resources);
          for (const k in ar.aid) patch.resources[k] = Math.round((patch.resources[k] || 0) + ar.aid[k]);
        }
        (ar.events || []).forEach(ev => {
          const line = (ev.text && (ev.text[st.lang || 'ru'] || ev.text.ru)) || '';
          if (line) events = [{ text: line, time: t.notifJustNow || 'just now', sev: ev.kind === 'aid' ? 'info' : 'neutral' }].concat(events || st.colonyEvents || []);
        });
        if (ar.offer && !story.activeId) allyOffer = ar.offer;
      }
    }

    if (events) patch.colonyEvents = events.slice(0, 12);

    // An ally offer takes the dialogue panel if nothing is already showing.
    if (allyOffer && !story.activeId && typeof Story !== 'undefined') {
      Story.registerDynamic(allyOffer);
      story = Object.assign({}, story);
      patch.story = Object.assign({}, story, { activeId: allyOffer.id, node: 'a' });
    }

    // Story beats: check triggers against the post-tick state; if one fires,
    // show it in the non-blocking bottom-centre dialogue panel.
    if (!(patch.story || story).activeId && typeof Story !== 'undefined') {
      const after = Object.assign({}, st, patch);
      const hit = Story.pick(after);
      if (hit) {
        const d = Story.dialogue(hit);
        patch.story = Object.assign({}, story, { activeId: hit, node: d && d.start || 'a' });
      }
    }
    return patch;
  }, afterUpdate);

  _clampBuildPanX(v) { const min = Math.min(0, BUILD_VIEW.w - BUILD_GRID.cols * BUILD_GRID.cell); return Math.max(min, Math.min(0, v)); }
  _clampBuildPanY(v) { const min = Math.min(0, BUILD_VIEW.h - BUILD_GRID.rows * BUILD_GRID.cell); return Math.max(min, Math.min(0, v)); }

  // --- Build region (P4.2) — Luna vs the asteroid belt. One grid, one shared
  // economy; buildings/links/deposits carry `region` and the viewport filters.
  _isBelt() { return this.state.activeRegion === 'belt'; }
  // Camera: 'luna' (home) uses buildPanX/Y; every other region (belt + owned
  // sectors) lives in the regionCam map. Legacy belt saves carry beltPanX/Y.
  _regionCamGet(axis) {
    const r = this.state.activeRegion || 'luna';
    if (r === 'luna') return (axis === 'x' ? this.state.buildPanX : this.state.buildPanY) || 0;
    const cam = (this.state.regionCam || {})[r];
    if (cam) return cam[axis] || 0;
    if (r === 'belt') return (axis === 'x' ? this.state.beltPanX : this.state.beltPanY) || -('x' === axis ? 750 : 150);
    return axis === 'x' ? -750 : -150;
  }
  _curPanX() { return this._regionCamGet('x'); }
  _curPanY() { return this._regionCamGet('y'); }
  _panPatch(px, py) {
    const r = this.state.activeRegion || 'luna';
    if (r === 'luna') return { buildPanX: px, buildPanY: py };
    return { regionCam: Object.assign({}, this.state.regionCam, { [r]: { x: px, y: py } }) };
  }
  _regionPlaced(placed) { const r = this.state.activeRegion || 'luna'; return (placed || this.state.placed).filter(b => (b.region || 'luna') === r); }
  _regionLinks(links) { const r = this.state.activeRegion || 'luna'; return (links || this.state.links).filter(lk => (lk.region || 'luna') === r); }
  beltUnlocked() { const n = TECH_NODES.find(x => x.id === BELT_TECH_ID); return !!n && this.techStatus(n) === 'unlocked'; }

  // Screen point -> world-space point inside the (panned) build viewport.
  _pointToWorld(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = this.state.scale || 1;
    const vx = (e.clientX - rect.left) / scale, vy = (e.clientY - rect.top) / scale;
    return { x: vx - this._curPanX(), y: vy - this._curPanY() };
  }
  // Screen point -> nearest grid cell (raw, no occupancy resolution) with its
  // world-space centre — used for connector endpoints.
  _pointToCell(e) {
    const w = this._pointToWorld(e), g = BUILD_GRID;
    let col = Math.max(0, Math.min(g.cols - 1, Math.round((w.x - g.cell / 2) / g.cell)));
    let row = Math.max(0, Math.min(g.rows - 1, Math.round((w.y - g.cell / 2) / g.cell)));
    return { col: col, row: row, x: col * g.cell + g.cell / 2, y: row * g.cell + g.cell / 2 };
  }
  // Snap a world-space point to the nearest free build-grid cell, spiralling
  // outward if the nearest one is already occupied.
  _snapToGrid(x, y, placed) {
    const g = BUILD_GRID;
    let col = Math.max(0, Math.min(g.cols - 1, Math.round((x - g.cell / 2) / g.cell)));
    let row = Math.max(0, Math.min(g.rows - 1, Math.round((y - g.cell / 2) / g.cell)));
    const occupied = (c, r) => placed.some(b => b.col === c && b.row === r);
    if (occupied(col, row)) {
      let found = null;
      for (let rad = 1; rad <= 6 && !found; rad++) {
        for (let dc = -rad; dc <= rad && !found; dc++) {
          for (let dr = -rad; dr <= rad && !found; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
            const c = col + dc, r = row + dr;
            if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) continue;
            if (!occupied(c, r)) found = { col: c, row: r };
          }
        }
      }
      if (found) { col = found.col; row = found.row; } else return null;
    }
    return { col: col, row: row, x: col * g.cell + g.cell / 2, y: row * g.cell + g.cell / 2 };
  }
  // Modules must sit in one of the 8 cells touching their own building —
  // not just anywhere on the map — and not on top of another building or an
  // already-placed module of the same one. Returns the free adjacent cell
  // closest to the pointer, or null if every side is taken.
  _findModuleCell(parent, worldX, worldY, placed) {
    const g = BUILD_GRID;
    const used = new Set((parent.modules || []).map(m => m.col + ',' + m.row));
    let best = null, bestDist = Infinity;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const c = parent.col + dc, r = parent.row + dr;
        if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) continue;
        if (used.has(c + ',' + r)) continue;
        if (placed.some(b => b.col === c && b.row === r)) continue;
        const cx = c * g.cell + g.cell / 2, cy = r * g.cell + g.cell / 2;
        const dist = Math.hypot(cx - worldX, cy - worldY);
        if (dist < bestDist) { bestDist = dist; best = { col: c, row: r, x: cx, y: cy }; }
      }
    }
    return best;
  }

  // Places an armed building/module at the current pointer position. Called
  // from buildPointerUp only when the pointer didn't drag (i.e. it was a
  // click, not a camera pan).
  // Material cost of building something: half CR-scaled, denominated in Raw
  // Ore (already tracked, no need for a whole new resource just for this).
  _materialCost(cost) { return cost > 0 ? Math.max(10, Math.round(cost / 15)) : 0; }

  _flashActionError(msg) {
    this.setState({ actionError: msg });
    clearTimeout(this._actionErrTimer);
    this._actionErrTimer = setTimeout(() => this.setState({ actionError: null }), 1800);
  }

  _commitBuildingAt(e) {
    const s = this.state;
    if (s.placingModule) {
      const pm = s.placingModule;
      const parent = s.placed.find(b => b.id === pm.buildingId);
      if (!parent) return;
      const md = MODULE_BY_ID[pm.moduleId] || { cr: 0, or: 0 };
      if ((s.resources.CR || 0) < (md.cr || 0) || (s.resources.OR || 0) < (md.or || 0)) { this._flashActionError('insufficient'); return; }
      const w = this._pointToWorld(e);
      const cell = this._findModuleCell(parent, w.x, w.y, s.placed);
      if (!cell) { this._flashActionError('noSlot'); return; }
      this.setState(st => {
        const res = Object.assign({}, st.resources);
        res.CR = (res.CR || 0) - (md.cr || 0);
        res.OR = (res.OR || 0) - (md.or || 0);
        return {
          resources: res,
          placed: st.placed.map(b => b.id === pm.buildingId
            ? Object.assign({}, b, { modules: (b.modules || []).concat([{ moduleId: pm.moduleId, col: cell.col, row: cell.row, x: cell.x, y: cell.y }]).slice(0, MODULE_MAX) })
            : b),
          placingModule: null,
          placeHover: null
        };
      }, this._refreshSelected);
      return;
    }
    if (!s.placing || s.placing.kind === 'connector') return;
    const cost = s.placing.cost || 0;
    // Ironreach Combine's ally bonus ("−15% ore & alloy prices") shaves
    // straight off the Ore construction cost once relation reaches allied.
    const oreDiscount = Economy.diplomacyEffects(s).oreDiscount || 0;
    const matCost = Math.round(this._materialCost(cost) * (1 - oreDiscount / 100));
    if ((s.resources.CR || 0) < cost || (s.resources.OR || 0) < matCost) {
      this._flashActionError('insufficient');
      return;
    }
    if (s.placing.unique && s.placed.some(b => b.mono === s.placing.mono)) {
      this._flashActionError('unique');
      return;
    }
    const region = s.activeRegion || 'luna';
    const regionPlaced = this._regionPlaced(s.placed);
    const w = this._pointToWorld(e);
    if (s.placing.depositBased) {
      const previewSnap = this._snapToGrid(w.x, w.y, regionPlaced);
      const dp = previewSnap && depositAt(previewSnap.col, previewSnap.row, region);
      if (!dp || (s.placing.depositType && dp.resource !== s.placing.depositType)) {
        this._flashActionError('noDeposit');
        return;
      }
    }
    this.setState(st => {
      const snap = this._snapToGrid(w.x, w.y, this._regionPlaced(st.placed));
      if (!snap) return null;
      const p = st.placing;
      const res = Object.assign({}, st.resources);
      res.CR = (res.CR || 0) - cost;
      res.OR = (res.OR || 0) - matCost;
      const dep = p.depositBased ? depositAt(snap.col, snap.row, region) : null;
      const b = { id: 'b' + Date.now() + '_' + st.placed.length, mono: p.mono, name: p.name, category: p.category, kind: p.kind || 'building', modules: [], col: snap.col, row: snap.row, x: snap.x, y: snap.y, hp: 100, region: region };
      if (dep) b.resource = dep.resource;
      return {
        placed: [...st.placed, b],
        resources: res,
        placing: null,
        placeHover: null
      };
    });
  }

  // Pointer trio on the build-viewport camera: drag pans it; while a
  // connector tool is armed, drag instead lays road/conveyor/pipe between two
  // cells; a plain click (no drag) places whatever building tool is armed.
  buildPointerDown = (e) => {
    const s = this.state;
    if (s.placing && s.placing.kind === 'connector') {
      const cell = this._pointToCell(e);
      this.setState({ connectorStart: cell, placeHover: cell });
      return;
    }
    this._buildDrag = { x: e.clientX, y: e.clientY, moved: false, panX: this._curPanX(), panY: this._curPanY() };
  };
  buildPointerMove = (e) => {
    const s = this.state;
    if (s.placing && s.placing.kind === 'connector') {
      if (!s.connectorStart) return;
      const cell = this._pointToCell(e);
      const hv = s.placeHover;
      if (hv && hv.col === cell.col && hv.row === cell.row) return;
      this.setState({ placeHover: cell });
      return;
    }
    if (this._buildDrag) {
      const dx = e.clientX - this._buildDrag.x, dy = e.clientY - this._buildDrag.y;
      if (!this._buildDrag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) this._buildDrag.moved = true;
      if (this._buildDrag.moved) {
        this.setState(this._panPatch(
          this._clampBuildPanX(this._buildDrag.panX + dx),
          this._clampBuildPanY(this._buildDrag.panY + dy)
        ));
      }
    }
    if (s.placingModule) {
      const parent = s.placed.find(b => b.id === s.placingModule.buildingId);
      const hv = s.placeHover;
      if (!parent) { if (hv) this.setState({ placeHover: null }); return; }
      const w = this._pointToWorld(e);
      const cell = this._findModuleCell(parent, w.x, w.y, s.placed);
      if (!cell) { if (hv) this.setState({ placeHover: null }); return; }
      if (hv && hv.col === cell.col && hv.row === cell.row && hv.isModule) return;
      this.setState({ placeHover: { col: cell.col, row: cell.row, isModule: true } });
      return;
    }
    if (s.placing && s.placing.kind === 'demolish') {
      const w = this._pointToWorld(e), g = BUILD_GRID;
      const col = Math.max(0, Math.min(g.cols - 1, Math.floor(w.x / g.cell)));
      const row = Math.max(0, Math.min(g.rows - 1, Math.floor(w.y / g.cell)));
      const hitB = (s.placed || []).find(b => b.col === col && b.row === row);
      const hitL = hitB ? null : this._nearestLink(w.x, w.y);
      const next = hitB ? { kind: 'building', id: hitB.id } : (hitL ? { kind: 'link', id: hitL.id } : null);
      const cur = s.demolishHover;
      if ((cur && next && cur.kind === next.kind && cur.id === next.id) || (!cur && !next)) return;
      this.setState({ demolishHover: next });
      return;
    }
    if (s.placing) {
      const w = this._pointToWorld(e), g = BUILD_GRID;
      const snap = this._snapToGrid(w.x, w.y, this._regionPlaced(s.placed));
      const hv = s.placeHover;
      if (!snap) { if (hv) this.setState({ placeHover: null }); return; }
      const rawCol = Math.max(0, Math.min(g.cols - 1, Math.round((w.x - g.cell / 2) / g.cell)));
      const rawRow = Math.max(0, Math.min(g.rows - 1, Math.round((w.y - g.cell / 2) / g.cell)));
      const nudged = snap.col !== rawCol || snap.row !== rawRow;
      if (hv && hv.col === snap.col && hv.row === snap.row && hv.nudged === nudged) return;
      this.setState({ placeHover: { col: snap.col, row: snap.row, nudged: nudged } });
    }
  };
  buildPointerUp = (e) => {
    const s = this.state;
    if (s.placing && s.placing.kind === 'connector') {
      const start = s.connectorStart;
      if (start) {
        const end = this._pointToCell(e);
        if (end.col !== start.col || end.row !== start.row) {
          const cost = s.placing.cost || 0;
          if ((s.resources.CR || 0) < cost) { this._flashActionError('insufficient'); this.setState({ connectorStart: null }); return; }
          this.setState(st => {
            const res = Object.assign({}, st.resources);
            res.CR = (res.CR || 0) - cost;
            return {
              links: [...st.links, { id: 'lk' + Date.now(), type: s.placing.type, a: start, b: end, cost: cost, region: st.activeRegion || 'luna' }],
              resources: res, connectorStart: null, placeHover: null, placing: null
            };
          });
          return;
        }
      }
      this.setState({ connectorStart: null });
      return;
    }
    if (s.placing && s.placing.kind === 'demolish') {
      const dragged = !!(this._buildDrag && this._buildDrag.moved);
      this._buildDrag = null;
      if (!dragged) this._demolishAt(e);
      return;
    }
    const dragged = !!(this._buildDrag && this._buildDrag.moved);
    this._buildDrag = null;
    if (!dragged) this._commitBuildingAt(e);
  };

  selectPlaced(b) {
    const info = MONO_INFO[b.mono] || {};
    const mods = b.modules || [];
    const eff = info.warehouse ? 0 : buildingEff(mods);
    const rate = info.rate || 0;
    this.setState({
      selectedPlacedId: b.id,
      moduleMenuOpen: false,
      selectedBuilding: {
        name: b.name, category: b.category, kind: b.kind || 'building', mono: b.mono,
        warehouseFor: info.warehouseFor || null,
        haulerCap: info.haulerCap || 0, logiRange: info.logiRange || 0,
        arrivals: info.arrivals || 0, dockBays: info.dockBays || 0,
        refineFrom: info.refineFrom || null,
        hasProduction: !info.warehouse && !!info.out,
        inputs: info.refineFrom ? [{ mono: info.refineFrom, current: 0, needed: rate }] : [],
        output: { mono: info.out || '', current: Math.round(rate * eff / 100), rate: rate },
        efficiency: eff, modules: mods,
        hp: b.hp == null ? 100 : b.hp,
        upkeep: '-8 CR', energyUse: '-2 PW'
      },
      activeChain: null,
      buildingPanelOpen: true,
      // The selected-building panel occupies the build-menu slot — close it.
      activePanel: this.state.activePanel === 'build' ? null : this.state.activePanel
    });
  }
  // Hover a placed building — used to preview a warehouse / hub / Town Hall
  // logistics zone without selecting it.
  hoverPlaced = (id) => { if (this.state.placedHover !== id) this.setState({ placedHover: id }); };
  unhoverPlaced = () => { if (this.state.placedHover) this.setState({ placedHover: null }); };

  _refreshSelected = () => {
    const s = this.state;
    if (!s.selectedPlacedId) return;
    const b = s.placed.find(x => x.id === s.selectedPlacedId);
    if (b) this.selectPlaced(b);
  };
  toggleModuleMenu = () => this.setState(s => ({ moduleMenuOpen: !s.moduleMenuOpen }));
  pickModule(moduleId) {
    if (!this.state.selectedPlacedId) return;
    this.setState({ placingModule: { buildingId: this.state.selectedPlacedId, moduleId: moduleId }, moduleMenuOpen: false });
  }
  // Modules are free to fit, so removing one just refunds nothing and drops
  // its efficiency bonus.
  removeModule = (idx) => {
    const id = this.state.selectedPlacedId;
    if (id == null) return;
    this.setState(s => {
      const b0 = s.placed.find(b => b.id === id);
      const m = b0 && (b0.modules || [])[idx];
      const md = m ? (MODULE_BY_ID[m.moduleId] || {}) : {};
      const res = Object.assign({}, s.resources);
      res.CR = (res.CR || 0) + Math.round((md.cr || 0) * 0.5);
      res.OR = (res.OR || 0) + Math.round((md.or || 0) * 0.5);
      return {
        resources: res,
        placed: s.placed.map(b => b.id === id
          ? Object.assign({}, b, { modules: (b.modules || []).filter((_, i) => i !== idx) })
          : b)
      };
    }, this._refreshSelected);
  };

  // Arm the demolish tool (same `placing` slot the connector tools use).
  startDemolish = () => {
    if (this._isForeignRegion()) return;   // read-only territory
    this.setState({ placing: { kind: 'demolish' }, selectedPlacedId: null, buildingPanelOpen: false, activeChain: null, connectorStart: null, moduleMenuOpen: false });
  };

  // Repair the selected building back to 100 % HP — CR + Ore scaled to the
  // missing durability (40 % of what a fresh build would cost).
  _repairCost(mono, hp) {
    const info = MONO_INFO[mono] || {};
    const missing = Math.max(0, 100 - (hp == null ? 100 : hp)) / 100;
    return {
      cr: Math.round((info.cost || 0) * 0.4 * missing),
      or: Math.round(this._materialCost(info.cost || 0) * 0.4 * missing)
    };
  }
  repairBuilding = () => {
    const id = this.state.selectedPlacedId;
    if (id == null) return;
    this.setState(s => {
      const b = s.placed.find(x => x.id === id);
      if (!b || (b.hp == null ? 100 : b.hp) >= 100) return null;
      const c = this._repairCost(b.mono, b.hp);
      if ((s.resources.CR || 0) < c.cr || (s.resources.OR || 0) < c.or) { this._flashActionError('insufficient'); return null; }
      const res = Object.assign({}, s.resources);
      res.CR -= c.cr; res.OR -= c.or;
      return { resources: res, placed: s.placed.map(x => x.id === id ? Object.assign({}, x, { hp: 100 }) : x) };
    }, this._refreshSelected);
  };

  // Refund half the credits + ore a building cost, drop it and any road /
  // conveyor / pipe whose endpoint sat on its cell.
  _demolishBuilding(id) {
    this.setState(s => {
      const b = s.placed.find(x => x.id === id);
      if (!b) return null;
      const info = MONO_INFO[b.mono] || {};
      const res = Object.assign({}, s.resources);
      res.CR = (res.CR || 0) + Math.round((info.cost || 0) * 0.5);
      res.OR = (res.OR || 0) + Math.round(this._materialCost(info.cost || 0) * 0.5);
      const bReg = b.region || 'luna';
      const onCell = (pt) => pt && pt.col === b.col && pt.row === b.row;
      return {
        placed: s.placed.filter(x => x.id !== id),
        links: s.links.filter(lk => (lk.region || 'luna') !== bReg || (!onCell(lk.a) && !onCell(lk.b))),
        resources: res,
        selectedPlacedId: s.selectedPlacedId === id ? null : s.selectedPlacedId,
        buildingPanelOpen: s.selectedPlacedId === id ? false : s.buildingPanelOpen
      };
    });
  }
  demolishSelected = () => { if (this.state.selectedPlacedId != null) this._demolishBuilding(this.state.selectedPlacedId); };

  // Remove one connector, refunding half its build cost.
  _demolishLink(id) {
    this.setState(s => {
      const lk = s.links.find(x => x.id === id);
      if (!lk) return null;
      const res = Object.assign({}, s.resources);
      res.CR = (res.CR || 0) + Math.round((lk.cost || 0) * 0.5);
      return { links: s.links.filter(x => x.id !== id), resources: res, demolishHover: null };
    });
  }
  // Shortest distance from a world point to a link's elbowed a->b run
  // (horizontal at a.y to the corner, then vertical to b) — mirrors elbowSegs.
  _linkDistance(lk, wx, wy) {
    const c = BUILD_GRID.cell;
    const ax = lk.a.col * c + c / 2, ay = lk.a.row * c + c / 2;
    const bx = lk.b.col * c + c / 2, by = lk.b.row * c + c / 2;
    const seg = (px, py, x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      let tt = ((px - x1) * dx + (py - y1) * dy) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const qx = x1 + tt * dx, qy = y1 + tt * dy;
      return Math.hypot(px - qx, py - qy);
    };
    return Math.min(seg(wx, wy, ax, ay, bx, ay), seg(wx, wy, bx, ay, bx, by));
  }
  _nearestLink(wx, wy) {
    let best = null, bestD = Infinity;
    this._regionLinks().forEach(lk => {
      const d = this._linkDistance(lk, wx, wy);
      if (d < bestD) { bestD = d; best = lk; }
    });
    return bestD <= BUILD_GRID.cell * 0.6 ? best : null;
  }
  // Demolish click: a placed building on the clicked cell wins, else the
  // nearest connector within reach.
  _demolishAt(e) {
    const w = this._pointToWorld(e);
    const g = BUILD_GRID;
    const col = Math.max(0, Math.min(g.cols - 1, Math.floor(w.x / g.cell)));
    const row = Math.max(0, Math.min(g.rows - 1, Math.floor(w.y / g.cell)));
    const hit = this._regionPlaced().find(b => b.col === col && b.row === row);
    if (hit) { this._demolishBuilding(hit.id); return; }
    const lk = this._nearestLink(w.x, w.y);
    if (lk) this._demolishLink(lk.id);
  }

  // whMachines = haulers currently dispatched. Ceiling is the fleet the
  // colony's Hangars can house (Economy.haulerCapacity). Dispatch sends one
  // out to service covered producers; recall parks one back.
  whDispatch = () => this.setState(s => ({ whMachines: Math.min(Economy.haulerCapacity(s.placed), (s.whMachines || 0) + 1) }));
  whRecall = () => this.setState(s => ({ whMachines: Math.max(0, (s.whMachines || 0) - 1) }));

  selectChainNode(which) {
    this.setState(s => {
      const c = s.activeChain;
      if (!c) return null;
      let selectedBuilding, placing;
      if (which === 'building') {
        const inputs = c.sources.map(function(x){ return { mono:x.inputMono, current:0, needed:5 }; });
        const rate = (MONO_INFO[c.buildingMono] || {}).rate || 10;
        selectedBuilding = { name: c.buildingName, category: c.buildingCategory, hasProduction: true, inputs:inputs, output:{mono:c.outputMono,current:rate,rate:rate}, efficiency:100, modules:[], upkeep:'-' + Math.max(1, Math.round(c.buildingCost / 20)) + ' CR', durability:100, energyUse:'-4 PW', health:100 };
        placing = { mono: c.buildingMono, name: c.buildingName, category: c.buildingCategory, cost: c.buildingCost || 0 };
      } else {
        const src = c.sources[which];
        selectedBuilding = { name: src.name, category: 'Extraction', hasProduction: true, inputs:[], output:{mono:src.inputMono,current:6,rate:6}, efficiency:100, modules:[], upkeep:'-3 CR', durability:100, energyUse:'-1 PW', health:100 };
        placing = { mono: src.mono, name: src.name, category: 'Extraction', cost: 0 };
      }
      return { chainSelected: which, selectedBuilding, buildingPanelOpen: true, placing: placing, selectedPlacedId: null, moduleMenuOpen: false };
    });
  }

  toggleBuildingSelect = () => this.setState(s => ({ buildingPanelOpen: !s.buildingPanelOpen }));

  techStatus(node) {
    return this.state.techOverride[node.id] || node.base;
  }

  selectTechNode(id) { this.setState({ selectedTechId: id }); }
  setTechFilter(f) { this.setState({ techFilter: f }); }
  setTechTab(tab) { this.setState({ techTab: tab }); }
  setPolicy(cat, opt) { this.setState(s => ({ policyChoice: Object.assign({}, s.policyChoice, { [cat]: opt }) })); }
  selectTradeRoute(id) { this.setState(s => ({ tradeSel: s.tradeSel === id ? null : id })); }
  // Activating a route needs real Cargo Transport capacity (one ship crews
  // two routes) — pausing/toggling one off is always free.
  toggleTradeRoute(id, base) {
    const s = this.state;
    const cur = s.tradeStatus[id] || base;
    if (cur !== 'active' && Economy.activeTradeRouteCount(s) >= Economy.tradeCapacity(s.fleets)) {
      this._flashActionError('noCapacity');
      return;
    }
    this.setState(st => ({ tradeStatus: Object.assign({}, st.tradeStatus, { [id]: cur === 'active' ? 'paused' : 'active' }) }));
  }
  openTradeNew = () => this.setState({ tradeNewOpen: true, tradeNewDest: null, tradeNewCargo: null });
  closeTradeNew = () => this.setState({ tradeNewOpen: false });
  setTradeNewDest = (id) => this.setState({ tradeNewDest: id });
  setTradeNewCargo = (id) => this.setState({ tradeNewCargo: id });
  confirmTradeNew = () => {
    const s = this.state;
    const d = TRADE_DESTS.find(x => x.id === s.tradeNewDest);
    const c = TRADE_CARGOS.find(x => x.id === s.tradeNewCargo);
    if (!d || !c) return;
    if (Economy.activeTradeRouteCount(s) >= Economy.tradeCapacity(s.fleets)) {
      this._flashActionError('noCapacity');
      return;
    }
    this.setState(st => {
      const mult = (d.demand && d.demand[c.id]) || 1;
      const vol = 300 + Math.round(mult * 260);
      const income = Math.round(c.base * mult * (vol / 260) / 10) * 10;
      const route = {
        id: 'usr' + (st.tradeAdded.length + 1) + Date.now().toString(36).slice(-3),
        a: 'Meridian', b: d.name, partner: d.partner, cargo: c.id,
        vol: vol.toLocaleString('en-US').replace(/,/g, ' ') + ' t',
        trips: 2 + (mult > 1.2 ? 1 : 0), income, days: d.days, risk: d.risk,
        load: Math.min(0.95, 0.5 + (mult - 1) * 0.5), status: 'active'
      };
      return { tradeAdded: st.tradeAdded.concat([route]), tradeNewOpen: false, tradeSel: route.id };
    });
  };

  // Add an available node to the research queue. `crCost` is one-off funding
  // paid now; `rpCost` is progress the queue burns down over time (runTick).
  queueTech = (id) => {
    const s = this.state;
    const target = id || s.selectedTechId;
    const node = TECH_NODES.find(n => n.id === target);
    if (!node) return;
    if (this.techStatus(node) !== 'available') return;
    if ((s.researchQueue || []).indexOf(target) !== -1) return;
    const crCost = node.crCost || 0;
    if ((s.resources.CR || 0) < crCost) { this._flashActionError('techInsufficient'); return; }
    this.setState(st => {
      const res = Object.assign({}, st.resources);
      res.CR = (res.CR || 0) - crCost;
      return { resources: res, researchQueue: (st.researchQueue || []).concat([target]) };
    });
  };
  // Pull a node out of the queue. Refund its funding only if it hasn't started.
  unqueueTech = (id) => {
    this.setState(st => {
      const q = st.researchQueue || [];
      if (q.indexOf(id) === -1) return null;
      const node = TECH_NODES.find(n => n.id === id);
      const started = (st.researchProgress || {})[id] > 0;
      const res = Object.assign({}, st.resources);
      if (!started && node) res.CR = (res.CR || 0) + (node.crCost || 0);
      const prog = Object.assign({}, st.researchProgress);
      delete prog[id];
      return { resources: res, researchQueue: q.filter(x => x !== id), researchProgress: prog };
    });
  };
  // Reorder a queued node (dir -1 = earlier, +1 = later).
  moveTechInQueue = (id, dir) => {
    this.setState(st => {
      const q = (st.researchQueue || []).slice();
      const i = q.indexOf(id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= q.length) return null;
      const tmp = q[i]; q[i] = q[j]; q[j] = tmp;
      return { researchQueue: q };
    });
  };

  setDiploTab(id) { this.setState({ diploTab: id }); }

  _rel(id) {
    const r = (this.state.diploRelations || {})[id];
    if (r != null) return r;
    const f = FACTIONS.find(x => x.id === id);
    return f ? f.relation : 50;
  }
  _pushDiplo(actionKey, factionId, delta, extra) {
    this.setState(s => ({ diploLog: [{ actionKey, factionId, delta, extra }, ...s.diploLog].slice(0, 5) }));
  }
  _adjustRel(id, delta) {
    const next = Math.max(0, Math.min(100, this._rel(id) + delta));
    this.setState(s => ({ diploRelations: Object.assign({}, s.diploRelations, { [id]: next }) }));
    return next;
  }
  diploAct(kind) {
    const id = this.state.diploTab;
    const rel = this._rel(id);
    // Gifts cost real credits — bigger bribes buy more goodwill at higher
    // standing. Envoys and sanctions are diplomacy, not money.
    if (kind === 'gift') {
      const cost = 400 + Math.round(rel * 6);
      if ((this.state.resources.CR || 0) < cost) { this._flashActionError('insufficient'); return; }
      this.setState(s => ({ resources: Object.assign({}, s.resources, { CR: (s.resources.CR || 0) - cost }) }));
    }
    let delta;
    if (kind === 'envoy') delta = Math.max(1, Math.round((100 - rel) * 0.12));
    else if (kind === 'gift') delta = Math.max(2, Math.round((100 - rel) * 0.2));
    else delta = -Math.max(6, Math.round(rel * 0.25));
    this._adjustRel(id, delta);
    this._pushDiplo(kind, id, delta);
  }
  toggleTreaty(treatyId) {
    const id = this.state.diploTab;
    const tr = TREATIES.find(x => x.id === treatyId);
    if (!tr) return;
    const cur = ((this.state.diploTreaties || {})[id] || {})[treatyId];
    if (!cur && this._rel(id) < tr.req) return;
    this.setState(s => {
      const perFac = Object.assign({}, (s.diploTreaties || {})[id], { [treatyId]: !cur });
      return { diploTreaties: Object.assign({}, s.diploTreaties, { [id]: perFac }) };
    });
    const delta = cur ? -tr.drop : tr.gain;
    this._adjustRel(id, delta);
    this._pushDiplo(cur ? 'broke' : 'sign', id, delta, treatyId);
  }

  toggleLang = () => this.setState(s => ({ lang: (s.lang || 'ru') === 'ru' ? 'en' : 'ru' }));

  selectFleet(id) { this.setState(s => ({ selectedFleetId: s.selectedFleetId === id ? null : id })); }
  // Removes one ship from the group (refunding half its build cost); the
  // whole group disappears once its count reaches zero.
  disbandFleet(id) {
    this.setState(s => {
      const f = s.fleets.find(x => x.id === id);
      if (!f) return null;
      const refund = Math.round((SHIP_COST[f.type] || 0) * 0.5);
      const fleets = s.fleets.map(x => x.id === id ? Object.assign({}, x, { count: x.count - 1 }) : x).filter(x => x.count > 0);
      const res = Object.assign({}, s.resources);
      res.CR = (res.CR || 0) + refund;
      return { fleets, resources: res, selectedFleetId: fleets.some(x => x.id === id) ? s.selectedFleetId : null };
    });
  }
  openFleetBuild = () => this.setState({ fleetBuildOpen: true, fleetBuildType: null });
  closeFleetBuild = () => this.setState({ fleetBuildOpen: false });
  setFleetBuildType(type) { this.setState({ fleetBuildType: type }); }
  // Commissions one ship of the chosen type — tops up an existing group of
  // that type, or starts a new one if the colony has none yet.
  confirmFleetBuild = () => {
    const s = this.state;
    const type = s.fleetBuildType;
    if (!type) return;
    const cost = SHIP_COST[type] || 0;
    if ((s.resources.CR || 0) < cost) { this._flashActionError('insufficient'); return; }
    if (Economy.fleetTotal(s.fleets) >= Economy.dockCapacity(s.placed, s.links)) {
      this._flashActionError('noDock');
      return;
    }
    if (type === 'Warship' && !s.placed.some(b => b.mono === 'MY')) {
      this._flashActionError('noShipyard');
      return;
    }
    this.setState(st => {
      const res = Object.assign({}, st.resources);
      res.CR = (res.CR || 0) - cost;
      const existing = st.fleets.find(f => f.type === type);
      const fleets = existing
        ? st.fleets.map(f => f === existing ? Object.assign({}, f, { count: f.count + 1 }) : f)
        : st.fleets.concat([{ id: 'fl' + Date.now(), name: type, type, count: 1, status: 'Docked' }]);
      return { fleets, resources: res, fleetBuildOpen: false, fleetBuildType: null };
    });
  };

  setBuildCategory(id) { this.setState({ buildCategory: id, chainPreview: null }); }
  setRegion = (r) => {
    if (r === this.state.activeRegion) return;
    const cats = r === 'belt' ? BELT_CATS : BUILD_CATS;
    this.setState({ activeRegion: r, buildCategory: cats[0].id, placing: null, placeHover: null, connectorStart: null, activeChain: null, selectedPlacedId: null, buildingPanelOpen: false, chainPreview: null });
  };

  toggleRenewable = () => this.setState(s => ({ policyRenewable: !s.policyRenewable }));
  toggleOvertime = () => this.setState(s => ({ policyOvertime: !s.policyOvertime }));

  renderVals() {
    const s = this.state;
    const colonyName = s.colonyNameOverride || (this.props.colonyName ?? 'Meridian Station');
    const sd = solDate(s.cycle);
    const foodStatus = Economy.foodStatus(s);
    const waterStatus = Economy.waterStatus(s);
    const ecoIndexValue = Economy.happiness(s);
    const stabilityValue = Economy.stability(s);
    const showDetailedStats = this.props.showDetailedStats ?? true;
    const lang = s.lang || 'ru';
    const t = I18N[lang] || I18N.ru;
    const D = t.d;
    const catName = (c) => (t.cat && t.cat[c]) || c;
    const bldName = (n) => (t.bld && t.bld[n]) || n;

    const railButtons = RAIL_DEFS.map(rb => {
      const isOverlay = rb.id === 'tech' || rb.id === 'diplomacy';
      const active = isOverlay ? s.activeOverlay === rb.id : s.activePanel === rb.id;
      return {
        ...rb,
        label: t.rail[rb.id] || rb.label,
        onClick: () => isOverlay ? this.openOverlay(rb.id) : this.togglePanel(rb.id),
        bg: active ? 'rgba(0, 140, 116, 0.22)' : 'rgba(27, 38, 44, 0.55)',
        border: active ? 'rgba(11, 198, 171, 0.7)' : PANEL_BORDER,
        monoColor: active ? '#ade5d7' : '#b2b9bd',
        icon: rb.icon
      };
    });

    const regionCats = (s.activeRegion === 'belt') ? BELT_CATS : BUILD_CATS;
    const curCat = regionCats.find(c => c.id === s.buildCategory) ? s.buildCategory : regionCats[0].id;
    const buildCategoryTabs = regionCats.map(cat => {
      const active = curCat === cat.id;
      return { id: cat.id, label: catName(cat.label).slice(0, 3).toUpperCase(), onClick: () => this.setBuildCategory(cat.id), bg: active ? 'rgba(0, 140, 116, 0.2)' : 'transparent', color: active ? TEAL : '#b2b9bd', border: active ? 'rgba(11, 198, 171, 0.5)' : PANEL_BORDER };
    });
    const activeCatLabel = catName((regionCats.find(c => c.id === curCat) || regionCats[0]).label);
    const activeItems = (SHELF_ITEMS[curCat] || []).map(item => {
      const gate = TECH_UNLOCK_BUILDING[item.mono];
      const locked = !!gate && this.techStatus(gate) !== 'unlocked';
      return {
        ...item, name: bldName(item.name),
        onSelect: () => this.selectShelfItem(curCat, item),
        onEnter: () => this.setState({ shelfHover: item.mono }),
        onLeave: () => this.setState({ shelfHover: null }),
        locked,
        monoColor: locked ? MUTED : TEAL,
        cellBg: locked ? 'rgba(11, 21, 28, 0.55)' : 'rgba(17, 31, 39, 0.6)',
        cellCursor: locked ? 'not-allowed' : 'pointer'
      };
    });
    // A single shared tooltip for the hovered shelf tile — anchored to the
    // whole build panel in index.html, not to each tile, so the scrollable
    // tile grid's own overflow box can never clip or misplace it.
    const hoveredShelfItem = s.shelfHover ? SHELF_ITEMS[s.buildCategory].find(it => it.mono === s.shelfHover) : null;
    let shelfTip = null;
    if (hoveredShelfItem) {
      const gate = TECH_UNLOCK_BUILDING[hoveredShelfItem.mono];
      const locked = !!gate && this.techStatus(gate) !== 'unlocked';
      const tip = buildShelfTooltip(hoveredShelfItem, activeCatLabel, this._materialCost(hoveredShelfItem.cost || 0), t);
      if (locked) tip.rows = [{ label: t.err.locked, val: (D.tech && D.tech[gate.id] && D.tech[gate.id].name) || gate.name }].concat(tip.rows);
      shelfTip = { name: bldName(hoveredShelfItem.name), category: tip.category, rows: tip.rows };
    }

    // Ore deposits — a Mining Rig only ever produces once it's built exactly
    // on one of these; rendered under the placed buildings (lower z-index)
    // so a built-over deposit still peeks out as a visual reminder of why
    // that Mining Rig produces what it does.
    const deposits = ALL_DEPOSITS.filter(d => (d.region || 'luna') === (s.activeRegion || 'luna')).map(d => {
      const color = STORAGE_COLOR[d.resource] || '#93a1a9';
      return {
        id: d.id,
        leftPx: (d.col * BUILD_GRID.cell) + 'px',
        topPx: (d.row * BUILD_GRID.cell) + 'px',
        sizePx: BUILD_GRID.cell + 'px',
        bg: withAlpha(color, 0.16),
        border: color,
        label: d.resource
      };
    });

    // Foreign-territory observation — visiting an allied/rival sector shows a
    // read-only banner + a flavor layout instead of the player's build tools.
    const foreignStatus = this._isForeignRegion() ? this.sectorStatus(s.activeRegion) : null;
    let foreignBanner = { visible: false };
    let foreignBuildings = [];
    if (foreignStatus) {
      const r = s.activeRegion;
      const fsc = SECTORS.find(x => x.id === r);
      const secLabel = (t.sectorWord || 'Sector') + ' ' + (fsc ? fsc.num : '');
      if (foreignStatus === 'allied') {
        const a = s.ally || {};
        foreignBanner = {
          visible: true,
          title: (t.foreignAllyTitle || 'Territory: Azure Compact') + ' · ' + secLabel,
          hint: t.foreignAllyHint || '',
          stat: (t.allyStrength || 'Strength') + ' ' + (a.strength || 0) + '   ' + (t.allyBuildings || 'Structures') + ' ' + (a.buildings || 0),
          hasStat: true,
          accent: TEAL
        };
        foreignBuildings = this._foreignLayout(r, Math.max(3, Math.min(11, Math.round((a.buildings || 6) / 2))), 'AZ', TEAL);
      } else if (foreignStatus === 'ai') {
        foreignBanner = {
          visible: true,
          title: (t.foreignAiTitle || 'Territory: rival operation') + ' · ' + secLabel,
          hint: t.foreignAiHint || '',
          stat: '',
          hasStat: false,
          accent: '#e08078'
        };
        foreignBuildings = this._foreignLayout(r, 7, 'RV', '#e08078');
      }
      foreignBanner.onLeave = this.sectorReturnHome;
    }

    const demoHover = s.demolishHover || null;
    const isDemolishMode = !!(s.placing && s.placing.kind === 'demolish');
    const connectedSet = Economy.connectedBuildingIds(s.placed, s.links);
    const regionPlacedR = this._regionPlaced(s.placed);
    const placedBuildings = regionPlacedR.map(b => {
      const isConnected = s.placed.length <= 1 || connectedSet.has(b.id);
      const demoTarget = demoHover && demoHover.kind === 'building' && demoHover.id === b.id;
      return {
        id: b.id,
        mono: b.mono,
        name: bldName(b.name),
        leftPx: b.x + 'px',
        topPx: b.y + 'px',
        cellPx: BUILD_GRID.cell + 'px',
        zoneBg: ZONE_COLOR[b.category] || 'rgba(147, 161, 169, 0.14)',
        zoneBorder: ZONE_BORDER[b.category] || 'rgba(147, 161, 169, 0.3)',
        icon: BUILDING_ICON[b.category] || RAIL_ICONS.build,
        iconColor: ZONE_ICON_COLOR[b.category] || '#7ac8f5',
        bg: demoTarget ? 'rgba(98, 11, 5, 0.85)' : (b.id === s.selectedPlacedId ? 'rgba(0, 55, 46, 0.8)' : 'rgba(13, 24, 30, 0.72)'),
        border: demoTarget ? '#ff6c5d' : (b.id === s.selectedPlacedId ? '#43d9be' : 'rgba(11, 198, 171, 0.6)'),
        modCount: (b.modules || []).length,
        hasMods: (b.modules || []).length > 0,
        connected: isConnected,
        opacity: isConnected ? 1 : 0.5,
        onSelect: isDemolishMode ? (((id) => () => this._demolishBuilding(id))(b.id)) : (() => this.selectPlaced(b)),
        onEnter: () => this.hoverPlaced(b.id),
        onLeave: this.unhoverPlaced
      };
    });

    // Player-built connectors only — roads/conveyors/pipes are never placed
    // automatically. Each link is an elbowed (Manhattan) run between two
    // grid-cell centres, rendered as up to two rectangle segments.
    const elbowSegs = (ax, ay, bx, by, w) => {
      const segs = [];
      if (ax !== bx) segs.push({ leftPx: Math.min(ax, bx) - w / 2 + 'px', topPx: ay - w / 2 + 'px', wPx: Math.abs(bx - ax) + w + 'px', hPx: w + 'px' });
      if (ay !== by) segs.push({ leftPx: bx - w / 2 + 'px', topPx: Math.min(ay, by) - w / 2 + 'px', wPx: w + 'px', hPx: Math.abs(by - ay) + w + 'px' });
      return segs;
    };
    const cellPx = (c) => c.col * BUILD_GRID.cell + BUILD_GRID.cell / 2;
    const cellPy = (c) => c.row * BUILD_GRID.cell + BUILD_GRID.cell / 2;
    const buildLinks = [];
    this._regionLinks(s.links).forEach(lk => {
      const st = LINK_STYLE[lk.type] || LINK_STYLE.road;
      const demoTarget = demoHover && demoHover.kind === 'link' && demoHover.id === lk.id;
      const lbg = demoTarget ? '#da4339' : st.bg;
      const lbd = demoTarget ? '#ff7b6b' : st.border;
      const ax = cellPx(lk.a), ay = cellPy(lk.a), bx = cellPx(lk.b), by = cellPy(lk.b);
      elbowSegs(ax, ay, bx, by, st.w).forEach((seg, i) => buildLinks.push(Object.assign({ key: lk.id + '_' + i, bg: lbg, border: lbd, cls: demoTarget ? '' : st.cls }, seg)));
      // small square pads at both ends so the run reads as connected
      // infrastructure instead of a bar trailing off into empty ground
      const pad = st.w + 6, half = pad / 2;
      buildLinks.push({ key: lk.id + '_pa', leftPx: ax - half + 'px', topPx: ay - half + 'px', wPx: pad + 'px', hPx: pad + 'px', bg: lbg, border: lbd, cls: '' });
      buildLinks.push({ key: lk.id + '_pb', leftPx: bx - half + 'px', topPx: by - half + 'px', wPx: pad + 'px', hPx: pad + 'px', bg: lbg, border: lbd, cls: '' });
    });
    // Haulers — CSS motion-path dots running the ROADS (conveyors already
    // animate their stripes). Cart count follows the dispatched fleet; they
    // move faster when the fleet is stretched thin.
    const roadHaulers = [];
    const logiDem0 = Economy.logisticsDemand(s.placed, s.links);
    if (logiDem0.covered + logiDem0.uncovered > 0 && (s.whMachines || 0) > 0) {
      const lf = Economy.logisticsFactor(s);
      const roadLinks = this._regionLinks(s.links).filter(lk => lk.type === 'road');
      const perRoad = Math.max(1, Math.min(4, Math.round((s.whMachines || 0) / Math.max(1, roadLinks.length))));
      roadLinks.forEach((lk, li) => {
        const ax = cellPx(lk.a), ay = cellPy(lk.a), bx = cellPx(lk.b), by = cellPy(lk.b);
        const d = 'M ' + ax + ' ' + ay + ' L ' + bx + ' ' + ay + ' L ' + bx + ' ' + by;
        const dur = (lf < 0.75 ? 2.4 : 3.6) + (li % 3) * 0.4;
        for (let i = 0; i < perRoad; i++) {
          roadHaulers.push({
            key: lk.id + '_h' + i, path: d,
            dur: dur + 's', delay: (-(i / perRoad) * dur).toFixed(2) + 's',
            dir: (li + i) % 2 === 0 ? 'normal' : 'reverse'
          });
        }
      });
    }
    // Coverage square — shown only for the Warehouse / Transit Hub / Town
    // Hall the player is hovering or has selected, so the grid isn't a mess
    // of overlapping rings.
    const logiZones = [];
    const zoneFor = s.placedHover || s.selectedPlacedId;
    if (zoneFor) {
      const zb = s.placed.find(b => b.id === zoneFor);
      const zi = zb ? (MONO_INFO[zb.mono] || {}) : {};
      if (zb && zi.logiRange && (zb.region || 'luna') === (s.activeRegion || 'luna')) {
        const cell = BUILD_GRID.cell;
        const span = (zi.logiRange * 2 + 1) * cell;
        logiZones.push({
          key: zb.id + '_z',
          leftPx: (zb.col * cell + cell / 2 - span / 2) + 'px',
          topPx: (zb.row * cell + cell / 2 - span / 2) + 'px',
          sizePx: span + 'px',
          border: zi.warehouse ? 'rgba(86, 182, 187, 0.5)' : 'rgba(11, 198, 171, 0.55)'
        });
      }
    }
    // Live preview of the connector currently being dragged out.
    let linkGhost = { visible: false, segs: [] };
    if (s.placing && s.placing.kind === 'connector' && s.connectorStart && s.placeHover) {
      const st = LINK_STYLE[s.placing.type] || LINK_STYLE.road;
      const ax = cellPx(s.connectorStart), ay = cellPy(s.connectorStart), bx = cellPx(s.placeHover), by = cellPy(s.placeHover);
      linkGhost = {
        visible: true,
        segs: elbowSegs(ax, ay, bx, by, st.w).map((seg, i) => Object.assign({ key: 'ghost_' + i, bg: st.bg, border: st.border, cls: st.cls }, seg))
      };
    }

    let placeGhost = { visible: false, leftPx: '0px', topPx: '0px', sizePx: BUILD_GRID.cell + 'px', bg: 'transparent', border: 'transparent' };
    if (s.placingModule && s.placeHover) {
      placeGhost = {
        visible: true,
        leftPx: (s.placeHover.col * BUILD_GRID.cell) + 'px',
        topPx: (s.placeHover.row * BUILD_GRID.cell) + 'px',
        sizePx: BUILD_GRID.cell + 'px',
        bg: 'rgba(92, 181, 114, 0.25)',
        border: 'rgba(92, 181, 114, 0.9)'
      };
    } else if (s.placing && s.placing.kind !== 'connector' && s.placeHover) {
      placeGhost = {
        visible: true,
        leftPx: (s.placeHover.col * BUILD_GRID.cell) + 'px',
        topPx: (s.placeHover.row * BUILD_GRID.cell) + 'px',
        sizePx: BUILD_GRID.cell + 'px',
        bg: s.placeHover.nudged ? 'rgba(235, 169, 65, 0.22)' : 'rgba(11, 198, 171, 0.22)',
        border: s.placeHover.nudged ? 'rgba(235, 169, 65, 0.85)' : 'rgba(11, 198, 171, 0.85)'
      };
    }
    // While a connector is armed, also show a small marker on the picked
    // start cell so it reads clearly once the drag has begun.
    const connectorStartGhost = (s.placing && s.placing.kind === 'connector' && s.connectorStart) ? {
      visible: true, leftPx: (s.connectorStart.col * BUILD_GRID.cell) + 'px', topPx: (s.connectorStart.row * BUILD_GRID.cell) + 'px', sizePx: BUILD_GRID.cell + 'px'
    } : { visible: false, leftPx: '0px', topPx: '0px', sizePx: BUILD_GRID.cell + 'px' };

    const placedModules = [];
    s.placed.forEach(b => (b.modules || []).forEach((m, i) => placedModules.push({
      key: b.id + '_m' + i,
      mono: (MODULE_BY_ID[m.moduleId] || {}).mono || '?',
      leftPx: m.x + 'px',
      topPx: m.y + 'px'
    })));

    const worldW = BUILD_GRID.cols * BUILD_GRID.cell, worldH = BUILD_GRID.rows * BUILD_GRID.cell;
    const lunaPlaced = s.placed.filter(b => (b.region || 'luna') === 'luna');
    const mapBuildings = lunaPlaced.map(b => ({
      mono: b.mono,
      name: bldName(b.name),
      category: catName(b.category),
      leftPct: (b.x / worldW * 100) + '%',
      topPct: (b.y / worldH * 100) + '%',
      // normalised into the same 1920x1080 box the home sector polygon was
      // authored against, regardless of how big the build grid itself is
      leftPx: (HOME_X + b.x / worldW * 1920) + 'px',
      topPx: (HOME_Y + b.y / worldH * 1080) + 'px'
    }));
    const mapCounts = {};
    lunaPlaced.forEach(b => { const k = catName(b.category); mapCounts[k] = (mapCounts[k] || 0) + 1; });
    const mapCategoryCounts = Object.keys(mapCounts).map(k => ({ label: k, count: mapCounts[k] }));

    // The thumbnail's viewport-frame tracks the real build camera: which
    // slice of the (bigger) world the pannable field is currently showing.
    const mapViewport = {
      leftPct: Math.max(0, Math.min(100, -this._curPanX() / worldW * 100)) + '%',
      topPct: Math.max(0, Math.min(100, -this._curPanY() / worldH * 100)) + '%',
      wPct: Math.min(100, BUILD_VIEW.w / worldW * 100) + '%',
      hPct: Math.min(100, BUILD_VIEW.h / worldH * 100) + '%'
    };

    const mapZoom = s.mapZoom || 0.9;
    // 1 when zoomed out (global), 0 when zoomed into the home sector (local).
    const reveal = Math.max(0, Math.min(1, (0.52 - mapZoom) / (0.52 - 0.26)));
    const homeSec = SECTORS.find(sc => sc.status === 'home') || {};
    const mapSectors = SECTORS.map(sc => {
      const status = sc.id === 's12' ? 'home' : this.sectorStatus(sc.id);
      const st = sectorStyle(status);
      const home = status === 'home';
      const sel = s.sectorSel === sc.id;
      return {
        id: sc.id,
        points: sc.points,
        name: (t.sectorWord || 'Sector') + ' ' + sc.num,
        statusLabel: (t.sectorStatus && t.sectorStatus[status]) || status,
        fill: home ? '#040e13' : st.bg,
        stroke: sel ? '#43d9be' : (home ? 'rgba(11, 198, 171, 0.85)' : st.border),
        strokeWidth: sel ? 7 : (home ? 6 : 3.5),
        labelColor: st.label,
        subColor: st.sub,
        labelLeft: sc.cx + 'px',
        labelTop: sc.cy + 'px',
        onClick: () => this.selectSector(sc.id),
        polyOpacity: home ? 1 : Math.max(reveal, sel ? 1 : 0),
        textOpacity: home ? (mapZoom > 0.5 ? 0 : reveal) : Math.max(reveal, sel ? 1 : 0),
        pointerEvents: 'auto'
      };
    });

    // Selected-sector action panel (scout / claim / retake / manage).
    let mapSectorPanel = { visible: false, depoSummary: [], actions: [] };
    if (s.sectorSel) {
      const sc = SECTORS.find(x => x.id === s.sectorSel);
      if (sc) {
        const status = sc.id === 's12' ? 'home' : this.sectorStatus(sc.id);
        const revealed = status === 'scouted' || status === 'owned' || status === 'ai' || status === 'allied';
        const shipN = Economy.fleetCount(s.fleets, 'Colony Ship');
        const cr = s.resources.CR || 0;
        const rn = (code) => (t.resName && t.resName[code]) || code;
        const counts = {};
        if (revealed) (sc.deposits || []).forEach(d => { counts[d.resource] = (counts[d.resource] || 0) + 1; });
        const depoSummary = Object.keys(counts).map(c => ({ label: rn(c), count: '×' + counts[c], color: STORAGE_COLOR[c] || '#93a1a9' }));
        const shipName = (t.fleetTypeName && t.fleetTypeName['Colony Ship']) || 'Colony Ship';
        const retakeCost = this._retakeCost();
        const acts = [];
        if (status === 'unexplored') acts.push({ label: (t.sectorScout || 'Scout') + ' · ' + fmtNum(SECTOR_SCOUT_COST) + ' CR', enabled: cr >= SECTOR_SCOUT_COST, onClick: () => this.scoutSector(sc.id) });
        else if (status === 'scouted') acts.push({ label: (t.sectorClaim || 'Claim sector') + ' · ' + fmtNum(SECTOR_CLAIM_COST) + ' CR + 1 ' + shipName, enabled: cr >= SECTOR_CLAIM_COST && shipN >= 1, onClick: () => this.claimSector(sc.id) });
        else if (status === 'ai') {
          acts.push({ label: t.sectorVisit || 'Visit (observe)', enabled: true, onClick: () => this.focusSector(sc.id) });
          acts.push({ label: (t.sectorRetake || 'Retake sector') + ' · ' + fmtNum(retakeCost) + ' CR + 1 ' + shipName, enabled: cr >= retakeCost && shipN >= 1, primary: true, onClick: () => this.claimSector(sc.id) });
        }
        else if (status === 'allied') acts.push({ label: t.sectorVisit || 'Visit (observe)', enabled: true, primary: true, onClick: () => this.focusSector(sc.id) });
        else if (status === 'owned' || status === 'home') acts.push({ label: (t.sectorManage || 'Manage sector'), enabled: true, primary: true, onClick: () => this.focusSector(sc.id) });
        const st2 = sectorStyle(status);
        const noteKey = status === 'allied' ? 'sectorAlliedNote' : (status === 'ai' ? 'sectorAiNote' : null);
        mapSectorPanel = {
          visible: true,
          name: (t.sectorWord || 'Sector') + ' ' + sc.num,
          statusLabel: (t.sectorStatus && t.sectorStatus[status]) || status,
          statusColor: st2.label,
          revealed,
          depoLabel: t.sectorDeposits || 'Deposits',
          depoSummary,
          hasDeposits: depoSummary.length > 0,
          unknownMsg: t.sectorUnknown || 'Deposits unknown — scout to reveal',
          showUnknown: !revealed,
          note: noteKey ? (t[noteKey] || '') : '',
          hasNote: !!(noteKey && t[noteKey]),
          actions: acts.map(a => ({
            label: a.label,
            onClick: a.onClick,
            disabled: !a.enabled,
            rowColor: !a.enabled ? MUTED : (a.primary ? '#07131a' : '#e2eef0'),
            bg: !a.enabled ? 'rgba(17, 25, 30, 0.5)' : (a.primary ? TEAL : 'rgba(23, 37, 46, 0.7)'),
            border: a.enabled ? 'rgba(11, 198, 171, 0.5)' : PANEL_BORDER
          })),
          hasActions: acts.length > 0,
          onClose: () => this.setState({ sectorSel: null })
        };
      }
    }
    const mapWorldTransform = 'translate(-50%,-50%) translate(' + (s.mapPanX || 0) + 'px,' + (s.mapPanY || 0) + 'px) scale(' + mapZoom + ')';
    const mapWorldTransition = s.mapDragging ? 'none' : 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
    const mapZoomLabel = Math.round(mapZoom * 100) + '%';
    const mapScopeLabel = mapZoom > 0.45 ? t.mapGlobal : t.mapLocal;
    const mapWorldW = WORLD_W + 'px';
    const mapWorldH = WORLD_H + 'px';

    // ---- Solar-system state ----
    // The scene itself (sun/planets/moons/rings/belts/fleets/camera) is
    // rendered by Three.js — see game-solarsystem3d.js, driven each tick
    // from componentDidMount's animation loop. Everything below only feeds
    // the 2D info side-panel and the play/pause/date HUD around the canvas.
    const sysT = s.systemT || 0;
    const sysSelId = s.systemSel || 'luna';
    const bodyName = (id) => (t.sysBody && t.sysBody[id]) || id;
    const sysSelDef = SYS_BODY_BY_ID[sysSelId] || SYS_BODY_BY_ID.luna;
    const sysSt = sysSelDef.status;
    this._panelKey = sysSelId;
    this._panelColor = sysSelDef.color || '#698ca0';
    const sysDet = BODY_DETAIL[sysSelId] || null;
    const sysSelMoons = (sysSelDef.moons || []).map(m => ({
      id: m.id, name: bodyName(m.id), onSelect: () => this.selectSystemPlanet(m.id)
    }));
    const systemSel = {
      name: bodyName(sysSelDef.id),
      color: sysSelDef.color || '#9a9fa3',
      kind: (t.sysKind && t.sysKind[sysSelDef.kind]) || sysSelDef.kind,
      status: (t.sysStatus && t.sysStatus[sysSt]) || sysSt,
      statusColor: sysSt === 'home' ? '#0bc6ab' : sysSt === 'hostile' ? '#f17260' : (sysSt === 'mined' || sysSt === 'origin') ? '#5cb572' : '#b3b8bc',
      orbitLabel: sysSelDef.moon ? t.sysOrbitMoon : t.sysOrbit,
      orbit: sysSelDef.moon
        ? (t.orbitsWord + ' ' + bodyName(sysSelDef.parent) + ' · ' + sysSelDef.km + ' ' + t.kmUnit)
        : String(sysSelDef.au || '').replace('AU', t.auUnit),
      note: (t.sysNote && t.sysNote[sysSelDef.id]) || '',
      isMoon: !!sysSelDef.moon,
      isHome: !!sysSelDef.home,
      hasDetail: !!sysDet,
      owner: sysDet ? ((t.sysOwnerV && t.sysOwnerV[sysDet.owner]) || sysDet.owner) : '',
      ownerColor: sysDet ? (OWNER_COLOR[sysDet.owner] || '#99a7b0') : '',
      pop: sysDet ? sysDet.pop : '',
      res: sysDet ? sysDet.res.map(r => (t.sysResV && t.sysResV[r]) || r) : [],
      buildings: sysDet ? String(sysDet.buildings) : '0',
      moons: sysSelMoons,
      hasMoons: sysSelMoons.length > 0
    };
    // P4.3 — colonisation actions for the selected body.
    const colDef = COLONISABLE[sysSelId];
    if (colDef) {
      const surveyed = (s.surveys || {})[sysSelId] != null;
      const outpost = (s.outposts || {})[sysSelId];
      const shipCount = Economy.fleetCount(s.fleets, 'Colony Ship');
      const yCode = colDef.yield.code;
      const yName = (t.resName && t.resName[yCode]) || yCode;
      systemSel.colony = {
        surveyed, owned: !!outpost,
        level: outpost ? outpost.level : 0,
        yieldLabel: '+' + (colDef.yield.perTick * (outpost ? outpost.level : 1)) + ' ' + yName + ' / ' + (t.perCycle || 'cycle'),
        surveyLabel: (t.sysSurvey || 'Survey') + ' · ' + fmtNum(colDef.surveyCost) + ' CR',
        claimLabel: (t.sysClaim || 'Establish outpost') + ' · ' + fmtNum(colDef.claimCost) + ' CR + 1 ' + ((t.fleetTypeName && t.fleetTypeName['Colony Ship']) || 'Colony Ship'),
        upgradeLabel: outpost && outpost.level < 3 ? ((t.sysUpgrade || 'Upgrade') + ' · ' + fmtNum(colDef.upgradeCost[outpost.level - 1]) + ' CR') : '',
        canSurvey: !surveyed && !outpost,
        canClaim: surveyed && !outpost && shipCount >= 1,
        claimBlocked: surveyed && !outpost && shipCount < 1,
        canUpgrade: !!outpost && outpost.level < 3,
        shipHint: t.sysColonyShipHint || 'Commission a Colony Ship from Fleet Command',
        onSurvey: () => this.surveyBody(sysSelId),
        onClaim: () => this.claimBody(sysSelId),
        onUpgrade: () => this.upgradeOutpost(sysSelId)
      };
    } else {
      systemSel.colony = { surveyed: false, owned: false, canSurvey: false, canClaim: false, claimBlocked: false, canUpgrade: false, onSurvey: () => {}, onClaim: () => {}, onUpgrade: () => {} };
    }
    const sysFleetsHidden = !!s.sysFleetsHidden;

    // colony calendar — 3600 ticks (at ×1) = one Earth year
    const _days = sysT * (365.25 / 3600);
    const _dt = new Date(Date.UTC(2247, 2, 1) + _days * 86400000);
    const _p2 = (n) => (n < 10 ? '0' + n : '' + n);
    const systemDate = _dt.getUTCFullYear() + '.' + _p2(_dt.getUTCMonth() + 1) + '.' + _p2(_dt.getUTCDate());
    const systemSpeed = s.systemSpeed || 1;
    const systemPaused = !!s.systemPaused;
    const milkyWayTex = MILKYWAY_TEX;

    // ---- Home-planet (Luna) globe: sector-marker chips ----
    // The sphere itself is Three.js now (PlanetGlobe3D). Its OrthographicCamera
    // is framed to match projectGlobe() exactly, so these chips — still plain
    // HTML positioned by projectGlobe — land right on the rendered disc.
    const gYaw = (s.planetYaw || 0) * Math.PI / 180;
    const gPitch = (s.planetPitch || 0) * Math.PI / 180;
    const gRoll = (s.planetRoll || 0) * Math.PI / 180;
    const gp = (lat, lon) => projectGlobe(lat, lon, gYaw, gPitch, gRoll);
    const globePx = 520;

    const globeSectors = PLANET_SECTORS.map(p => {
      const q = gp(p.lat, p.lon);
      const front = q.z > 0.04;
      return {
        id: p.id,
        leftPct: (q.x / 2).toFixed(2) + '%',
        topPct: (q.y / 2).toFixed(2) + '%',
        opacity: front ? (0.28 + 0.72 * q.z).toFixed(2) : '0',
        scale: (0.66 + 0.34 * Math.max(0, q.z)).toFixed(2),
        chipLabel: p.home ? t.youAreHere : p.label,
        chipBg: p.home ? 'rgba(77, 31, 0, 0.9)' : 'rgba(19, 5, 2, 0.72)',
        chipBorder: p.home ? '#f7ac4d' : 'rgba(185, 141, 122, 0.5)',
        chipColor: p.home ? '#ffd374' : '#dfbca6',
        dot: p.home ? '#f7ac4d' : '#aa7963'
      };
    });

    const menuNeutral = { accent: '#3e4a51', color: '#e1e5e8' };
    const menuDanger = { accent: 'rgba(211, 142, 34, 0.6)', color: '#f5ae4b' };
    const menuItems = [
      Object.assign({ label: t.menu.resume, onClick: this.closeMenu }, menuNeutral),
      Object.assign({ label: t.menu.save, onClick: this.saveGame }, menuNeutral),
      Object.assign({ label: t.menu.load, onClick: this.gotoLoadFromMenu }, menuNeutral),
      Object.assign({ label: t.menu.settings, onClick: this.closeMenu }, menuNeutral),
      Object.assign({ label: t.menu.help, onClick: this.openHelp }, menuNeutral),
      Object.assign({ label: t.menu.exit, onClick: this.toMainMenu }, menuDanger)
    ];

    // --- How to Play / Codex overlay ---
    // Whole catalog is derived straight from SHELF_ITEMS + the live tech
    // status, so it can never drift from what the build shelf actually offers.
    const cx = t.codex || {};
    const rn = (code) => (t.resName && t.resName[code]) || code;
    // Chain-only intermediate goods (Timber, Frames, …) are English in the data.
    const chainRn = (nm) => (t.chainRes && t.chainRes[nm]) || nm;
    const staffLbl = (type) => (t.tip && t.tip.staffType && t.tip.staffType[type]) || type;
    const perCyc = t.perCycle || 'cyc';
    const codexGuide = (cx.guide || []).map(g => ({ heading: g.h, body: g.p }));
    const codexTxt = '#c5ccd0';
    // One flat card — every row (incl. tags + a lock warning) lives in `rows`
    // with its own colour, so the template needs no per-card conditionals no
    // matter how deep the tier > category > building nesting gets.
    const codexItem = (it) => {
      const rows = [{ k: cx.cost, v: (it.cost || 0) + ' CR', c: codexTxt }];
      if (!it.connector) {
        const mat = this._materialCost(it.cost || 0);
        if (mat > 0) rows.push({ k: cx.material, v: mat + ' OR', c: codexTxt });
        rows.push({ k: cx.upkeep, v: '−' + Math.max(1, Math.round((it.cost || 0) / 20)) + ' CR/' + perCyc, c: codexTxt });
      }
      if (it.connector) rows.push({ k: cx.type, v: cx.connector, c: codexTxt });
      else if (it.chain) rows.push({ k: cx.output, v: chainRn(it.chain.outputName) + ' +' + it.rate + '/' + perCyc, c: codexTxt });
      else if (it.warehouse) rows.push({ k: cx.capacity, v: '+' + fmtNum(it.capBonus || 0) + ' ' + (it.warehouseFor ? rn(it.warehouseFor) : cx.everyGood), c: codexTxt });
      else if (it.depositBased) rows.push({ k: cx.output, v: cx.dependsDeposit + ' (+' + it.rate + '/' + perCyc + ')', c: codexTxt });
      else if (it.crTaxBonus) rows.push({ k: cx.output, v: '+' + Math.round(it.crTaxBonus * 100) + '% ' + ((t.det && t.det.taxes) || 'tax') + (it.rpBonus ? ' · +' + it.rpBonus + ' RP' : ''), c: codexTxt });
      else if (it.upkeepDiscount) rows.push({ k: cx.output, v: '−' + Math.round(it.upkeepDiscount * 100) + '% ' + ((t.det && t.det.upkeep) || 'upkeep') + ' · ' + (cx.crimeReduction || 'reduces crime, staffed raids fizzle'), c: codexTxt });
      else if (it.fleetUpkeepDiscount) {
        rows.push({ k: cx.output, v: '−' + Math.round(it.fleetUpkeepDiscount * 100) + '% ' + (cx.fleetUpkeep || 'fleet upkeep'), c: codexTxt });
        if (it.dockBays) rows.push({ k: cx.dockBays || 'Docking bays', v: '+' + it.dockBays, c: codexTxt });
      }
      else if (it.crimeReduction) rows.push({ k: cx.output, v: '−' + it.crimeReduction + ' ' + (cx.crimePoints || 'crime'), c: codexTxt });
      else if (it.fleetEffBonus) rows.push({ k: cx.output, v: '+' + Math.round(it.fleetEffBonus * 100) + '% ' + (cx.fleetEff || 'fleet effectiveness'), c: codexTxt });
      else if (it.unlocksShipType) rows.push({ k: cx.output, v: (cx.unlocksShip || 'Unlocks') + ': ' + ((t.fleetTypeName && t.fleetTypeName[it.unlocksShipType]) || it.unlocksShipType), c: codexTxt });
      else if (it.arrivals) {
        rows.push({ k: cx.arrivals || 'Immigration', v: '+' + it.arrivals + ' ' + (cx.colonists || 'colonists') + '/' + perCyc, c: codexTxt });
        if (it.dockBays) rows.push({ k: cx.dockBays || 'Docking bays', v: '+' + it.dockBays, c: codexTxt });
      }
      else if (it.out === 'PO') rows.push({ k: cx.housing || 'Housing', v: '+' + fmtNum((it.rate || 0) * 100) + ' ' + (cx.places || 'places'), c: codexTxt });
      else if (it.haulerCap) rows.push({ k: cx.haulerCap || 'Hauler capacity', v: '+' + it.haulerCap, c: codexTxt });
      else if (it.refineFrom) {
        rows.push({ k: cx.refineNeeds || 'Consumes', v: rn(it.refineFrom) + ' ' + it.rate + '/' + perCyc, c: codexTxt });
        rows.push({ k: cx.output, v: rn(it.out) + ' +' + it.rate + '/' + perCyc, c: codexTxt });
      }
      else if (it.out) rows.push({ k: cx.output, v: rn(it.out) + ' +' + it.rate + '/' + perCyc, c: codexTxt });
      if (it.logiRange) rows.push({ k: cx.logiZone || 'Coverage zone', v: it.logiRange + ' ' + (cx.cells || 'cells'), c: codexTxt });
      if (it.staffType) rows.push({ k: cx.jobs, v: (it.staffCount || 0) + ' ' + staffLbl(it.staffType), c: codexTxt });
      if (it.fuelType) rows.push({ k: cx.fuel, v: '−' + it.fuelRate + ' ' + rn(it.fuelType) + '/' + perCyc, c: codexTxt });
      const tags = [];
      if (it.arrivals) tags.push(cx.tagSpaceport);
      if (it.out === 'PO') tags.push(cx.tagHousing);
      if (it.haulerCap) tags.push(cx.tagHangar);
      if (it.logiRange) tags.push(cx.tagLogiNode);
      if (it.out === 'SC') tags.push(cx.tagScience);
      if (it.refineFrom) tags.push(cx.tagRefiner);
      if (it.dayOnly) tags.push(cx.tagDay);
      if (it.fuelType) tags.push(cx.tagFuel);
      if (it.depositBased) tags.push(cx.tagDeposit);
      if (it.chain) tags.push(cx.tagChain);
      if (it.unique) tags.push(cx.tagUnique);
      if (tags.length) rows.push({ k: '—', v: tags.join(' · '), c: '#99a7b0' });
      const ln = TECH_UNLOCK_BUILDING[it.mono];
      const locked = !!ln && this.techStatus(ln) !== 'unlocked';
      if (locked) {
        const lnName = (t.d && t.d.tech && t.d.tech[ln.id] && t.d.tech[ln.id].name) || ln.name;
        rows.push({ k: '⚠', v: (cx.needsTech || 'Needs research') + ': ' + lnName, c: '#dd9c42' });
      }
      return {
        name: bldName(it.name) || it.name, mono: it.mono, rows,
        cardBorder: locked ? 'rgba(211, 142, 34, 0.35)' : PANEL_BORDER,
        nameColor: locked ? '#99a7b0' : '#e7ecef'
      };
    };
    const codexTierNm = cx.tierName || ['Tier I', 'Tier II', 'Tier III'];
    const codexTierDs = cx.tierDesc || ['', '', ''];
    const codexLoc = s.codexLoc || 'moon';
    // Within a tier, buildings are grouped by category so each category sits
    // on its own row. Empty groups (no building of that category in the tier)
    // are dropped. On the belt tab there are simply no tiers yet.
    const codexCats = codexLoc === 'belt' ? BELT_CATS : BUILD_CATS;
    const codexTierRange = codexLoc === 'belt' ? [2, 3] : [1, 2, 3];
    const codexTiers = codexTierRange.map(tier => {
      const groups = [];
      codexCats.forEach(cat => {
        const items = (SHELF_ITEMS[cat.id] || []).filter(it => (it.tier || 1) === tier).map(codexItem);
        if (items.length) groups.push({ category: catName(cat.label), items });
      });
      return { tier, name: codexTierNm[tier - 1] || ('Tier ' + tier), desc: codexTierDs[tier - 1] || '', groups };
    });
    const codexLocTabs = [
      { id: 'moon', label: cx.locMoon || 'Luna' },
      { id: 'belt', label: cx.locBelt || 'Asteroid Belt' }
    ].map(x => ({
      label: x.label, onClick: () => this.setCodexLoc(x.id),
      bg: codexLoc === x.id ? 'rgba(0, 140, 116, 0.22)' : 'transparent',
      color: codexLoc === x.id ? TEAL : '#b2b9bd',
      border: codexLoc === x.id ? 'rgba(11, 198, 171, 0.5)' : PANEL_BORDER
    }));
    const codexChains = [];
    Object.keys(SHELF_ITEMS).forEach(catId => (SHELF_ITEMS[catId] || []).forEach(it => {
      if (it.chain) {
        codexChains.push({
          name: bldName(it.name) || it.name,
          inputs: it.chain.sources.map(sc => ({ building: bldName(sc.name) || sc.name, res: chainRn(sc.inputName) })),
          output: chainRn(it.chain.outputName), rate: it.rate + '/' + perCyc
        });
      } else if (it.refineFrom) {
        // Refiners have no source building — they pull their input from the
        // shared stockpile (whatever the SC labs put there).
        codexChains.push({
          name: bldName(it.name) || it.name,
          inputs: [{ building: cx.fromStock || 'colony stockpile', res: rn(it.refineFrom) }],
          output: rn(it.out), rate: it.rate + '/' + perCyc
        });
      }
    }));

    const sb0 = s.selectedBuilding;
    const sbIsHangar = sb0.mono === 'HG';
    const selectedBuildingOut = { ...sb0, name: bldName(sb0.name), category: catName(sb0.category), isWarehouse: sb0.kind === 'warehouse', isHangar: sbIsHangar };
    // Fleet + logistics readout — shown on both the warehouse and hangar panels.
    selectedBuildingOut.showFleet = sb0.kind === 'warehouse' || sbIsHangar;
    if (selectedBuildingOut.showFleet) {
      const avail = s.whMachines || 0;
      const fleetCap = Economy.haulerCapacity(s.placed);
      const slotN = Math.min(12, fleetCap);
      selectedBuildingOut.machinesAvail = avail;
      selectedBuildingOut.machinesTotal = fleetCap;
      selectedBuildingOut.machinesLabel = avail + ' / ' + fleetCap;
      selectedBuildingOut.machinesIdle = fleetCap - avail;
      selectedBuildingOut.machineSlots = [];
      for (let i = 0; i < slotN; i++) selectedBuildingOut.machineSlots.push({ on: i < avail });
      selectedBuildingOut.dispatchColor = avail < fleetCap ? '#b9bfc2' : '#43494c';
      selectedBuildingOut.recallColor = avail > 0 ? '#b9bfc2' : '#43494c';
      const dem = Economy.logisticsDemand(s.placed, s.links);
      const totalProd = dem.covered + dem.uncovered;
      const served = avail * Economy.HAULER_SERVES;
      selectedBuildingOut.logiLabel = dem.covered + ' / ' + totalProd;
      selectedBuildingOut.logiPct = Math.min(100, Math.round(dem.covered / Math.max(1, totalProd) * 100)) + '%';
      selectedBuildingOut.logiShort = dem.uncovered > 0 || served < dem.covered;
      selectedBuildingOut.logiColor = selectedBuildingOut.logiShort ? '#f78955' : '#62bb78';
      selectedBuildingOut.fleetShort = served < dem.covered;
    }
    if (sbIsHangar) {
      selectedBuildingOut.bayCapLabel = '+' + (sb0.haulerCap || 5);
      // this bay's rough share of the parked (recalled) fleet
      const parkedHere = Math.max(0, Math.min(sb0.haulerCap || 5, selectedBuildingOut.machinesIdle));
      selectedBuildingOut.baySlots = [];
      for (let i = 0; i < (sb0.haulerCap || 5); i++) selectedBuildingOut.baySlots.push({ on: i < parkedHere });
      selectedBuildingOut.bayParkedLabel = parkedHere + ' / ' + (sb0.haulerCap || 5);
    }
    // Spaceport panel — immigration throughput + ship/rocket docking bays.
    selectedBuildingOut.isPort = (sb0.arrivals || 0) > 0;
    if (selectedBuildingOut.isPort) {
      const bays = sb0.dockBays || 0;
      const colonyBays = Economy.dockCapacity(s.placed, s.links);
      const shipsHome = Economy.fleetTotal(s.fleets);
      const parkedHere = Math.max(0, Math.min(bays, shipsHome - (colonyBays - bays)));
      selectedBuildingOut.portArrivalsLabel = '+' + sb0.arrivals + ' / ' + (t.perCycle || 'cycle');
      selectedBuildingOut.portColonyArrivals = '+' + fmtNum(Economy.arrivalCapacity(s.placed, s.links)) + ' / ' + (t.perCycle || 'cycle');
      selectedBuildingOut.portBaysLabel = parkedHere + ' / ' + bays;
      selectedBuildingOut.portColonyBaysLabel = shipsHome + ' / ' + colonyBays;
      selectedBuildingOut.portBaysFull = shipsHome >= colonyBays;
      selectedBuildingOut.portBaySlots = [];
      for (let i = 0; i < bays; i++) selectedBuildingOut.portBaySlots.push({ on: i < parkedHere });
    }
    if (sb0.kind === 'warehouse') {
      const capTable = Economy.storageCapacity(s.placed);
      const storageCodes = sb0.warehouseFor ? [sb0.warehouseFor] : ['CR'].concat(Object.keys(capTable));
      selectedBuildingOut.storage = storageCodes.map(code => {
        const amount = Math.round(s.resources[code] || 0);
        const uncapped = code === 'CR';
        const cap = uncapped ? amount : (capTable[code] || 0);
        return {
          code,
          label: (t.res && t.res[code]) || code,
          amount: fmtNum(amount),
          cap: uncapped ? '∞' : fmtNum(cap),
          pct: (uncapped ? 100 : Math.min(100, Math.round(amount / Math.max(1, cap) * 100))) + '%',
          full: !uncapped && amount >= cap,
          color: STORAGE_COLOR[code] || '#93a1a9'
        };
      });
      selectedBuildingOut.warehouseKindLabel = sb0.warehouseFor
        ? (t.whSpecializedFor || 'Specialized:') + ' ' + ((t.res && t.res[sb0.warehouseFor]) || sb0.warehouseFor)
        : (t.whGeneric || 'General storage');
      selectedBuildingOut.hasFullStorage = selectedBuildingOut.storage.some(r => r.full);
    }

    // Anno-style module upgrades (placed production buildings only)
    const mods = sb0.modules || [];
    selectedBuildingOut.canUpgrade = !!s.selectedPlacedId && sb0.kind !== 'warehouse' && !!selectedBuildingOut.hasProduction;
    selectedBuildingOut.moduleCount = mods.length;
    selectedBuildingOut.moduleMax = MODULE_MAX;
    selectedBuildingOut.moduleLabel = mods.length + ' / ' + MODULE_MAX;
    selectedBuildingOut.moduleFull = mods.length >= MODULE_MAX;
    selectedBuildingOut.canAddModule = mods.length < MODULE_MAX;
    selectedBuildingOut.moduleSlots = [];
    for (let i = 0; i < MODULE_MAX; i++) {
      const m = mods[i];
      selectedBuildingOut.moduleSlots.push(m
        ? { on: true, mono: (MODULE_BY_ID[m.moduleId] || {}).mono || '?', onRemove: ((idx) => () => this.removeModule(idx))(i) }
        : { on: false, mono: '', onRemove: () => {} });
    }
    // Demolish + repair (placed buildings only).
    selectedBuildingOut.isPlaced = !!s.selectedPlacedId;
    if (s.selectedPlacedId) {
      const dInfo = MONO_INFO[sb0.mono] || {};
      const dCr = Math.round((dInfo.cost || 0) * 0.5), dOr = Math.round(this._materialCost(dInfo.cost || 0) * 0.5);
      selectedBuildingOut.demolishRefund = '+' + dCr + ' CR · +' + dOr + ' OR';
      selectedBuildingOut.demolishRefundShort = '+' + dCr + (dOr ? '·' + dOr : '');
      const hp = sb0.hp == null ? 100 : sb0.hp;
      selectedBuildingOut.hpPct = Math.round(hp) + '%';
      selectedBuildingOut.hpBarPct = Math.max(0, Math.min(100, hp)) + '%';
      selectedBuildingOut.hpColor = hp <= 5 ? '#ed4b40' : hp < 40 ? '#f68c36' : '#5cb572';
      selectedBuildingOut.needsRepair = hp < 100;
      const rc = this._repairCost(sb0.mono, hp);
      selectedBuildingOut.repairCost = rc.cr + ' CR · ' + rc.or + ' OR';
      selectedBuildingOut.repairCostShort = rc.cr + (rc.or ? '·' + rc.or : '');
    }
    const moduleChoices = MODULES.map(m => {
      const afford = (s.resources.CR || 0) >= (m.cr || 0) && (s.resources.OR || 0) >= (m.or || 0);
      return {
        id: m.id,
        mono: m.mono,
        name: (t.mod && t.mod[m.id]) || m.id,
        eff: '+' + m.eff + '%',
        cost: (m.cr || 0) + ' CR · ' + (m.or || 0) + ' OR',
        afford,
        costColor: afford ? '#5cb572' : '#ed7665',
        onPick: afford ? (() => this.pickModule(m.id)) : (() => this._flashActionError('insufficient'))
      };
    });

    const activeBg = 'rgba(0, 140, 116, 0.22)', activeBorder = 'rgba(11, 198, 171, 0.7)', activeColor = '#ade5d7';
    const idleBg = '#243037', idleBorder = 'rgba(222, 230, 234, 0.14)', idleColor = '#b9bfc2';
    const chainPreview = s.activeChain ? {
      sources: s.activeChain.sources.map((src, i, arr) => ({
        mono: src.mono, name: bldName(src.name),
        sep: i < arr.length - 1 ? '+' : '→',
        bg: s.chainSelected === i ? activeBg : idleBg, border: s.chainSelected === i ? activeBorder : idleBorder, color: s.chainSelected === i ? activeColor : idleColor,
        onSelect: () => this.selectChainNode(i)
      })),
      buildingMono: s.activeChain.buildingMono, buildingName: bldName(s.activeChain.buildingName),
      buildingBg: s.chainSelected === 'building' ? activeBg : idleBg, buildingBorder: s.chainSelected === 'building' ? activeBorder : idleBorder, buildingColor: s.chainSelected === 'building' ? activeColor : idleColor,
      onSelectBuilding: () => this.selectChainNode('building')
    } : { sources: [], buildingMono:'', buildingName:'', buildingBg:idleBg, buildingBorder:idleBorder, buildingColor:idleColor };

    const techFilterTabs = FILTER_CATS.map(f => {
      const active = s.techFilter === f;
      return { label: catName(f), onClick: () => this.setTechFilter(f), bg: active ? 'rgba(0, 140, 116, 0.18)' : 'transparent', border: active ? 'rgba(11, 198, 171, 0.5)' : PANEL_BORDER, color: active ? TEAL : '#b2b9bd' };
    });

    const techTab = s.techTab || 'tree';
    const techTabs = [
      { id: 'tree', label: t.techTabTree },
      { id: 'policy', label: t.techTabPolicy }
    ].map(x => ({
      label: x.label,
      onClick: () => this.setTechTab(x.id),
      bg: techTab === x.id ? 'rgba(0, 140, 116, 0.18)' : 'transparent',
      border: techTab === x.id ? 'rgba(11, 198, 171, 0.6)' : PANEL_BORDER,
      color: techTab === x.id ? TEAL : '#b2b9bd'
    }));
    const pc = s.policyChoice || POLICY_DEFAULTS;
    const fxColor = (v) => { const c = String(v).trim()[0]; return (c === '-' || c === '−') ? '#ed7665' : '#62bb78'; };
    const policyCards = POLICIES.map(cat => ({
      id: cat.id,
      name: (t.policyCat && t.policyCat[cat.id]) || cat.id,
      options: cat.opts.map(o => {
        const sel = pc[cat.id] === o.id;
        return {
          id: o.id,
          name: (t.policyOpt && t.policyOpt[o.id]) || o.id,
          selected: sel,
          bg: sel ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
          border: sel ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)',
          dotBg: sel ? '#0bc6ab' : 'transparent',
          dotBorder: sel ? '#0bc6ab' : '#7b8185',
          onPick: () => this.setPolicy(cat.id, o.id),
          fx: o.fx.map(([k, v]) => ({
            label: (t.policyFx && t.policyFx[k]) || k,
            value: v,
            color: fxColor(v)
          }))
        };
      })
    }));

    // ---- Trade routes ----
    const _trOv = s.tradeStatus || {};
    const _allRoutes = TRADE_ROUTES.concat(s.tradeAdded || []);
    // Real per-route income after Naval Escort risk cover and partner
    // relation — matches Economy.tradeIncome exactly, not the sticker price.
    const routeEffectiveIncome = (r) => Math.round((r.income || 0) * Economy.tradeRiskPenalty(r.risk, s.fleets, s.placed) * Economy.tradeRelationMult(s, r.partner));
    const tradeRows = _allRoutes.map(r => {
      const st = _trOv[r.id] || r.status;
      const active = st === 'active';
      const sel = s.tradeSel === r.id;
      return {
        id: r.id, a: r.a, b: r.b, sel, active,
        partnerName: r.partner ? ((((D && D.faction) && D.faction[r.partner]) || {}).name || r.partner) : '',
        hasPartner: !!r.partner,
        cargoColor: CARGO_COLOR[r.cargo] || '#99a7b0',
        cargoIcon: CARGO_ICON[r.cargo] || [],
        cargoName: (t.trCargo && t.trCargo[r.cargo]) || r.cargo,
        vol: r.vol,
        income: (active ? '+' : '') + routeEffectiveIncome(r) + ' CR',
        incomeColor: active ? '#0bc6ab' : '#6e767b',
        trips: r.trips + ' ' + t.trTrips,
        transit: r.days + ' ' + t.trDays,
        riskLabel: (t.trRiskV && t.trRiskV[r.risk]) || r.risk,
        riskColor: RISK_COLOR[r.risk] || '#99a7b0',
        loadPct: Math.round(r.load * 100) + '%',
        statusLabel: (t.trStatus && t.trStatus[st]) || st,
        statusColor: active ? '#0bc6ab' : '#858d92',
        cardBg: sel ? 'rgba(19, 41, 36, 0.35)' : 'rgba(17, 31, 39, 0.6)',
        cardBorder: sel ? 'rgba(11, 198, 171, 0.55)' : 'rgba(222, 230, 234, 0.1)',
        bodyOpacity: active ? '1' : '0.5',
        toggleLabel: active ? t.trPause : t.trResume,
        onSelect: () => this.selectTradeRoute(r.id),
        onToggle: () => this.toggleTradeRoute(r.id, r.status)
      };
    });
    const tradeTotalIncome = Economy.tradeIncome(s);
    const tradeActiveCount = _allRoutes.filter(r => (_trOv[r.id] || r.status) === 'active').length;
    // new-route dialog
    const tnDest = TRADE_DESTS.find(x => x.id === s.tradeNewDest) || null;
    const tnCargo = TRADE_CARGOS.find(x => x.id === s.tradeNewCargo) || null;
    const _routedTo = {};
    _allRoutes.forEach(r => { _routedTo[r.b] = 1; });
    const tradeNewDests = TRADE_DESTS.map(d => {
      const sel = s.tradeNewDest === d.id;
      return {
        id: d.id, name: d.name, sel,
        meta: (t.trTransit || 'transit') + ' ' + d.days + ' ' + (t.trDays || 'd') + ' · ' + ((t.trRiskV && t.trRiskV[d.risk]) || d.risk),
        riskColor: RISK_COLOR[d.risk] || '#99a7b0',
        taken: !!_routedTo[d.name],
        bg: sel ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
        border: sel ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)',
        onPick: () => this.setTradeNewDest(d.id)
      };
    });
    const tradeNewCargos = TRADE_CARGOS.map(c => {
      const sel = s.tradeNewCargo === c.id;
      const dm = tnDest && tnDest.demand && tnDest.demand[c.id];
      return {
        id: c.id, name: (t.trCargo && t.trCargo[c.id]) || c.id, sel,
        icon: CARGO_ICON[c.id] || [],
        color: CARGO_COLOR[c.id] || '#99a7b0',
        demand: dm ? (dm >= 1.4 ? '↑↑' : dm >= 1.1 ? '↑' : '·') : '·',
        bg: sel ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
        border: sel ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)',
        onPick: () => this.setTradeNewCargo(c.id)
      };
    });
    let tnIncome = '—', tnVol = '—', tnDays = '—', tnRisk = '—', tnRiskColor = '#858d92';
    if (tnDest && tnCargo) {
      const mult = (tnDest.demand && tnDest.demand[tnCargo.id]) || 1;
      const vol = 300 + Math.round(mult * 260);
      const inc = Math.round(tnCargo.base * mult * (vol / 260) / 10) * 10;
      tnIncome = '+' + inc + ' CR / ' + (t.trPerCyc || '/ cycle').replace('/ ', '');
      tnVol = vol.toLocaleString('en-US').replace(/,/g, ' ') + ' t';
      tnDays = tnDest.days + ' ' + (t.trDays || 'd');
      tnRisk = (t.trRiskV && t.trRiskV[tnDest.risk]) || tnDest.risk;
      tnRiskColor = RISK_COLOR[tnDest.risk] || tnRiskColor;
    }

    const visibleNodes = TECH_NODES.filter(n => s.techFilter === 'All' || n.category === s.techFilter);
    const rQueue = s.researchQueue || [];
    const rProg = s.researchProgress || {};
    const rpOut = s.researchOutput || 0;
    const nodeName = (id, fallback) => ((D.tech && D.tech[id] && D.tech[id].name) || fallback || id);
    const nodePct = (n) => (n && n.rpCost ? Math.min(100, Math.round(((rProg[n.id] || 0) / n.rpCost) * 100)) : 0);
    const etaSols = (remain) => (rpOut > 0 ? Math.max(0.1, Math.round((remain / rpOut / CYCLES_PER_SOL) * 10) / 10) : null);

    const techNodes = visibleNodes.map(n => {
      const status = this.techStatus(n);
      const selected = s.selectedTechId === n.id;
      const qi = rQueue.indexOf(n.id);
      const td = (D.tech && D.tech[n.id]) || {};
      let bg, border, tagColor, textColor, statusTextColor, statusLabel;
      if (status === 'unlocked') { bg = 'rgba(0, 55, 46, 0.4)'; border = selected ? TEAL : 'rgba(0, 140, 116, 0.55)'; tagColor = TEAL; textColor = '#f3f6f7'; statusTextColor = TEAL; statusLabel = t.status.unlocked; }
      else if (qi === 0) { bg = selected ? 'rgba(2, 49, 41, 0.5)' : 'rgba(1, 37, 39, 0.7)'; border = TEAL; tagColor = TEAL; textColor = '#ebeff2'; statusTextColor = TEAL; statusLabel = (t.researchActiveShort || 'RESEARCHING') + ' ' + nodePct(n) + '%'; }
      else if (qi > 0) { bg = selected ? 'rgba(11, 36, 37, 0.5)' : 'rgba(13, 24, 30, 0.8)'; border = selected ? TEAL : 'rgba(81, 116, 175, 0.5)'; tagColor = '#6c8dc3'; textColor = '#dadfe1'; statusTextColor = '#6e93cf'; statusLabel = (t.researchQueuedShort || 'QUEUED') + ' #' + (qi + 1); }
      else if (status === 'available') { bg = selected ? 'rgba(19, 41, 36, 0.4)' : 'rgba(15, 28, 36, 0.75)'; border = selected ? TEAL : PANEL_BORDER; tagColor = '#858d92'; textColor = '#e4e9eb'; statusTextColor = '#b2b9bd'; statusLabel = t.status.available; }
      else { bg = 'rgba(8, 17, 22, 0.6)'; border = selected ? '#7b8185' : 'rgba(222, 230, 234, 0.08)'; tagColor = MUTED; textColor = MUTED; statusTextColor = MUTED; statusLabel = t.status.locked; }
      return {
        id: n.id, name: td.name || n.name, category: catName(n.category), tier: n.tier,
        leftPx: n.x + 'px', topPx: n.y + 'px', onClick: () => this.selectTechNode(n.id),
        bg, border, tagColor, textColor, statusTextColor, statusLabel,
        progressTrack: (qi >= 0 && status !== 'unlocked') ? '#243037' : 'transparent',
        progressPct: (qi >= 0 && status !== 'unlocked') ? (nodePct(n) + '%') : '0%'
      };
    });

    const connectorLines = visibleNodes.filter(n => n.prereq).map(n => {
      const src = TECH_NODES.find(p => p.id === n.prereq);
      const status = this.techStatus(n);
      return { x1: src.x + 280, y1: src.y + 52, x2: n.x, y2: n.y + 52, stroke: status === 'locked' ? '#363b3f' : 'rgba(0, 140, 116, 0.6)' };
    });

    const selNode = TECH_NODES.find(n => n.id === s.selectedTechId) || TECH_NODES[0];
    const selStatus = this.techStatus(selNode);
    const selQi = rQueue.indexOf(selNode.id);
    const selRemain = Math.max(0, (selNode.rpCost || 0) - (rProg[selNode.id] || 0));
    let btnLabel, btnBg, btnBorder, btnColor, btnCursor, researchDisabled, btnAction;
    if (selStatus === 'unlocked') {
      btnLabel = t.status.unlocked; btnBg = 'transparent'; btnBorder = PANEL_BORDER; btnColor = MUTED; btnCursor = 'default'; researchDisabled = true; btnAction = () => {};
    } else if (selQi >= 0) {
      btnLabel = t.researchUnqueue || 'Remove from queue'; btnBg = 'transparent'; btnBorder = 'rgba(232, 122, 105, 0.4)'; btnColor = '#ef806f'; btnCursor = 'pointer'; researchDisabled = false; btnAction = () => this.unqueueTech(selNode.id);
    } else if (selStatus === 'available') {
      btnLabel = t.researchQueueBtn || 'Add to queue'; btnBg = 'rgba(0, 140, 116, 0.18)'; btnBorder = 'rgba(0, 140, 116, 0.6)'; btnColor = TEAL; btnCursor = 'pointer'; researchDisabled = false; btnAction = () => this.queueTech(selNode.id);
    } else {
      btnLabel = t.status.locked; btnBg = 'transparent'; btnBorder = PANEL_BORDER; btnColor = MUTED; btnCursor = 'default'; researchDisabled = true; btnAction = () => {};
    }
    const selTd = (D.tech && D.tech[selNode.id]) || {};
    const preTd = selNode.prereq ? ((D.tech && D.tech[selNode.prereq]) || {}) : {};
    const selEta = etaSols(selRemain);
    const selectedTechNode = {
      category: catName(selNode.category), name: selTd.name || selNode.name,
      description: selTd.desc || selNode.desc,
      costRp: (selNode.rpCost || 0) + ' ' + (rn('RP')),
      costCr: fmtNum(selNode.crCost || 0) + ' CR',
      hasPrereq: !!selNode.prereq, prereqName: preTd.name || selNode.prereqName,
      inQueue: selQi >= 0,
      progressLabel: (Math.round(rProg[selNode.id] || 0)) + ' / ' + (selNode.rpCost || 0) + ' ' + rn('RP'),
      progressPct: nodePct(selNode) + '%',
      etaLabel: selEta != null ? ('~' + selEta + ' ' + (t.perSol || 'sol')) : '—',
      btnLabel, btnBg, btnBorder, btnColor, btnCursor, researchDisabled, onAction: btnAction
    };

    // Research header strip + ordered queue list.
    const researchActiveNode = rQueue.length ? TECH_NODES.find(n => n.id === rQueue[0]) : null;
    const researchOutputLabel = '+' + (Math.round(rpOut * 10) / 10) + ' ' + rn('RP') + ' / ' + (t.perCycle || 'cycle');
    let researchActiveLabel;
    if (!researchActiveNode) researchActiveLabel = t.researchIdle || 'No active research — output is wasted';
    else {
      const rem = Math.max(0, (researchActiveNode.rpCost || 0) - (rProg[researchActiveNode.id] || 0));
      const e = etaSols(rem);
      researchActiveLabel = nodeName(researchActiveNode.id, researchActiveNode.name) + ' — ' + nodePct(researchActiveNode) + '%'
        + (e != null ? (' · ~' + e + ' ' + (t.perSol || 'sol')) : '');
    }
    const researchQueueList = rQueue.map((id, i) => {
      const n = TECH_NODES.find(x => x.id === id);
      const rem = n ? Math.max(0, (n.rpCost || 0) - (rProg[id] || 0)) : 0;
      const e = i === 0 ? etaSols(rem) : null;
      return {
        id, pos: i + 1, name: nodeName(id, n && n.name),
        active: i === 0,
        pct: (n ? nodePct(n) : 0) + '%',
        barColor: i === 0 ? TEAL : '#577ab5',
        eta: e != null ? ('~' + e + ' ' + (t.perSol || 'sol')) : '',
        canUp: i > 0, canDown: i < rQueue.length - 1,
        onUp: () => this.moveTechInQueue(id, -1),
        onDown: () => this.moveTechInQueue(id, 1),
        onRemove: () => this.unqueueTech(id)
      };
    });
    const researchQueueEmpty = rQueue.length === 0;

    const legendItems = [{ label: t.legend.researched, dot: TEAL }, { label: t.legend.available, dot: '#b2b9bd' }, { label: t.legend.locked, dot: MUTED }];

    const facTreaties = (id) => (s.diploTreaties && s.diploTreaties[id]) || {};
    const diploFactions = FACTIONS.map(f => {
      const fd = (D.faction && D.faction[f.id]) || {};
      const rel = this._rel(f.id);
      const sk = standingKey(rel);
      const trs = facTreaties(f.id);
      return {
        ...f,
        name: fd.name || f.name, descriptor: fd.descriptor || f.descriptor, population: fd.population || f.population,
        selected: s.diploTab === f.id,
        cardBorder: s.diploTab === f.id ? f.accent : withAlpha(f.accent, 0.3),
        emblemBg: f.accent, accentColor: relColor(rel),
        relation: rel, relationPct: rel + '%',
        standingLabel: (t.standing && t.standing[sk]) || sk,
        onSelect: () => this.setDiploTab(f.id),
        treatyBadges: TREATIES.filter(x => trs[x.id]).map(x => (t.treaty && t.treaty[x.id]) || x.id)
      };
    });

    const diploTabs = FACTIONS.map(f => {
      const active = s.diploTab === f.id;
      const fd = (D.faction && D.faction[f.id]) || {};
      return { label: fd.name || f.name, onClick: () => this.setDiploTab(f.id), bg: active ? withAlpha(f.accent, 0.16) : 'transparent', border: active ? withAlpha(f.accent, 0.55) : PANEL_BORDER, color: active ? f.accent : '#b2b9bd' };
    });

    const selFac = FACTIONS.find(f => f.id === s.diploTab) || FACTIONS[0];
    const selFd = (D.faction && D.faction[selFac.id]) || {};
    const selRel = this._rel(selFac.id);
    const selTrs = facTreaties(selFac.id);
    const diploSel = {
      id: selFac.id,
      name: selFd.name || selFac.name,
      accent: selFac.accent,
      relColor: relColor(selRel),
      relation: selRel, relationPct: selRel + '%',
      standingLabel: (t.standing && t.standing[standingKey(selRel)]) || '',
      leader: selFd.leader || selFac.leader,
      stance: selFd.stance || selFac.stance,
      wants: selFd.wants || selFac.wants,
      ally: selFd.ally || selFac.ally
    };
    const diploLadder = STANDING_LADDER.map(l => {
      const cur = standingKey(selRel) === l.key;
      return {
        label: (t.standing && t.standing[l.key]) || l.key,
        min: l.min + '+',
        bg: cur ? 'rgba(0, 140, 116, 0.16)' : 'transparent',
        color: relColor(l.min + 1)
      };
    });
    // Ally AI status (Azure Compact) for the diplomacy overlay.
    let allyPanel = { visible: false, log: [], caps: [] };
    if (s.ally && typeof Ally !== 'undefined') {
      const a = s.ally;
      const acaps = Ally.caps(a);
      const astand = Ally.standing(s);
      const held = Ally.sectors(s).length;
      const afd = (D.faction && D.faction[Ally.faction]) || {};
      const rn = a.research ? ALLY_TECH.find(x => x.id === a.research.id) : null;
      const capName = { canScout: t.allyCapScout || 'Survey network', canClaim: t.allyCapClaim || 'Colonial charter', canAid: t.allyCapAid || 'Mutual aid', canGiftSector: t.allyCapGift || 'Joint logistics' };
      allyPanel = {
        visible: true,
        name: afd.name || 'AZURE COMPACT',
        standingLabel: (t.standing && t.standing[astand.key]) || astand.key,
        standingColor: relColor(astand.rel),
        strength: String(a.strength),
        buildings: String(a.buildings),
        sectors: String(held),
        techLabel: a.tech.length + ' / ' + ALLY_TECH.length,
        researchLabel: rn ? ((rn.name[lang] || rn.name.ru) + ' · ' + Math.min(100, Math.round(a.research.progress / rn.cost * 100)) + '%')
                          : (t.allyResearchDone || 'development tree complete'),
        hasResearch: !!rn,
        caps: Object.keys(capName).filter(k => acaps[k]).map(k => ({ label: capName[k] })),
        hasCaps: Object.keys(capName).some(k => acaps[k]),
        log: (a.log || []).slice(0, 5).map(e => ({ text: (e.text && (e.text[lang] || e.text.ru)) || '', sol: (t.solPrefix || 'SOL') + ' ' + e.sol })),
        hasLog: (a.log || []).length > 0,
        strengthLabel: t.allyStrength || 'Strength',
        buildingsLabel: t.allyBuildings || 'Structures',
        sectorsLabel: t.allySectors || 'Sectors held',
        techTitle: t.allyTech || 'Development',
        researchTitle: t.allyResearch || 'Researching',
        capsTitle: t.allyCaps || 'Capabilities',
        logTitle: t.allyActivity || 'Recent activity',
        title: t.allyTitle || 'Allied operation'
      };
    }

    const giftCost = 400 + Math.round(selRel * 6);
    const diploActionBtns = [
      { key: 'envoy', label: t.dEnvoy, tone: 'good', onClick: () => this.diploAct('envoy') },
      { key: 'gift', label: (t.dGift || 'Gift') + ' · ' + giftCost + ' CR', tone: 'good', onClick: () => this.diploAct('gift') },
      { key: 'sanction', label: t.dSanction, tone: 'bad', onClick: () => this.diploAct('sanction') }
    ].map(b => ({
      label: b.label,
      onClick: b.onClick,
      bg: b.tone === 'bad' ? 'transparent' : 'rgba(0, 140, 116, 0.14)',
      border: b.tone === 'bad' ? 'rgba(238, 167, 67, 0.4)' : 'rgba(0, 140, 116, 0.45)',
      color: b.tone === 'bad' ? '#eea743' : '#0bc6ab'
    }));
    const diploTreatyBtns = TREATIES.map(tr => {
      const on = !!selTrs[tr.id];
      const locked = !on && selRel < tr.req;
      return {
        name: (t.treaty && t.treaty[tr.id]) || tr.id,
        fx: (t.treatyFx && t.treatyFx[tr.id]) || '',
        onClick: () => this.toggleTreaty(tr.id),
        stateLabel: on ? t.treatyActive : (locked ? (t.treatyNeeds + ' ' + tr.req) : t.treatySign),
        actionLabel: on ? t.treatyBreak : t.treatySign,
        on: on, locked: locked,
        border: on ? 'rgba(92, 181, 114, 0.6)' : (locked ? 'rgba(222, 230, 234, 0.1)' : 'rgba(11, 198, 171, 0.4)'),
        color: on ? '#62bb78' : (locked ? '#585f62' : '#b9bfc2'),
        btnColor: on ? '#eea743' : (locked ? '#50565a' : '#0bc6ab'),
        cursor: locked ? 'default' : 'pointer'
      };
    });

    const fleetTypeName = (type) => (t.fleetTypeName && t.fleetTypeName[type]) || type;
    const fleetStatusName = (st) => (t.fleetStatus && t.fleetStatus[st]) || st;
    const fleetGroups = s.fleets.map(g => {
      const gd = (D.fleet && D.fleet[g.id]) || {};
      return {
        ...g, name: gd.name || fleetTypeName(g.type), type: gd.type || fleetTypeName(g.type), status: fleetStatusName(gd.status || g.status),
        selected: s.selectedFleetId === g.id, onSelect: () => this.selectFleet(g.id), onDisband: () => this.disbandFleet(g.id),
        bg: s.selectedFleetId === g.id ? 'rgba(0, 140, 116, 0.12)' : 'rgba(17, 31, 39, 0.6)', border: s.selectedFleetId === g.id ? 'rgba(0, 140, 116, 0.5)' : PANEL_BORDER
      };
    });
    const tradeCapacityUsed = Economy.activeTradeRouteCount(s);
    const tradeCapacityTotal = Economy.tradeCapacity(s.fleets);
    const dockUsed = Economy.fleetTotal(s.fleets);
    const dockTotal = Economy.dockCapacity(s.placed, s.links);
    const dockFull = dockUsed >= dockTotal;
    const fleetBuildTypes = FLEET_TYPES.map(type => {
      const selected = s.fleetBuildType === type;
      return {
        type, label: fleetTypeName(type), cost: (SHIP_COST[type] || 0) + ' CR', selected,
        onSelect: () => this.setFleetBuildType(type),
        bg: selected ? 'rgba(0, 140, 116, 0.16)' : 'transparent',
        border: selected ? 'rgba(0, 140, 116, 0.5)' : 'rgba(222, 230, 234, 0.14)'
      };
    });

    // Real economy figures — everything below is derived from s.placed /
    // s.links / s.resources / s.population, driven by _runEconomyTick().
    const isLunarDay = Economy.isLunarDay(s.cycle);
    const pwBreakdown = Economy.powerBreakdown(s.placed, s.policyChoice, isLunarDay, s.techOverride);
    const pwBalance = pwBreakdown.produced - pwBreakdown.consumed;
    const scFlow = Economy.scFlow(s);
    const scCap = Economy.storageCapacity(s.placed).SC || 0;
    const habCapacityDisplay = Math.max(Economy.habitationCapacity(s.placed), s.population);
    const staff = Economy.staffStatus(s);
    const colonyEventCount = (s.colonyEvents || []).length;
    const popData = {
      total: s.population, capacity: habCapacityDisplay,
      worker: staff.filled.worker, workerDemand: staff.demand.worker,
      engineer: staff.filled.engineer, engineerDemand: staff.demand.engineer,
      scientist: staff.filled.scientist, scientistDemand: staff.demand.scientist,
      military: staff.filled.military, militaryDemand: staff.demand.military,
      unemployed: staff.unemployed, dependents: staff.dependents,
      arrivalCap: Economy.arrivalCapacity(s.placed, s.links),
      growth: Math.round(s.popGrowthAccum || 0), happiness: Math.round(ecoIndexValue),
      foodNeeded: foodStatus.needed, foodStock: Math.round(foodStatus.stock),
      waterNeeded: waterStatus.needed, waterStock: Math.round(waterStatus.stock),
      commsCoverage: Math.round(Economy.commsStatus(s).satisfaction * 100) + '%',
      medCoverage: Math.round(Economy.medStatus(s).satisfaction * 100) + '%',
      crBreakdown: Economy.creditBreakdown(s), pwBreakdown,
      scBreakdown: { produced: scFlow.produced, refined: scFlow.refined, stock: Math.round(s.resources.SC || 0), cap: scCap }
    };

    // Live problem list — recomputed every render from current colony state,
    // not a log. Rendered as a strip under the top bar when non-empty.
    const warn = t.warn || {};
    const wResName = t.resName || {};
    const colonyWarnings = [];
    if (pwBalance < 0) colonyWarnings.push({ text: (warn.power || 'Power deficit') + ' ' + pwBalance + ' MW', sev: 'bad' });
    if (foodStatus.satisfaction < 0.5) colonyWarnings.push({ text: warn.foodCrit || 'Colonists are starving', sev: 'bad' });
    else if (foodStatus.satisfaction < 1) colonyWarnings.push({ text: warn.food || 'Food shortfall — growth slowed', sev: 'warn' });
    if (waterStatus.satisfaction < 0.5) colonyWarnings.push({ text: warn.waterCrit || 'Colonists are dehydrated', sev: 'bad' });
    else if (waterStatus.satisfaction < 1) colonyWarnings.push({ text: warn.water || 'Water shortfall — growth slowed', sev: 'warn' });
    const commsStatusW = Economy.commsStatus(s);
    const medStatusW = Economy.medStatus(s);
    if (commsStatusW.satisfaction < 1) colonyWarnings.push({ text: warn.comms || 'Comms coverage short — morale & research down', sev: 'warn' });
    if (medStatusW.satisfaction < 0.5) colonyWarnings.push({ text: warn.medCrit || 'Medical coverage critical — attrition rising', sev: 'bad' });
    else if (medStatusW.satisfaction < 1) colonyWarnings.push({ text: warn.med || 'Medical coverage short — morale down', sev: 'warn' });
    const stStat = Economy.storageStatus(s);
    Object.keys(stStat).forEach(code => {
      if (stStat[code].full) colonyWarnings.push({ text: (warn.storageFull || 'Storage full:') + ' ' + (wResName[code] || code), sev: 'warn' });
    });
    const logiDemW = Economy.logisticsDemand(s.placed, s.links);
    if (logiDemW.uncovered > 0) colonyWarnings.push({ text: logiDemW.uncovered + ' ' + (warn.uncovered || 'producers outside every logistics zone'), sev: 'warn' });
    ['worker', 'engineer', 'scientist', 'military'].forEach(k => {
      if (staff.demand[k] > 0 && staff.fillRatio[k] < 0.75) colonyWarnings.push({ text: (warn.understaffed || 'Understaffed:') + ' ' + ((t.pop && t.pop[k]) || k), sev: 'warn' });
    });
    const wornCount = (s.placed || []).filter(b => (b.hp == null ? 100 : b.hp) < 40 && !(MONO_INFO[b.mono] || {}).warehouse && (MONO_INFO[b.mono] || {}).out !== 'PO').length;
    if (wornCount > 0) colonyWarnings.push({ text: wornCount + ' ' + (warn.wear || 'buildings below 40% HP — production dropping'), sev: 'bad' });
    if ((s.researchOutput || 0) > 0 && (s.researchQueue || []).length === 0) colonyWarnings.push({ text: warn.researchIdle || 'Research output wasted — queue is empty', sev: 'warn' });
    if (Economy.arrivalCapacity(s.placed, s.links) > 0 && Economy.habitationCapacity(s.placed) - s.population <= 0) colonyWarnings.push({ text: warn.noHousing || 'No free housing — arrivals blocked', sev: 'warn' });
    // Active hazards → warnings strip.
    (s.activeHazards || []).forEach(h => {
      if ((h.until || 0) <= s.cycle) return;
      const solsLeft = Math.ceil((h.until - s.cycle) / 24);
      const hn = (t.hazard && t.hazard[h.type]) || {};
      colonyWarnings.push({ text: (hn.name || h.type) + ' — ' + solsLeft + ' ' + (t.perSol || 'sol'), sev: 'bad' });
    });
    colonyWarnings.forEach(w => { w.dotColor = w.sev === 'bad' ? '#ff6053' : '#efa831'; });
    // bad first, then warnings; cap the strip
    colonyWarnings.sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
    const warningCount = colonyWarnings.length;
    const colonyWarningsShown = colonyWarnings.slice(0, 5);

    // Objective checklist — live progress, completed ones sink to the bottom.
    const objDone = s.objectivesDone || [];
    const objCx = t.objectives || {};
    const objectivesList = OBJECTIVES.map(o => {
      const done = objDone.indexOf(o.id) !== -1;
      const cur = done ? o.target : Math.max(0, Math.round(Economy.objectiveValue(s, o)));
      const oi = objCx[o.id] || {};
      const rw = o.reward || {};
      const rewardParts = ['+' + fmtNum(rw.cr || 0) + ' CR'];
      if (rw.res) for (const k in rw.res) rewardParts.push('+' + fmtNum(rw.res[k]) + ' ' + k);
      return {
        id: o.id, done,
        name: oi.name || o.id,
        desc: oi.desc || '',
        progress: fmtNum(Math.min(cur, o.target)) + ' / ' + fmtNum(o.target),
        pct: Math.min(100, Math.round(cur / o.target * 100)) + '%',
        reward: rewardParts.join('  ·  '),
        barColor: done ? '#62bb78' : '#0bc6ab'
      };
    }).sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
    const objectivesActiveCount = objectivesList.filter(o => !o.done).length;

    // Story dialogue panel (non-blocking, bottom-centre; the sim keeps running).
    let storyModal = { open: false, choices: [] };
    const stStory = s.story || {};
    if (stStory.activeId && typeof Story !== 'undefined') {
      const info = Story.node(stStory.activeId, stStory.node, lang, stStory.flags);
      const dlg = Story.dialogue(stStory.activeId);
      const rawNode = dlg && dlg.nodes[stStory.node];
      if (info) {
        const sp = Story.speaker(info.speaker);
        const pickL = (o) => (o && (o[lang] || o.ru || o.en)) || '';
        storyModal = {
          open: true,
          glyph: sp.glyph,
          glyphColor: sp.color,
          speakerName: pickL(sp.name),
          speakerRole: pickL(sp.role),
          text: info.text,
          choices: info.choices.map(c => {
            const raw = (rawNode && rawNode.choices && rawNode.choices[c.index]) || {};
            const hint = Story.effectHint(raw.effects, lang);
            return {
              label: c.label,
              hint,
              hasHint: !!hint,
              locked: c.locked,
              lockLabel: c.locked ? ((t.err && t.err.locked) || 'Требуется условие') : '',
              onChoose: () => this.storyChoose(c.index),
              rowColor: c.locked ? MUTED : '#eef1f4',
              borderColor: c.locked ? PANEL_BORDER : 'rgba(11, 198, 171, 0.4)'
            };
          })
        };
      }
    }

    return {
      t,
      storyModal,
      langLabel: t.langLabel,
      toggleLang: this.toggleLang,
      stageRef: this.stageRef,
      stageTransform: 'scale(' + s.scale + ')',
      stageLeft: s.offsetX + 'px',
      stageTop: s.offsetY + 'px',
      colonyName,
      solLabel: (t.solPrefix || 'SOL') + ' ' + sd.sol,
      solTime: sd.hourLabel,
      dayNightLabel: isLunarDay ? (t.lunarDay || 'DAY') : (t.lunarNight || 'NIGHT'),
      dayNightColor: isLunarDay ? AMBER : '#768997',
      speedTabs: [
        { id: 0, label: '❚❚', on: s.gamePaused },
        { id: 1, label: '1×', on: !s.gamePaused && (s.gameSpeed || 1) === 1 },
        { id: 2, label: '2×', on: !s.gamePaused && s.gameSpeed === 2 },
        { id: 4, label: '4×', on: !s.gamePaused && s.gameSpeed === 4 }
      ].map(x => ({
        label: x.label,
        onClick: () => this.setGameSpeed(x.id),
        bg: x.on ? 'rgba(0, 140, 116, 0.3)' : 'transparent',
        color: x.on ? TEAL : '#9fa6aa',
        border: x.on ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.14)'
      })),
      speedHint: t.speedHint || 'Simulation speed',
      resources: [
        { code: 'CR', value: fmtNum(Math.round(s.resources.CR)), dotColor: TEAL },
        { code: 'PO', value: fmtNum(s.population), dotColor: '#b9bfc2' },
        { code: 'PW', value: fmtNum(pwBalance) + ' MW', dotColor: AMBER },
        { code: 'SC', value: fmtNum(Math.round(s.resources.SC || 0)), dotColor: '#8797ef' }
      ].map(r => {
        const key = r.code.toLowerCase();
        const show = s.resHover === key;
        return {
          code: r.code, value: r.value, dotColor: r.dotColor, key: key,
          icon: RES_ICON[r.code] || [],
          label: (t.resName && t.resName[r.code]) || r.code,
          onEnter: () => this.setState({ resHover: key }),
          onLeave: () => this.setState({ resHover: null }),
          showPopup: show,
          popup: show ? buildResPopup(key, t, popData) : { kind: '', income: [], expense: [], lines: [] }
        };
      }),
      ecoBarWidth: ecoIndexValue + '%',
      ecoIndexDisplay: ecoIndexValue + '%',
      stabilityBarWidth: stabilityValue + '%',
      stabilityDisplay: stabilityValue + '%',
      techTabs,
      isTechTree: techTab === 'tree',
      isPolicyTab: techTab === 'policy',
      policyCards,
      policyHint: t.policyHint,
      colonyRes: [
        { label: 'CR', delta: s.lastDeltas.CR, pos: s.lastDeltas.CR >= 0 },
        { label: 'PW', delta: pwBalance, pos: pwBalance >= 0 },
        { label: 'PO', delta: s.lastDeltas.PO, pos: s.lastDeltas.PO >= 0 }
      ].map(r => ({
        label: r.label,
        balance: (r.pos ? '+' : '−') + fmtNum(Math.abs(Math.round(r.delta))),
        icon: RES_ICON[r.label] || [],
        color: r.pos ? '#62bb78' : '#ed7665'
      })),
      colPopTotal: fmtNum(popData.total),
      colPopCap: fmtNum(popData.capacity),
      colPopRows: [
        { label: t.pop.worker, value: fmtNum(popData.worker), w: (popData.worker / popData.total * 100 || 0).toFixed(0) + '%', color: '#009880' },
        { label: t.pop.engineer, value: fmtNum(popData.engineer), w: (popData.engineer / popData.total * 100 || 0).toFixed(0) + '%', color: '#eea743' },
        { label: t.pop.scientist, value: fmtNum(popData.scientist), w: (popData.scientist / popData.total * 100 || 0).toFixed(0) + '%', color: '#aa8dde' },
        { label: t.pop.military, value: fmtNum(popData.military), w: (popData.military / popData.total * 100 || 0).toFixed(0) + '%', color: '#e55551' },
        { label: t.pop.unemployed, value: fmtNum(popData.unemployed), w: (popData.unemployed / popData.total * 100 || 0).toFixed(0) + '%', color: '#e18528' },
        { label: t.pop.dependents, value: fmtNum(popData.dependents), w: (popData.dependents / popData.total * 100 || 0).toFixed(0) + '%', color: '#617581' }
      ],
      colGrowthLabel: t.colGrowth,
      colGrowthValue: (popData.growth >= 0 ? '+' : '−') + fmtNum(Math.abs(Math.round(popData.growth))) + ' / ' + t.colPerCycle.replace('/ ', ''),
      colResLabel: t.colRes,
      colPerCycle: t.colPerCycle,
      colInfraLabel: t.colInfra,
      colonyInfra: BUILD_CATS.map(c => ({
        label: catName(c.label),
        count: c.id === 'infra' ? s.links.length : s.placed.filter(b => b.category === c.label).length
      })),
      hasNotifs: NOTIFICATIONS.length + colonyEventCount + warningCount > 0,
      notifCount: NOTIFICATIONS.length + colonyEventCount + warningCount,
      notifBadgeColor: warningCount > 0 ? '#e95145' : '#bc7400',
      colonyWarnings: colonyWarningsShown,
      hasWarnings: warningCount > 0,
      objectivesList,
      objectivesOpen: !!s.objectivesOpen,
      toggleObjectives: this.toggleObjectives,
      objectivesTitle: t.objectivesTitle || 'Objectives',
      objectivesActiveLabel: objectivesActiveCount + ' / ' + OBJECTIVES.length,
      objectivesDoneCount: OBJECTIVES.length - objectivesActiveCount,
      warningCount,
      warningsTitle: t.warningsTitle || 'Attention',
      isNotifOpen: s.notifOpen,
      toggleNotif: this.toggleNotif,
      musicPlaying: s.musicPlaying,
      musicPaused: !s.musicPlaying,
      musicTitle: (TRACKS[s.musicTrack] || TRACKS[0]).title,
      musicArtist: (TRACKS[s.musicTrack] || TRACKS[0]).artist,
      musicElapsed: mmss(s.musicPos),
      musicTotal: mmss(s.musicDur || 0),
      musicPct: (s.musicDur ? (s.musicPos / s.musicDur * 100) : 0).toFixed(1) + '%',
      musicVolPct: Math.round((s.musicVol == null ? 0.7 : s.musicVol) * 100),
      volFillDeg: ((s.musicVol == null ? 0.7 : s.musicVol) * 270).toFixed(0) + 'deg',
      volAngle: ((s.musicVol == null ? 0.7 : s.musicVol) * 270 - 135).toFixed(0) + 'deg',
      volPointerDown: this.volPointerDown,
      volWheel: this.volWheel,
      audioRef: this.audioRef,
      toggleMusic: this.toggleMusic,
      musicNext: this.musicNext,
      musicPrev: this.musicPrev,
      onAudioTime: this.onAudioTime,
      onAudioMeta: this.onAudioMeta,
      onAudioDur: this.onAudioDur,
      onAudioPlay: this.onAudioPlay,
      onAudioPause: this.onAudioPause,
      onAudioEnded: this.onAudioEnded,
      musicIcon: s.musicPlaying ? MUSIC_ICON.on : MUSIC_ICON.off,
      musicBtnColor: s.musicPlaying ? TEAL : '#c9cfd2',
      isLaunch: !s.launched,
      startGame: this.startGame,
      backLaunch: this.backLaunch,
      launch: t.launch,
      launchMain: !s.launchScreen,
      isLaunchNew: s.launchScreen === 'new',
      isLaunchLoad: s.launchScreen === 'load',
      isLaunchSettings: s.launchScreen === 'settings',
      launchItems: [
        { label: t.launch.newGame, primary: true, desc: t.launch.newDesc, act: () => this.openLaunchScreen('new') },
        { label: t.launch.cont, primary: false, desc: t.launch.contDesc, act: this.startGame },
        { label: t.launch.load, primary: false, desc: '', act: () => this.openLaunchScreen('load') },
        { label: t.launch.settings, primary: false, desc: '', act: () => this.openLaunchScreen('settings') },
        { label: t.launch.credits, primary: false, desc: '', act: this.startGame }
      ].map(it => ({
        label: it.label, desc: it.desc, onClick: it.act,
        fontSize: it.primary ? '30px' : '22px',
        color: it.primary ? '#93ebd7' : '#ccd2d5'
      })),
      ngNames: NEW_NAMES.map(n => ({
        name: n, sel: s.newGameName === n, onPick: () => this.setNewGameName(n),
        bg: s.newGameName === n ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
        border: s.newGameName === n ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)'
      })),
      ngDiffs: ['pioneer', 'standard', 'terraformer'].map(d => ({
        name: t.launch.diff[d], desc: t.launch.diffDesc[d], sel: s.newGameDiff === d,
        onPick: () => this.setNewGameDiff(d),
        bg: s.newGameDiff === d ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
        border: s.newGameDiff === d ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)'
      })),
      ngSites: ['plain', 'gale', 'mariner'].map(k => ({
        name: t.launch.siteN[k], desc: t.launch.siteDesc[k], sel: s.newGameSite === k,
        onPick: () => this.setNewGameSite(k),
        bg: s.newGameSite === k ? 'rgba(0, 140, 116, 0.16)' : 'rgba(19, 33, 41, 0.6)',
        border: s.newGameSite === k ? 'rgba(11, 198, 171, 0.6)' : 'rgba(222, 230, 234, 0.1)'
      })),
      beginNewGame: this.beginNewGame,
      loadSlots: SAVE_SLOTS.map(sl => {
        const data = SaveSystem.load(sl.id);
        if (!data) {
          return { empty: true, filled: false, name: '', meta: '', play: '', tag: sl.auto ? t.launch.slotAuto : '', onClick: this.backLaunch };
        }
        const ageMin = Math.max(0, Math.floor((Date.now() - (data.savedAt || 0)) / 60000));
        const ageStr = ageMin < 1 ? t.launch.justNow
          : ageMin < 60 ? (ageMin + ' ' + t.launch.minAgo)
          : ageMin < 1440 ? (Math.floor(ageMin / 60) + ' ' + t.launch.hourAgo)
          : (Math.floor(ageMin / 1440) + ' ' + t.launch.dayAgo);
        return {
          empty: false, filled: true,
          name: data.colonyNameOverride || colonyName,
          meta: 'Cycle ' + (data.cycle || 0) + ' · pop. ' + fmtNum(data.population || 0),
          play: ageStr,
          tag: sl.auto ? t.launch.slotAuto : '',
          onClick: () => this.loadSave(sl.id)
        };
      }),
      setMusicDown: () => this._setVol((s.musicVol == null ? 0.7 : s.musicVol) - 0.1),
      setMusicUp: () => this._setVol((s.musicVol == null ? 0.7 : s.musicVol) + 0.1),
      musicVolPct: Math.round((s.musicVol == null ? 0.7 : s.musicVol) * 100) + '%',
      prefReduceMotion: !!s.prefReduceMotion,
      togglePrefReduceMotion: this.togglePrefReduceMotion,
      pmTrackColor: s.prefReduceMotion ? TEAL_MID : '#2c3439',
      pmKnobLeft: s.prefReduceMotion ? '18px' : '2px',
      isMenuOpen: s.menuOpen,
      toggleMenu: this.toggleMenu,
      closeMenu: this.closeMenu,
      menuItems,
      notifications: (s.colonyEvents || []).map(e => ({ text: e.text, time: e.time, dotColor: e.sev === 'bad' ? '#ff6557' : e.sev === 'info' ? TEAL : '#757b7f' }))
        .concat((t.notifSeed || NOTIFICATIONS).map((n, i) => ({ text: n.text, time: n.time || NOTIFICATIONS[i] && NOTIFICATIONS[i].time || '', dotColor: n.sev === 'warning' ? AMBER : n.sev === 'info' ? TEAL : '#757b7f' }))),
      railButtons,
      isBuildingSelected: s.buildingPanelOpen,
      toggleBuildingSelect: this.toggleBuildingSelect,
      isBuildPanel: s.activePanel === 'build' && !foreignStatus,
      buildCategoryTabs,
      activeItems,
      hasShelfTip: !!shelfTip,
      shelfTip: shelfTip || { name: '', category: '', rows: [] },
      hasChainPreview: !!s.activeChain,
      chainPreview,
      selectedBuilding: selectedBuildingOut,
      moduleChoices,
      isModuleMenu: !!s.moduleMenuOpen,
      toggleModuleMenu: this.toggleModuleMenu,
      placedModules,
      whDispatch: this.whDispatch,
      whRecall: this.whRecall,
      deposits,
      placedBuildings,
      foreignBanner,
      foreignBuildings,
      buildLinks,
      roadHaulers,
      logiZones,
      linkGhost,
      placeGhost,
      connectorStartGhost,
      buildWorldLeft: this._curPanX() + 'px',
      buildWorldTop: this._curPanY() + 'px',
      buildWorldW: (BUILD_GRID.cols * BUILD_GRID.cell) + 'px',
      buildWorldH: (BUILD_GRID.rows * BUILD_GRID.cell) + 'px',
      regionTabs: [
        { id: 'luna', label: t.regionLuna || 'Luna' },
        ...(this.beltUnlocked() ? [{ id: 'belt', label: t.regionBelt || 'Asteroid Belt' }] : []),
        ...SECTORS.filter(sc => this.sectorStatus(sc.id) === 'owned')
          .map(sc => ({ id: sc.id, label: (t.sectorWord || 'Sector') + ' ' + sc.num }))
      ].map(x => ({
        label: x.label, onClick: () => this.setRegion(x.id),
        bg: (s.activeRegion || 'luna') === x.id ? 'rgba(0, 140, 116, 0.22)' : 'rgba(22, 33, 39, 0.7)',
        color: (s.activeRegion || 'luna') === x.id ? TEAL : '#abb2b7',
        border: (s.activeRegion || 'luna') === x.id ? 'rgba(11, 198, 171, 0.6)' : PANEL_BORDER
      })),
      showRegionTabs: this.beltUnlocked() || SECTORS.some(sc => this.sectorStatus(sc.id) === 'owned'),
      isPlacing: !!s.placing || !!s.placingModule,
      isConnectorMode: !!(s.placing && s.placing.kind === 'connector'),
      isDemolishMode,
      demolishBtnBg: isDemolishMode ? 'rgba(131, 27, 17, 0.5)' : 'transparent',
      startDemolish: this.startDemolish,
      demolishSelected: this.demolishSelected,
      repairBuilding: this.repairBuilding,
      buildCursor: s.placing ? 'crosshair' : 'grab',
      placeTint: isDemolishMode ? 'rgba(206, 82, 71, 0.08)' : (s.placing ? 'rgba(0, 140, 116, 0.06)' : 'transparent'),
      placingName: s.placingModule
        ? ((t.mod && t.mod[s.placingModule.moduleId]) || s.placingModule.moduleId)
        : (isDemolishMode ? (t.demolish || 'Demolish') : (s.placing ? bldName(s.placing.name) : '')),
      placeHintText: s.placingModule ? t.placeModuleHint : (isDemolishMode ? (t.demolishHint || 'Click a building or road to remove it') : (s.placing && s.placing.kind === 'connector' ? t.placeConnectorHint : t.placeHint)),
      hasActionError: !!s.actionError,
      actionErrorMsg: s.actionError ? ((t.err && t.err[s.actionError]) || s.actionError) : '',
      buildPointerDown: this.buildPointerDown,
      buildPointerMove: this.buildPointerMove,
      buildPointerUp: this.buildPointerUp,
      cancelPlace: this.cancelPlace,
      showDetailedStats,
      isCityPanel: s.activePanel === 'city',
      isTradePanel: s.activePanel === 'trade',
      isFleetPanel: s.activePanel === 'fleet',
      closePanel: this.closePanel,
      tradeRoutes: tradeRows,
      openTradeNew: this.openTradeNew,
      closeTradeNew: this.closeTradeNew,
      confirmTradeNew: this.confirmTradeNew,
      isTradeNew: !!s.tradeNewOpen,
      tradeNewDests,
      tradeNewCargos,
      tradeNewCanConfirm: !!(tnDest && tnCargo),
      tradeNewDisabled: !(tnDest && tnCargo),
      tnIncome, tnVol, tnDays, tnRisk, tnRiskColor,
      tnConfirmBg: (tnDest && tnCargo) ? 'rgba(0, 140, 116, 0.2)' : 'rgba(22, 33, 39, 0.5)',
      tnConfirmColor: (tnDest && tnCargo) ? '#ade5d7' : '#636a6f',
      tradeSummary: {
        income: '+' + tradeTotalIncome.toLocaleString('en-US').replace(/,/g, ' ') + ' CR',
        per: t.trPerCyc,
        active: tradeActiveCount + ' / ' + _allRoutes.length,
        // Real Cargo Transport capacity (Economy.tradeCapacity), not a
        // fixed mock ceiling — build more transports to run more routes.
        slots: tradeCapacityUsed + ' / ' + tradeCapacityTotal,
        incomeLabel: t.trIncome, activeLabel: t.trActive, slotsLabel: t.trCapacity
      },
      fleetGroups,
      fleetDockLabel: dockUsed + ' / ' + dockTotal,
      fleetDockColor: dockFull ? '#f78955' : '#62bb78',
      fleetDockFull: dockFull,
      fleetDockRowLabel: t.fleetDock || 'Docking bays',
      fleetDockHint: t.fleetDockHint || 'Every ship needs a bay — build spaceports to expand.',
      fleetBuildOpen: !!s.fleetBuildOpen,
      fleetBuildClosed: !s.fleetBuildOpen,
      fleetBuildTypes,
      openFleetBuild: this.openFleetBuild,
      closeFleetBuild: this.closeFleetBuild,
      confirmFleetBuild: this.confirmFleetBuild,
      fleetBuildConfirmDisabled: !s.fleetBuildType,
      renewableTrackColor: s.policyRenewable ? TEAL_MID : '#2c3439',
      renewableKnobLeft: s.policyRenewable ? '18px' : '2px',
      overtimeTrackColor: s.policyOvertime ? TEAL_MID : '#2c3439',
      overtimeKnobLeft: s.policyOvertime ? '18px' : '2px',
      toggleRenewable: this.toggleRenewable,
      toggleOvertime: this.toggleOvertime,
      isTechOverlay: s.activeOverlay === 'tech',
      isDiplomacyOverlay: s.activeOverlay === 'diplomacy',
      isCodexOverlay: s.activeOverlay === 'codex',
      codexTitle: cx.title || 'How to Play',
      codexSub: cx.sub || '',
      codexSecGuide: cx.secGuide || 'Guide',
      codexSecBuildings: cx.secBuildings || 'Buildings',
      codexSecChains: cx.secChains || 'Production chains',
      codexGuide,
      codexTiers,
      codexLocTabs,
      codexShowMoon: codexLoc === 'moon',
      codexShowBelt: codexLoc === 'belt' && !this.beltUnlocked(),
      codexBeltTitle: cx.beltTitle || 'Asteroid Belt — not yet reachable',
      codexBeltBody: cx.beltBody || '',
      codexChains,
      isMapOverlay: s.activeOverlay === 'map',
      openMap: this.openMap,
      mapBuildings,
      mapViewport,
      mapBuildingCount: s.placed.length,
      mapCategoryCounts,
      mapEmpty: s.placed.length === 0,
      mapSectors,
      mapSectorPanel,
      regionLabel: (function () {
        const r = s.activeRegion || 'luna';
        if (r === 'luna') return t.sectorSub;
        if (r === 'belt') return t.regionBelt || 'Asteroid Belt';
        const sc = SECTORS.find(x => x.id === r);
        return sc ? ((t.sectorWord || 'Sector') + ' ' + sc.num) : t.sectorSub;
      })(),
      mapWorldTransform,
      mapWorldTransition,
      mapWorldW,
      mapWorldH,
      mapZoomLabel,
      mapScopeLabel,
      mapHint: t.mapHint,
      isSystemOverlay: s.activeOverlay === 'system',
      openSystem: this.openSystem,
      sysCanvasRef: this.sysCanvasRef,
      sysToggleFleets: this.sysToggleFleets,
      sysFleetsHidden,
      sysFleetBtnColor: sysFleetsHidden ? 'rgba(16, 34, 43, 0.55)' : 'rgba(0, 140, 116, 0.4)',
      systemSel,
      sysHint: t.sysHint3d || t.sysHint,
      systemDate,
      systemPaused,
      sysPauseIcon: systemPaused ? '▶' : 'II',
      sysSpd1: () => this.sysSpeed(1),
      sysSpd10: () => this.sysSpeed(10),
      sysSpd100: () => this.sysSpeed(100),
      sysTogglePause: this.sysTogglePause,
      sysSpdIs1: (!systemPaused && systemSpeed === 1) ? 'rgba(0, 140, 116, 0.4)' : 'rgba(16, 34, 43, 0.55)',
      sysSpdIs10: (!systemPaused && systemSpeed === 10) ? 'rgba(0, 140, 116, 0.4)' : 'rgba(16, 34, 43, 0.55)',
      sysSpdIs100: (!systemPaused && systemSpeed === 100) ? 'rgba(0, 140, 116, 0.4)' : 'rgba(16, 34, 43, 0.55)',
      milkyWayTex,
      sysZoomIn: this.sysZoomIn,
      sysZoomOut: this.sysZoomOut,
      sysResetCamera: this.sysResetCamera,
      isMapPlanet: !!s.mapPlanet,
      mapControlsVisible: !s.mapPlanet,
      globePx,
      marsCanvasRef: this.marsCanvasRef,
      sysPanelCanvasRef: this.sysPanelCanvasRef,
      globeSectors,
      planetName: t.planetName,
      planetViewLabel: t.planetView,
      planetHint: t.planetHint,
      youAreHere: t.youAreHere,
      togglePlanet: this.togglePlanet,
      mapWheel: this.mapWheel,
      mapPointerDown: this.mapPointerDown,
      mapPointerMove: this.mapPointerMove,
      mapPointerUp: this.mapPointerUp,
      mapZoomIn: this.mapZoomIn,
      mapZoomOut: this.mapZoomOut,
      mapZoomReset: this.mapZoomReset,
      toggleMapScope: this.toggleMapScope,
      closeOverlay: this.closeOverlay,
      techFilterTabs,
      legendItems,
      connectorLines,
      techNodes,
      selectedTechNode,
      researchOutputLabel,
      researchActiveLabel,
      researchOutputRowLabel: t.researchOutput || 'Research output',
      researchQueueTitle: t.researchQueueTitle || 'Research queue',
      researchQueueList,
      researchQueueEmpty,
      researchQueueEmptyMsg: t.researchQueueEmpty || 'Queue an available technology to start researching.',
      diploFactions,
      diploTabs,
      diploSel,
      diploLadder,
      diploActionBtns,
      diploTreatyBtns,
      allyPanel,
      diploLog: s.diploLog.map(e => {
        if (e.init) return t.diploInit;
        const fd = (D.faction && D.faction[e.factionId]) || {};
        const fn = fd.name || (FACTIONS.find(f => f.id === e.factionId) || {}).name || '';
        let line = (t.diploAction[e.actionKey] || e.actionKey) + ' ' + fn;
        if (e.extra) line += ' · ' + ((t.treaty && t.treaty[e.extra]) || e.extra);
        if (e.delta != null) line += '  (' + (e.delta > 0 ? '+' : '') + e.delta + ')';
        return line + ' — ' + t.diploJustNow;
      })
    };
  }
}

  return Component;
};
