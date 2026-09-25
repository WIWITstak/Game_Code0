// Game data — plain constants & small pure helpers shared by game.js.
// Loaded as a classic <script> before game.js, in the same global scope
// (no bundler / modules — game.js references these consts by name).
'use strict';

const TEAL = '#0bc6ab';
const TEAL_MID = '#008c74';
const AMBER = '#eea743';
const AMBER_MID = '#b66d00';
const MUTED = '#53595d';
const PANEL_BORDER = 'rgba(222, 230, 234, 0.14)';

const NEW_NAMES = ['Meridian', 'Vanguard', 'Aurora'];
// Just the slot ids/kind — actual name/meta/playtime come from SaveSystem
// (real localStorage data) at render time, not a mock.
const SAVE_SLOTS = [
  { id: 'auto', auto: true },
  { id: 's1', auto: false },
  { id: 's2', auto: false }
];

// Lucide (ISC) icon paths for resources & trade cargo.
const RES_ICON = {
  CR: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8', 'M12 18V6'],
  PW: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  PO: ['M18 21a8 8 0 0 0-16 0', 'M10 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3'],
  RP: ['M4.5 3h15', 'M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3', 'M6 14h12'],
  // Raw research data — a flask glyph, distinct from RP's book.
  SC: ['M9 3h6', 'M10 3v6.5L5.2 17a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L14 9.5V3', 'M7.5 14h9'],
  // Rare metals — a faceted-gem glyph.
  RE: ['M6 3h12l4 6-10 13L2 9Z', 'M11 3 8 9l4 13 4-13-3-6', 'M2 9h20']
};
const CARGO_ICON = {
  algae: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'],
  ore: ['M6 3h12l4 6-10 13L2 9Z', 'm12 22 4-13-3-6', 'M12 22 8 9l3-6', 'M2 9h20'],
  water: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  alloy: ['m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12', 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17'],
  parts: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z']
};

// `popData` is the live { total, capacity, worker/engineer/scientist/military
// (+ their *Demand pairs), unemployed, dependents, growth, happiness,
// foodNeeded, foodStock, crBreakdown, pwBreakdown } computed each render
// from real placed buildings and Economy.staffStatus — see game.js's
// economy tick, never a static mock.
function buildResPopup(key, t, popData) {
  const p = popData, td = t.det || {};
  if (key === 'po') {
    const tp = t.pop || {};
    return {
      kind: 'pop',
      title: (t.resName && t.resName.PO) || 'Population',
      barPct: Math.round(p.total / p.capacity * 100) + '%',
      lines: [
        { label: tp.total, val: fmtNum(p.total) + ' / ' + fmtNum(p.capacity) },
        { label: tp.worker, val: fmtNum(p.worker) + ' / ' + fmtNum(p.workerDemand) },
        { label: tp.engineer, val: fmtNum(p.engineer) + ' / ' + fmtNum(p.engineerDemand) },
        { label: tp.scientist, val: fmtNum(p.scientist) + ' / ' + fmtNum(p.scientistDemand) },
        { label: tp.military, val: fmtNum(p.military) + ' / ' + fmtNum(p.militaryDemand) },
        { label: tp.unemployed, val: fmtNum(p.unemployed) },
        { label: tp.dependents, val: fmtNum(p.dependents) },
        { label: tp.arrivals, val: '+' + fmtNum(p.arrivalCap || 0) + ' / ' + (t.perCycle || 'cycle') },
        { label: tp.growth, val: '~+' + fmtNum(Math.max(0, p.growth)) + ' / ' + (t.perSol || 'sol') },
        { label: tp.happiness, val: p.happiness + '%' },
        { label: tp.food, val: fmtNum(p.foodStock) + ' / ' + fmtNum(p.foodNeeded) },
        { label: tp.water, val: fmtNum(p.waterStock) + ' / ' + fmtNum(p.waterNeeded) },
        { label: tp.comms || 'Comms', val: p.commsCoverage || '—' },
        { label: tp.med || 'Medical', val: p.medCoverage || '—' }
      ]
    };
  }
  if (key === 'cr') {
    const c = p.crBreakdown;
    return {
      kind: 'flow',
      title: (t.resName && t.resName.CR) || 'Credits',
      income: [
        { label: td.taxes, val: '+' + fmtNum(c.taxIncome) },
        { label: td.trade, val: '+' + fmtNum(c.tradeIncome) }
      ],
      expense: [ { label: td.upkeep, val: '-' + fmtNum(c.upkeep) } ],
      net: (c.net >= 0 ? '+' : '') + fmtNum(c.net)
    };
  }
  if (key === 'pw') {
    const w = p.pwBreakdown;
    const net = w.produced - w.consumed;
    return {
      kind: 'flow',
      title: (t.resName && t.resName.PW) || 'Power',
      income: [ { label: td.production, val: '+' + fmtNum(w.produced) + ' MW' } ],
      expense: [ { label: td.consumption, val: '-' + fmtNum(w.consumed) + ' MW' } ],
      net: (net >= 0 ? '+' : '') + fmtNum(net) + ' MW'
    };
  }
  if (key === 'sc') {
    const s = p.scBreakdown || { produced: 0, refined: 0, stock: 0, cap: 0 };
    const net = Math.round((s.produced - s.refined) * 10) / 10;
    return {
      kind: 'flow',
      title: (t.resName && t.resName.SC) || 'Science',
      income: [ { label: td.production, val: '+' + s.produced + ' / ' + (t.perCycle || 'cycle') } ],
      expense: [
        { label: (t.det && t.det.research) || 'Research', val: '-' + s.refined + ' / ' + (t.perCycle || 'cycle') },
        { label: (t.tip && t.tip.warehouse) || 'Storage', val: fmtNum(s.stock) + ' / ' + fmtNum(s.cap) }
      ],
      net: (net >= 0 ? '+' : '') + net + ' / ' + (t.perCycle || 'cycle')
    };
  }
  return null;
}

// Build-shelf hover tooltip. `item` is a raw SHELF_ITEMS entry; chain
// source/output names are English in the data and localised via t.chainRes.
// `matCost` is the already-computed construction-material (Ore) price.
// Every row's label is resolved here (not in the template) so index.html
// only ever binds flat `row.label` / `row.val` — same shape as res.popup.
function buildShelfTooltip(item, catLabel, matCost, t) {
  const tip = t.tip || {};
  const resName = t.resName || {};
  const chainRes = t.chainRes || {};
  const chainRn = (nm) => chainRes[nm] || nm;
  const rows = [{ label: tip.cost || 'Cost', val: (item.cost || 0) + ' CR' }];
  if (item.tier) rows.push({ label: tip.tier || 'Tier', val: 'T' + item.tier });
  if (item.connector) return { category: tip.connector || 'Connector', rows };
  if (matCost > 0) rows.push({ label: tip.material || 'Material', val: matCost + ' OR' });
  rows.push({ label: tip.upkeep || 'Upkeep', val: '-' + Math.max(1, Math.round((item.cost || 0) / 20)) + ' CR / ' + (t.perCycle || 'cycle') });
  if (item.chain) {
    item.chain.sources.forEach(sc => rows.push({ label: (tip.needs || 'Needs') + ' ' + chainRn(sc.inputName), val: item.rate }));
    rows.push({ label: t.output || 'Output', val: chainRn(item.chain.outputName) + ' +' + item.rate });
  } else if (item.warehouse) {
    if (item.warehouseFor) {
      rows.push({ label: tip.specializedCap || 'Capacity', val: '+' + (item.capBonus || 0) + ' ' + (resName[item.warehouseFor] || item.warehouseFor) });
    } else {
      rows.push({ label: tip.genericCap || 'Capacity', val: '+' + (item.capBonus || 0) + ' ' + (tip.everyGood || 'to every good') });
    }
  } else if (item.depositBased) {
    rows.push({ label: t.output || 'Output', val: tip.dependsOnDeposit || 'depends on deposit' });
  } else if (item.crTaxBonus || item.rpBonus) {
    if (item.crTaxBonus) rows.push({ label: tip.taxBonus || 'Tax income', val: '+' + Math.round(item.crTaxBonus * 100) + '%' });
    if (item.rpBonus) rows.push({ label: t.output || 'Output', val: (resName.RP || 'RP') + ' +' + item.rpBonus });
  } else if (item.upkeepDiscount) {
    rows.push({ label: tip.upkeepDiscountLabel || 'Upkeep', val: '-' + Math.round(item.upkeepDiscount * 100) + '%' });
  } else if (item.arrivals) {
    rows.push({ label: tip.arrivals || 'Immigration', val: '+' + item.arrivals + ' ' + (tip.colonists || 'colonists') + ' / ' + (t.perCycle || 'cycle') });
    if (item.dockBays) rows.push({ label: tip.dockBays || 'Docking bays', val: '+' + item.dockBays });
  } else if (item.out === 'PO') {
    rows.push({ label: tip.housing || 'Housing', val: '+' + fmtNum((item.rate || 0) * 100) + ' ' + (tip.places || 'places') });
  } else if (item.haulerCap) {
    rows.push({ label: tip.haulerCap || 'Hauler capacity', val: '+' + item.haulerCap });
  } else if (item.refineFrom) {
    rows.push({ label: (tip.needs || 'Needs') + ' ' + (resName[item.refineFrom] || item.refineFrom), val: item.rate + ' / ' + (t.perCycle || 'cycle') });
    rows.push({ label: t.output || 'Output', val: (resName[item.out] || item.out) + ' +' + item.rate });
  } else if (item.out) {
    rows.push({ label: t.output || 'Output', val: (resName[item.out] || item.out) + ' +' + item.rate });
  }
  if (item.logiRange) rows.push({ label: tip.logiZone || 'Coverage zone', val: item.logiRange + ' ' + (tip.cells || 'cells') });
  if (item.dayOnly) rows.push({ label: tip.dayOnlyLabel || 'Availability', val: tip.dayOnlyVal || 'Day only — dark at night' });
  if (item.fuelType) rows.push({ label: tip.fuel || 'Fuel', val: '-' + item.fuelRate + ' ' + (resName[item.fuelType] || item.fuelType) + ' / ' + (t.perCycle || 'cycle') });
  if (item.staffType) {
    const staffLabel = (tip.staffType && tip.staffType[item.staffType]) || item.staffType;
    rows.push({ label: tip.jobs || 'Jobs', val: (item.staffCount || 0) + ' ' + staffLabel });
  }
  if (item.unique) rows.push({ label: tip.unique || 'Unique', val: tip.oneOnly || 'one per colony' });
  return { category: catLabel, rows };
}

// One economy cycle (4s real time — see game.js's _econTick) = one in-game
// hour; 24 cycles make a Martian sol. Purely derived from st.cycle, so it
// stays correct across save/load with no wall-clock time involved.
function solDate(cycle) {
  const sol = Math.floor(cycle / 24) + 1;
  const hour = cycle % 24;
  return { sol, hourLabel: String(hour).padStart(2, '0') + ':00' };
}

const NOTIFICATIONS = [
  {sev:'info', text:'Trade convoy arrived at Meridian Station from Azure Compact', time:'22m ago'},
  {sev:'neutral', text:'Colony charter ratified — Sector 12 operations nominal', time:'1h ago'}
];

// Colony objectives — an ordered checklist the player works through. Progress
// is computed live by Economy.objectiveValue(st, obj); on completion the
// reward CR lands and a notification fires. `type` picks the metric:
//   pop        — total population
//   housing    — habitation capacity
//   buildings  — count of placed buildings (any region)
//   tech       — number of researched tech nodes
//   sols       — colony age in sols
//   trade      — active trade routes
//   crnet      — net CR / sol (creditBreakdown.net * 24)
//   research   — RP / cycle output
//   outposts   — planet/moon outposts claimed
const OBJECTIVES = [
  { id:'o1',  type:'pop',       target:25,    reward:{cr:1500} },
  { id:'o2',  type:'buildings', target:12,    reward:{cr:2000} },
  { id:'o3',  type:'tech',      target:5,     reward:{cr:2500} },
  { id:'o4',  type:'pop',       target:120,   reward:{cr:4000} },
  { id:'o5',  type:'trade',     target:3,     reward:{cr:3500} },
  { id:'o6',  type:'housing',   target:600,   reward:{cr:5000} },
  { id:'o7',  type:'sols',      target:40,    reward:{cr:4000} },
  { id:'o8',  type:'research',  target:20,    reward:{cr:6000} },
  { id:'o9',  type:'pop',       target:600,   reward:{cr:9000} },
  { id:'o10', type:'crnet',     target:1200,  reward:{cr:8000} },
  { id:'o11', type:'tech',      target:14,    reward:{cr:12000} },
  { id:'o12', type:'outposts',  target:2,     reward:{cr:10000} },
  { id:'o13', type:'sectors',   target:2,     reward:{cr:9000} },
  { id:'o14', type:'pop',       target:2500,  reward:{cr:20000} }
];

// Hazard events — rolled once per sol past MIN_HAZARD_SOL against
// HAZARD_CHANCE_PER_SOL * difficulty. See Economy.runTick.
const MIN_HAZARD_SOL = 8;
const HAZARD_CHANCE_PER_SOL = 0.12;
const HAZARD_DIFF_MULT = { pioneer: 0.4, standard: 1, terraformer: 1.8 };
const HAZARDS = [
  // Dust storm — Solar Arrays go dark and everything else runs at 85% for a
  // few sols. Timed (sits in st.activeHazards until it expires).
  { type:'storm',     weight:3, durSols:3, mag:0.85 },
  // Equipment breakdown — one random road-connected producer drops to ~20 HP.
  { type:'breakdown', weight:4, hpTo:20 },
  // Raid — weak military: lose a slice of a random stockpiled good + hp on one
  // building. Strong military (Garrison + filled military jobs) fizzles it.
  // Weight and severity both scale up with Economy.crimeRate — see runTick.
  { type:'raid',      weight:2, lossFrac:0.25 }
];

// Crime pressure — grows with colony size and idle (unemployed) population,
// cut down by staffed military presence (Garrison jobs). See
// Economy.crimeRate/stability. `stability` (100 - crime) is the
// player-facing positive-framed stat (same convention as Eco Index); crime
// itself feeds three real systems: a small ongoing CR drain (creditBreakdown),
// a morale penalty (_moraleValue), and raid-hazard odds/severity (runTick).
const CRIME_SIZE_CAP = 40;                // max crime contributed by colony size alone
const CRIME_SIZE_DIVISOR = 50;            // population per size-crime point
const CRIME_UNEMPLOYMENT_WEIGHT = 35;     // max crime contributed by 100% unemployment
const CRIME_MILITARY_REDUCTION_PER_JOB = 3; // crime points cut per filled military job
const CRIME_MILITARY_REDUCTION_CAP = 35;
const CRIME_MORALE_PENALTY_MULT = 0.2;    // morale points lost per crime point
const CRIME_LOSS_CR_MULT = 1.5;           // CR/cycle lost to theft & graft per crime point
const CRIME_RAID_WEIGHT_MULT = 0.02;      // extra raid-hazard weight per crime point (0-100 -> up to 3x)
const CRIME_RAID_SEVERITY_MIN_MULT = 0.6; // raid severity floor (fraction of base lossFrac) at 0 crime, rising to 1.0 at 100

// Icons: Lucide (ISC License) path data inlined (SVG files also in assets/icons/ for reference).
const RAIL_ICONS = {
  build: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  city: ['M10 12h4', 'M10 8h4', 'M14 21v-3a2 2 0 0 0-4 0v3', 'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2', 'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16'],
  trade: ['M8 3 4 7l4 4', 'M4 7h16', 'M16 21l4-4-4-4', 'M20 17H4'],
  fleet: ['M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5', 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09', 'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05'],
  tech: ['M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M12 2v2', 'M12 20v2', 'M17 2v2', 'M17 20v2', 'M7 2v2', 'M7 20v2', 'M2 7h2', 'M2 12h2', 'M2 17h2', 'M20 7h2', 'M20 12h2', 'M20 17h2'],
  diplomacy: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75']
};
const RAIL_DEFS = [
  {id:'build', label:'Build Menu', mono:'BD', icon: RAIL_ICONS.build},
  {id:'city', label:'Colony Overview', mono:'CO', icon: RAIL_ICONS.city},
  {id:'trade', label:'Trade Routes', mono:'TR', icon: RAIL_ICONS.trade},
  {id:'fleet', label:'Fleet Command', mono:'FL', icon: RAIL_ICONS.fleet},
  {id:'tech', label:'Technology', mono:'TC', icon: RAIL_ICONS.tech},
  {id:'diplomacy', label:'Faction Relations', mono:'DI', icon: RAIL_ICONS.diplomacy}
];

const BUILD_CATS = [
  {id:'habitation', label:'Habitation'},
  {id:'industry', label:'Industry'},
  {id:'ecology', label:'Ecology'},
  {id:'energy', label:'Energy'},
  {id:'public', label:'Public Works'},
  {id:'infra', label:'Infrastructure'}
];
// Buildings placeable only in the asteroid-belt region (P4.2). Same MONO_INFO
// treatment; `region:'belt'` on the shelf item keeps them out of the Luna menu.
const BELT_CATS = [
  {id:'beltmine', label:'Belt Mining'},
  {id:'beltinfra', label:'Belt Infrastructure'}
];

// Colony build grid — fills the entire 1920x1080 stage, edge to edge, behind
// all UI chrome (top bar, panels, icon rail all float above it, same as any
// real strategy game). BUILD_GRID is a world bigger than that screen so the
// camera can still pan sideways/around it.
const BUILD_VIEW = { x: 0, y: 0, w: 1920, h: 1080 };
const BUILD_GRID = { cols: 56, rows: 22, cell: 60 };
// Soft per-category zone tint drawn under each placed building's cell.
const ZONE_COLOR = {
  Habitation: 'rgba(69, 170, 222, 0.16)',
  Industry: 'rgba(214, 150, 59, 0.16)',
  Ecology: 'rgba(92, 181, 114, 0.16)',
  Energy: 'rgba(227, 194, 59, 0.16)',
  'Public Works': 'rgba(174, 150, 218, 0.16)',
  Logistics: 'rgba(147, 161, 169, 0.14)'
};
const ZONE_BORDER = {
  Habitation: 'rgba(69, 170, 222, 0.4)',
  Industry: 'rgba(214, 150, 59, 0.4)',
  Ecology: 'rgba(92, 181, 114, 0.4)',
  Energy: 'rgba(227, 194, 59, 0.4)',
  'Public Works': 'rgba(174, 150, 218, 0.4)',
  Logistics: 'rgba(147, 161, 169, 0.35)'
};
// Visual style for player-built connectors (road / conveyor belt / pipeline).
const LINK_STYLE = {
  road:     { w: 12, bg: '#31393f', border: 'rgba(108, 115, 119, 0.7)', cls: '' },
  conveyor: { w: 14, bg: '#987600',   border: 'rgba(13, 24, 30, 0.85)', cls: 'conveyor-strip' },
  pipe:     { w: 9,  bg: '#006768',  border: 'rgba(11, 198, 171, 0.8)', cls: 'pipe-glow' }
};

// Package/crate icon (Lucide) for warehouses — buildings otherwise reuse the
// nav-rail / cargo icon sets so every category reads as a distinct silhouette
// instead of one identical house glyph.
const PACKAGE_ICON = ['M11 21.73a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z', 'M12 22V12', 'm3.3 7 8.7 5 8.7-5', 'M7.5 4.27l9 5.15'];
const BUILDING_ICON = {
  Habitation: RAIL_ICONS.build,
  Industry: CARGO_ICON.alloy,
  Ecology: CARGO_ICON.algae,
  Energy: RES_ICON.PW,
  'Public Works': RAIL_ICONS.city,
  Logistics: PACKAGE_ICON
};
const ZONE_ICON_COLOR = {
  Habitation: '#7ac8f5',
  Industry: '#f4b768',
  Ecology: '#83d494',
  Energy: '#eacc56',
  'Public Works': '#cdb7f6',
  Logistics: '#c5ccd0'
};

// Colony policy — one option per category, each with trade-off effects.
const POLICIES = [
  { id:'energy',  def:'renew',       opts:[
    { id:'renew',   fx:[['eco','+6%'],['power','-4%']] },
    { id:'nuclear', fx:[['power','+12%'],['eco','-3%'],['cr','-2%']] },
    { id:'fossil',  fx:[['power','+8%'],['cr','+3%'],['eco','-10%']] } ] },
  { id:'labor',   def:'standard',    opts:[
    { id:'standard', fx:[['happy','+4%']] },
    { id:'overtime', fx:[['prod','+10%'],['happy','-8%']] },
    { id:'auto',     fx:[['prod','+6%'],['cr','-4%'],['jobs','-5%']] } ] },
  { id:'migration', def:'controlled', opts:[
    { id:'open',       fx:[['pop','+2/cyc'],['happy','-2%']] },
    { id:'controlled', fx:[['pop','+1/cyc']] },
    { id:'specialist', fx:[['research','+1'],['pop','+0.5/cyc']] } ] },
  { id:'ecology', def:'balanced',    opts:[
    { id:'strict',   fx:[['eco','+10%'],['prod','-6%']] },
    { id:'balanced', fx:[['eco','+2%']] },
    { id:'growth',   fx:[['prod','+8%'],['eco','-8%']] } ] },
  { id:'science', def:'applied',     opts:[
    { id:'fundamental', fx:[['research','+2'],['cr','-3%']] },
    { id:'applied',     fx:[['research','+1'],['prod','+3%']] },
    { id:'military',    fx:[['military','+1'],['research','-1']] } ] }
];
const POLICY_DEFAULTS = {};
POLICIES.forEach(p => { POLICY_DEFAULTS[p.id] = p.def; });

// Every building carries a `tier` (1 foundational · 2 established colony · 3
// advanced lunar tech). Tier is organizational for now — the How-to-Play
// codex groups by it; hard gating still comes from the tech tree
// (TECH_UNLOCK_BUILDING). Tier-3 buildings are simply bigger and pricier.
//
// Population split: `out:'PO'` buildings are HOUSING — they only widen
// habitationCapacity (`rate` * 100 places) and produce nothing per cycle.
// Colonists actually *arrive* through a spaceport (`arrivals` = colonists
// per cycle it can process, road-connected + staffed); no spaceport, no
// growth. The per-sol batched arrival + notification is Economy.runTick.
const SHELF_ITEMS = {
  habitation: [
    {name:'Habitat Spire', cost:240, mono:'HS', out:'PO', rate:14, tier:1},
    {name:'Skyline Tower', cost:410, mono:'ST', out:'PO', rate:26, tier:2},
    // Comms signal — colony-wide coverage (Economy.commsStatus): full coverage
    // lifts morale and speeds research, a shortfall dents morale.
    {name:'Comm. Dome', cost:150, mono:'CD', out:'CX', rate:8, staffType:'worker', staffCount:1, tier:1},
    // Deep-buried mega-habitat — the colony's tier-3 housing answer.
    {name:'Arcology Spire', cost:820, mono:'AS', out:'PO', rate:46, staffType:'worker', staffCount:4, tier:3},
    // Spaceports — one per tier. The only way colonists reach the colony
    // (`arrivals` = colonists per cycle it can process); `dockBays` is the
    // parking it provides for fleet ships & colonist rockets — the colony's
    // total dock capacity caps how many ships Fleet Command can commission.
    {name:'Landing Pad', cost:220, mono:'LP', arrivals:3, dockBays:6, staffType:'worker', staffCount:1, tier:1},
    {name:'Spaceport', cost:480, mono:'SP', arrivals:8, dockBays:12, staffType:'worker', staffCount:3, tier:2},
    {name:'Orbital Terminal', cost:900, mono:'OT', arrivals:18, dockBays:24, staffType:'engineer', staffCount:4, tier:3}
  ],
  industry: [
    {name:'Assembly Yard', cost:320, mono:'AY', rate:10, staffType:'engineer', staffCount:2, tier:2, chain:{sources:[{mono:'LC',name:'Logging Camp',inputMono:'TM',inputName:'Timber', staffType:'worker', staffCount:1}],outputMono:'FR',outputName:'Frames'}},
    {name:'Refinery Module', cost:500, mono:'RM', rate:8, staffType:'engineer', staffCount:3, tier:2, chain:{sources:[{mono:'QY',name:'Quarry',inputMono:'OR',inputName:'Raw Ore', staffType:'worker', staffCount:1}],outputMono:'RO',outputName:'Refined Ore'}},
    {name:'Drone Bay', cost:275, mono:'DB', rate:6, staffType:'engineer', staffCount:2, tier:3, chain:{sources:[{mono:'FN',name:'Foundry',inputMono:'AL',inputName:'Alloy', staffType:'worker', staffCount:1},{mono:'EB',name:'Electronics Bay',inputMono:'CI',inputName:'Circuits', staffType:'worker', staffCount:1}],outputMono:'DR',outputName:'Drone Units'}},
    // Deposit-based extractor: one generic rig, but what it actually mines
    // is decided at placement time by whichever DEPOSITS entry (below) sits
    // under the cell it's built on — see _commitBuildingAt in game.js and
    // Economy.runTick's depositBased branch. Different ore, same building,
    // for now.
    {name:'Mining Rig', cost:300, mono:'MR', rate:10, depositBased:true, staffType:'worker', staffCount:2, tier:1},
    // Tier-2 deposit extractor — deeper reach, higher yield, engineer-run.
    {name:'Deep Core Drill', cost:640, mono:'DK', rate:22, depositBased:true, staffType:'engineer', staffCount:3, tier:2}
  ],
  // Sealed cultivation only — no ocean, no open ground, no biosphere to draw
  // on. Every "farm" here is really an enclosed vat/bioreactor; the names
  // just keep the friendlier Anno-style shelf labels.
  ecology: [
    {name:'Algae Bioreactor', cost:180, mono:'AF', rate:12, staffType:'worker', staffCount:2, tier:1, chain:{sources:[{mono:'KT',name:'Algae Cultivator',inputMono:'KL',inputName:'Culture Stock', staffType:'worker', staffCount:1}],outputMono:'BM',outputName:'Biomass'}},
    {name:'Hydroponic Garden', cost:140, mono:'RN', out:'BM', rate:9, staffType:'worker', staffCount:1, tier:1},
    {name:'Grain Farm', cost:160, mono:'GF', out:'GR', rate:10, staffType:'worker', staffCount:2, tier:1},
    // Atmospheric + waste-stream water recovery — a mid-tier water answer that
    // doesn't need a polar ice deposit, just power and engineers.
    {name:'Water Reclaimer', cost:380, mono:'WR', out:'WT', rate:16, staffType:'engineer', staffCount:2, tier:2},
    {name:'Protein Vats', cost:220, mono:'PV', rate:8, staffType:'worker', staffCount:2, tier:2, chain:{sources:[{mono:'HY',name:'Hydroponics Bay',inputMono:'NU',inputName:'Nutrients', staffType:'worker', staffCount:1}],outputMono:'PR',outputName:'Protein'}},
    // Stacked sealed grow-decks — the tier-3 food workhorse.
    {name:'Vertical Farm', cost:560, mono:'VF', out:'GR', rate:24, staffType:'worker', staffCount:3, tier:3}
  ],
  // Power generation, split out of Ecology now that there's enough of it to
  // stand on its own. A lunar sol is ~14 (game-)sols of daylight followed by
  // ~14 of hard night (Economy.LUNAR_DAY_SOLS) — `dayOnly` buildings produce
  // nothing at all once the sun sets, so the colony always needs at least
  // one always-on plant to survive the night.
  energy: [
    {name:'Solar Array', cost:260, mono:'SA', out:'PW', rate:45, dayOnly:true, staffType:'engineer', staffCount:2, tier:2},
    // Radioisotope generator — small, no fuel, runs day or night. The
    // colony's night-time lifeline before Fusion is online.
    {name:'RTG Generator', cost:220, mono:'WN', out:'PW', rate:18, staffType:'engineer', staffCount:1, tier:1},
    {name:'Regolith Thermal Plant', cost:450, mono:'GT', out:'PW', rate:70, staffType:'engineer', staffCount:3, tier:2},
    // Helium-3 fusion — the big always-on plant, but it burns real fuel
    // mined from He-3 deposits (Economy.runTick's fuelType/fuelRate check),
    // not a free lunch like everything else in this category.
    {name:'Fusion Reactor', cost:900, mono:'FU', out:'PW', rate:150, fuelType:'H3', fuelRate:5, staffType:'engineer', staffCount:5, tier:3}
  ],
  public: [
    // Medical care — colony-wide coverage (Economy.medStatus): lifts morale
    // and halves the food/water attrition when the colony runs short.
    {name:'Med Station', cost:200, mono:'MS', out:'HP', rate:12, staffType:'worker', staffCount:2, tier:1},
    // Logistics node — projects a wide hauler coverage zone (Economy
    // coveredBuildingIds). Producers inside it get their goods shipped.
    {name:'Transit Hub', cost:350, mono:'TH', logiRange:9, staffType:'worker', staffCount:2, tier:2},
    // Research is a two-tier chain now: RAW-SCIENCE producers (`out:'SC'`) feed
    // the stockpile; REFINERS (`refineFrom:'SC', out:'RP'`) turn Science into
    // Research Points 1:1. RP never stockpiles — every point produced pours
    // straight into the active research node (Economy.runTick / researchQueue).
    {name:'Research Outpost', cost:300, mono:'RO', out:'SC', rate:6, staffType:'scientist', staffCount:3, tier:1},
    {name:'Observatory', cost:240, mono:'OB', out:'SC', rate:4, staffType:'scientist', staffCount:2, tier:1},
    // The refiner — Science in, Research Points out. Ungated so a fresh colony
    // can always bootstrap its research.
    {name:'Research Institute', cost:420, mono:'RI', out:'RP', rate:6, refineFrom:'SC', staffType:'scientist', staffCount:3, tier:2},
    // Colony HQ — one per colony (`unique`, enforced in game.js). Produces
    // no stockpile resource; instead it raises tax efficiency and funds a
    // small research trickle from administrative record-keeping. See
    // Economy.townHallBonus.
    {name:'Town Hall', cost:600, mono:'TW', unique:true, crTaxBonus:0.2, rpBonus:2, logiRange:6, staffType:'worker', staffCount:3, tier:2},
    // Ground defense — also produces nothing directly; turns military jobs
    // into a colony-wide upkeep discount (fewer losses to raiding/pilferage).
    // See Economy.upkeepDiscount.
    {name:'Garrison', cost:350, mono:'GN', upkeepDiscount:0.05, staffType:'military', staffCount:4, tier:2},
    // Fleet Command HQ — dedicated docking + admin overhead cut for the
    // whole fleet. `fleetUpkeepDiscount` sums across every Fleet Command
    // (unlike Garrison's upkeepDiscount) — see Economy.fleetUpkeep.
    {name:'Fleet Command', cost:520, mono:'FC', dockBays:10, fleetUpkeepDiscount:0.15, staffType:'military', staffCount:3, tier:2},
    // Military Laboratory — classified security R&D. Produces no stockpile
    // resource; cuts crime directly and stacks with Garrison staffing and
    // any commissioned Warships. See Economy.buildingCrimeReduction.
    {name:'Military Laboratory', cost:450, mono:'ML', crimeReduction:10, staffType:'scientist', staffCount:3, tier:2},
    // Military Shipyard — the only way to commission a Warship (see
    // confirmFleetBuild's shipyard gate in game.js). Produces nothing itself.
    {name:'Military Shipyard', cost:700, mono:'MY', unlocksShipType:'Warship', staffType:'engineer', staffCount:4, tier:3},
    // Pilot Training Center — veteran crews get more out of every hull:
    // Naval Escorts cut more trade risk, Reconnaissance funds more research
    // per ship. See Economy.fleetEffBonus / tradeRiskPenalty / fleetResearchBonus.
    {name:'Pilot Training Center', cost:400, mono:'PT', fleetEffBonus:0.25, staffType:'worker', staffCount:2, tier:2},
    // Tier-3 raw-Science campus — a large flat SC producer.
    {name:'Colony University', cost:760, mono:'UN', out:'SC', rate:18, staffType:'scientist', staffCount:5, tier:3},
    // Tier-3 refiner — the colony's Research Points workhorse once Science flows.
    {name:'Academy of Sciences', cost:980, mono:'AC', out:'RP', rate:14, refineFrom:'SC', staffType:'scientist', staffCount:5, tier:3}
  ],
  // Storage lives here now — it's infrastructure, not a public service.
  // Generic warehouse — a shallow capacity bump shared across every
  // stockpiled good. The specialized depots below trade that breadth for
  // one big bonus on a single resource, so a bottlenecked colony has a
  // real reason to pick one over "just build another warehouse". Roads /
  // conveyors / pipes are linear connectors: click-drag between two grid
  // cells instead of a single click, player-built only.
  infra: [
    {name:'Road', cost:40, mono:'RD', connector:'road', tier:1},
    {name:'Conveyor', cost:90, mono:'CV', connector:'conveyor', tier:1},
    {name:'Pipeline', cost:70, mono:'PL', connector:'pipe', tier:1},
    // Every depot also projects a hauler coverage zone (`logiRange`).
    {name:'Warehouse', cost:280, mono:'WH', warehouse:true, capBonus:2000, logiRange:5, tier:1},
    // Hangar — stores the hauler fleet. Each one raises how many haulers you
    // can dispatch on the warehouse panel (Economy.haulerCapacity). No zone
    // of its own; it just houses carts.
    {name:'Hangar', cost:260, mono:'HG', haulerCap:5, staffType:'worker', staffCount:1, tier:1},
    {name:'Ore Depot', cost:220, mono:'OD', warehouse:true, warehouseFor:'OR', capBonus:4000, logiRange:5, tier:2},
    {name:'Grain Silo', cost:200, mono:'GS', warehouse:true, warehouseFor:'BM', capBonus:3000, logiRange:5, tier:2},
    {name:'Water Cistern', cost:200, mono:'WC', warehouse:true, warehouseFor:'WT', capBonus:4000, logiRange:5, tier:2},
    // Tier-3 cryogenic depot — a large capacity bump to every stockpiled good.
    {name:'Cryo Vault', cost:480, mono:'CY', warehouse:true, capBonus:6000, logiRange:5, tier:3}
  ],
  // --- Asteroid belt (P4.2) — placeable only in the belt region, gated by
  // the `belt1` tech node. Everything feeds the one shared resource pool.
  beltmine: [
    {name:'Ore Barge', cost:520, mono:'GB', rate:28, depositBased:true, staffType:'worker', staffCount:3, tier:2, belt:true},
    {name:'Ice Claw', cost:480, mono:'IW', rate:24, depositBased:true, staffType:'worker', staffCount:3, tier:2, belt:true},
    {name:'Rare-Metal Extractor', cost:900, mono:'XM', rate:9, depositBased:true, depositType:'RE', staffType:'engineer', staffCount:4, tier:3, belt:true}
  ],
  beltinfra: [
    {name:'Belt Relay', cost:400, mono:'BR', logiRange:8, staffType:'worker', staffCount:2, tier:2, belt:true},
    {name:'Belt Habitat', cost:600, mono:'BH', out:'PO', rate:30, staffType:'worker', staffCount:2, tier:2, belt:true},
    {name:'Belt Depot', cost:340, mono:'BW', warehouse:true, capBonus:3500, logiRange:5, tier:2, belt:true}
  ]
};

// Production catalog by mono code (buildings + chain source buildings).
// `cost`/`hasChain` feed the economy tick's upkeep and power-draw formulas;
// `inputs` (chain buildings only) lists the resource codes it must consume,
// one unit of each per unit of output — see Economy.runTick.
const MONO_INFO = {};
Object.keys(SHELF_ITEMS).forEach(cat => SHELF_ITEMS[cat].forEach(it => {
  MONO_INFO[it.mono] = {
    out: it.chain ? it.chain.outputMono : (it.out || ''), rate: it.rate || 0,
    warehouse: !!it.warehouse, cost: it.cost || 0, hasChain: !!it.chain,
    inputs: it.chain ? it.chain.sources.map(function (sc) { return sc.inputMono; }) : [],
    warehouseFor: it.warehouseFor || null, capBonus: it.capBonus || 0,
    staffType: it.staffType || null, staffCount: it.staffCount || 0,
    unique: !!it.unique, crTaxBonus: it.crTaxBonus || 0, rpBonus: it.rpBonus || 0,
    upkeepDiscount: it.upkeepDiscount || 0, depositBased: !!it.depositBased,
    dayOnly: !!it.dayOnly, fuelType: it.fuelType || null, fuelRate: it.fuelRate || 0,
    tier: it.tier || 1, arrivals: it.arrivals || 0, dockBays: it.dockBays || 0,
    logiRange: it.logiRange || 0, haulerCap: it.haulerCap || 0,
    // Refiner buildings: consume 1 unit of `refineFrom` per unit of output,
    // drawn straight from the shared stockpile (see Economy.runTick).
    refineFrom: it.refineFrom || null,
    // Belt-only building; `depositType` restricts a depositBased rig to one ore.
    belt: !!it.belt, depositType: it.depositType || null,
    // Military-line bonuses (Fleet Command / Military Laboratory / Pilot
    // Training Center) — see Economy.fleetUpkeepDiscount/buildingCrimeReduction
    // /fleetEffBonus. Unlike upkeepDiscount (Garrison, first-match-only),
    // these three sum across every matching building.
    fleetUpkeepDiscount: it.fleetUpkeepDiscount || 0, crimeReduction: it.crimeReduction || 0,
    fleetEffBonus: it.fleetEffBonus || 0
  };
  // A source's rate matches its own building's need 1:1 (one source fully
  // feeds one consumer) rather than a flat number — otherwise e.g. a single
  // Algae Cultivator (would-be flat rate) could never keep up with an Algae
  // Bioreactor's higher consumption and the chain would stall forever.
  if (it.chain) it.chain.sources.forEach(sc => {
    MONO_INFO[sc.mono] = {
      out: sc.inputMono, rate: it.rate, source: true, cost: 0, hasChain: false, inputs: [],
      staffType: sc.staffType || null, staffCount: sc.staffCount || 0
    };
  });
}));

// Deposits scattered across the build grid. A Mining Rig only ever produces
// once it's built exactly on one of these cells, and then only that
// deposit's resource — see _commitBuildingAt (game.js) and Economy.runTick's
// depositBased branch. Regolith (OR) is common, Titanium-rich basalt and
// Helium-3 are rarer, and Water only exists as ice buried in the couple of
// permanently-shadowed craters below — no atmosphere means no other source.
const DEPOSITS = [
  { id:'dep1', col:40, row:8,  resource:'OR', region:'luna' },
  { id:'dep2', col:15, row:5,  resource:'OR', region:'luna' },
  { id:'dep3', col:45, row:15, resource:'TI', region:'luna' },
  { id:'dep4', col:10, row:18, resource:'TI', region:'luna' },
  { id:'dep5', col:50, row:6,  resource:'H3', region:'luna' },
  { id:'dep6', col:20, row:3,  resource:'H3', region:'luna' },
  { id:'dep7', col:5,  row:10, resource:'WT', region:'luna' },
  { id:'dep8', col:52, row:19, resource:'WT', region:'luna' }
];
// The asteroid belt — a second build region (see P4.2). Same grid coordinate
// space, filtered by `region` at render time; buildings feed the one shared
// resource pool. Deposits here are richer and include `RE` (rare metals).
const BELT_DEPOSITS = [
  { id:'bd1', col:8,  row:4,  resource:'OR', region:'belt' },
  { id:'bd2', col:16, row:3,  resource:'OR', region:'belt' },
  { id:'bd3', col:30, row:5,  resource:'TI', region:'belt' },
  { id:'bd4', col:44, row:4,  resource:'TI', region:'belt' },
  { id:'bd5', col:12, row:12, resource:'H3', region:'belt' },
  { id:'bd6', col:38, row:13, resource:'H3', region:'belt' },
  { id:'bd7', col:22, row:9,  resource:'WT', region:'belt' },
  { id:'bd8', col:48, row:11, resource:'WT', region:'belt' },
  { id:'bd9', col:26, row:16, resource:'RE', region:'belt' },
  { id:'bd10', col:40, row:18, resource:'RE', region:'belt' }
];
// Sector deposits (SECTOR_DEPOSITS) are appended further down, once SECTORS is
// defined — see the reassignment after the SECTORS block.
let ALL_DEPOSITS = DEPOSITS.concat(BELT_DEPOSITS);
function depositAt(col, row, region) {
  return ALL_DEPOSITS.find(d => d.col === col && d.row === row && (!region || d.region === region)) || null;
}

// Anno-style upgrade modules. `eff` = efficiency bonus (%); `cr`/`or` = one-off
// fit cost (50% refunded on removal); `upkeep` = extra CR/cycle folded into
// Economy.creditBreakdown.
const MODULE_MAX = 4;
const MODULES = [
  { id:'maint', mono:'МОБ', eff:12, cr:120, or:8,  upkeep:2 },
  { id:'auto',  mono:'АВТ', eff:22, cr:260, or:20, upkeep:4 },
  { id:'power', mono:'ЭНР', eff:8,  cr:90,  or:6,  upkeep:1 }
];
const MODULE_BY_ID = {};
MODULES.forEach(m => { MODULE_BY_ID[m.id] = m; });
function buildingEff(modules) {
  var e = 100;
  (modules || []).forEach(function (m) { e += (MODULE_BY_ID[m.moduleId] || {}).eff || 0; });
  return Math.min(220, e);
}

// Building durability. Every placed building carries `hp` 0-100. It decays a
// bit each sol (faster per fitted module, faster still while a dust storm
// runs); below HP_THROTTLE_FLOOR output starts dropping proportionally, at
// HP_DEAD it produces nothing. Warehouses/housing wear slower (no output to
// lose, just a repair-cost sink). Repair from the building panel — CR + Ore
// scaled to the missing HP.
const WEAR_PER_SOL = 1.5;
const WEAR_PER_MODULE = 0.6;
const WEAR_PASSIVE_MULT = 0.4;   // warehouses / housing
const HP_THROTTLE_FLOOR = 40;
const HP_DEAD = 5;

// Warehouse buildings — real per-resource storage caps (Economy.storageCapacity
// sums BASE_STORAGE_CAP + every placed warehouse's capBonus) plus a flavor
// resource-collection vehicle pool (WH_TOTAL, unrelated to storage capacity).
// CR is deliberately absent — credits aren't warehouse-limited.
const WH_TOTAL = 5;
// SC (raw Science) is warehouse-capped and haulable like any other good — a
// lab outside a logistics zone can't get its data trucked to an institute.
const BASE_STORAGE_CAP = { OR: 1500, BM: 1000, WT: 1500, H3: 800, TI: 1000, GR: 1000, PR: 800, SC: 1200, RE: 600 };
const STORAGE_COLOR = {
  CR: '#0bc6ab',
  OR: '#eea743',
  BM: '#48a260',
  WT: '#43a6c3',
  H3: '#b28fef',
  TI: '#acb9c3',
  GR: '#cbb042',
  PR: '#db6c66',
  SC: '#8797ef',
  RE: '#ed9ee5'
};
function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

// Add an alpha channel to a #rgb / #rrggbb / rgb() / rgba() colour ->
// "rgba(r, g, b, a)". Anything it can't parse comes back unchanged.
// (Colours used to be oklch() and got their alpha via string surgery; that
// broke when they became hex — this replaces it.)
function withAlpha(color, a) {
  if (typeof color !== 'string') return color;
  let m = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return 'rgba(' + parseInt(m[1] + m[1], 16) + ', ' + parseInt(m[2] + m[2], 16) + ', ' + parseInt(m[3] + m[3], 16) + ', ' + a + ')';
  m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return 'rgba(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ', ' + a + ')';
  m = color.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return 'rgba(' + m[1] + ', ' + m[2] + ', ' + m[3] + ', ' + a + ')';
  return color;
}

// Top-bar music player — plays the bundled .mp3 files via a hidden <audio>.
const TRACKS = [
  { title: 'Silent Orbit', artist: 'Colony Radio', file: './Silent%20Orbit.mp3' },
  { title: 'Lost',         artist: 'Colony Radio', file: './Lost.mp3' },
  { title: 'Lost Orbit',   artist: 'Colony Radio', file: './Lost%20Orbit.mp3' },
  { title: 'Dark Pulsar',  artist: 'Colony Radio', file: './Dark%20Pulsar.mp3' },
  { title: 'Void Signal',  artist: 'Colony Radio', file: './Void%20Signal.mp3' }
];
function mmss(n) {
  if (!isFinite(n) || n < 0) return '0:00';
  n = Math.floor(n);
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

// UI feedback sounds (Kenney "Interface Sounds", CC0). Played via delegated
// click handling in game.js — see stage click listener in componentDidMount.
const SFX = {
  click: 'assets/sfx/click.mp3',
  confirm: 'assets/sfx/confirm.mp3',
  back: 'assets/sfx/back.mp3'
};
// Lucide (ISC) volume-2 / volume-x, for the main-menu music toggle.
const MUSIC_ICON = {
  on: ['M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.5H2.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3.913l3.384 3.296A.705.705 0 0 0 11 19.298z', 'M16 9a5 5 0 0 1 0 6', 'M19.364 18.364a9 9 0 0 0 0-12.728'],
  off: ['M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.5H2.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3.913l3.384 3.296A.705.705 0 0 0 11 19.298z', 'm22 8-6 6', 'm16 8 6 6']
};

// The tech tree is the game's main progression spine — most tier-2 / tier-3
// buildings are locked in the build shelf until their node is researched.
//   `unlocks`  — one building mono, or an array of them (TECH_UNLOCK_BUILDING
//                below + selectShelfItem's lock check in game.js).
//   `fx`       — flat colony bonuses summed by Economy.techEffects, same
//                '[key, "+6%"]' shape as POLICIES. Channels: prod, power, cr,
//                sci (SC & RP output), upkeep.
//   `crCost`   — one-off funding paid when the node is added to the queue.
//   `rpCost`   — Research Points of *progress* the node needs; RP output pours
//                into the active queue item over time (Economy.runTick).
// Layout: 6 branch rows (y), up to 4 tiers across (x); node box 280x104.
const TECH_NODES = [
  // --- Ecology / Life Support -------------------------------------------------
  {id:'t1a', name:'Closed-Loop Reclamation', category:'Ecology', tier:1, x:40, y:20, base:'unlocked', desc:'High-efficiency scrubbers recover water from air, waste and processing runoff.', cost:'Researched', prereq:null, crCost:0, rpCost:0},
  {id:'t1c', name:'Bioregenerative Agriculture', category:'Ecology', tier:2, x:440, y:20, base:'available', desc:'Sealed hydroponic gardens that stabilise food supply, plus atmospheric water recovery.', prereq:'t1a', prereqName:'Closed-Loop Reclamation', crCost:1800, rpCost:34, unlocks:['RN','WR']},
  {id:'eco3', name:'Closed Ecology Loop', category:'Ecology', tier:3, x:840, y:20, base:'locked', desc:'Tight nutrient recycling between vats and gardens lifts every biological yield.', prereq:'t1c', prereqName:'Bioregenerative Agriculture', crCost:4200, rpCost:110, unlocks:['PV'], fx:[['prod','+3%']]},
  {id:'eco4', name:'Vertical Farming', category:'Ecology', tier:4, x:1240, y:20, base:'locked', desc:'Stacked sealed grow-decks multiply food output per pressurised cubic metre.', prereq:'eco3', prereqName:'Closed Ecology Loop', crCost:8000, rpCost:220, unlocks:['VF'], fx:[['prod','+5%']]},
  // --- Habitation ------------------------------------------------------------
  {id:'t1b', name:'Modular Habitats', category:'Habitation', tier:1, x:40, y:150, base:'unlocked', desc:'Prefabricated pressurised units that expand colony capacity fast.', cost:'Researched', prereq:null, crCost:0, rpCost:0},
  {id:'hab2', name:'Pressurised Structures', category:'Habitation', tier:2, x:440, y:150, base:'available', desc:'Reinforced multi-storey shells — the colony can finally build upward.', prereq:'t1b', prereqName:'Modular Habitats', crCost:2400, rpCost:46, unlocks:['ST']},
  {id:'hab3', name:'Arcology Engineering', category:'Habitation', tier:3, x:840, y:150, base:'locked', desc:'Buried self-contained megastructures that house thousands under one roof.', prereq:'hab2', prereqName:'Pressurised Structures', crCost:5400, rpCost:150, unlocks:['AS'], fx:[['upkeep','-4%']]},
  {id:'hab4', name:'Deep Colony Habitats', category:'Habitation', tier:4, x:1240, y:150, base:'locked', desc:'Optimised deep-rock living cuts life-support overhead colony-wide.', prereq:'hab3', prereqName:'Arcology Engineering', crCost:9000, rpCost:260, fx:[['prod','+4%'],['upkeep','-4%']]},
  // --- Industry ------------------------------------------------------------
  {id:'ind1', name:'Regolith Processing', category:'Industry', tier:1, x:40, y:280, base:'available', desc:'Rigs and mills that reach deep mineral seams and refine raw ore.', prereq:null, crCost:1400, rpCost:28, unlocks:['RM','DK']},
  {id:'ind2', name:'Structural Fabrication', category:'Industry', tier:2, x:440, y:280, base:'locked', desc:'On-site frame and panel fabrication from milled timber and alloy.', prereq:'ind1', prereqName:'Regolith Processing', crCost:3300, rpCost:75, unlocks:['AY']},
  {id:'ind3', name:'Autonomous Freight', category:'Industry', tier:3, x:840, y:280, base:'locked', desc:'Unmanned drone fabrication — the base of a real logistics fleet.', prereq:'ind2', prereqName:'Structural Fabrication', crCost:5000, rpCost:140, unlocks:['DB'], fx:[['cr','+3%']]},
  {id:'ind4', name:'Fusion Engineering', category:'Industry', tier:4, x:1240, y:280, base:'locked', desc:'Magnetic-confinement He-3 fusion — the colony’s always-on power answer.', prereq:'ind3', prereqName:'Autonomous Freight', crCost:11000, rpCost:300, unlocks:['FU'], fx:[['power','+6%']]},
  // --- Energy ------------------------------------------------------------
  {id:'pwr1', name:'Photovoltaics', category:'Energy', tier:1, x:40, y:410, base:'available', desc:'Wide thin-film arrays that harvest the fortnight-long lunar day.', prereq:null, crCost:1500, rpCost:28, unlocks:['SA']},
  {id:'pwr2', name:'Regolith Geothermal', category:'Energy', tier:2, x:440, y:410, base:'locked', desc:'Thermal wells tap the heat gradient under the crater floor — day or night.', prereq:'pwr1', prereqName:'Photovoltaics', crCost:3600, rpCost:80, unlocks:['GT']},
  {id:'pwr3', name:'Grid Management', category:'Energy', tier:3, x:840, y:410, base:'locked', desc:'Smart load-balancing and storage trims transmission loss across the grid.', prereq:'pwr2', prereqName:'Regolith Geothermal', crCost:6000, rpCost:160, fx:[['power','+8%']]},
  // --- Research ------------------------------------------------------------
  {id:'sci1', name:'Data Networks', category:'Research', tier:1, x:40, y:540, base:'available', desc:'Colony-wide sensor and comms mesh — every instrument now feeds the archive.', prereq:null, crCost:1200, rpCost:22, fx:[['sci','+6%']]},
  {id:'sci2', name:'Applied Sciences', category:'Research', tier:2, x:440, y:540, base:'locked', desc:'Institutes turn raw data into usable findings far more efficiently.', prereq:'sci1', prereqName:'Data Networks', crCost:3900, rpCost:95, fx:[['sci','+12%']]},
  {id:'sci3', name:'Academy Charter', category:'Research', tier:3, x:840, y:540, base:'locked', desc:'A chartered university and academy — the colony’s research at full scale.', prereq:'sci2', prereqName:'Applied Sciences', crCost:7000, rpCost:180, unlocks:['UN','AC'], fx:[['sci','+8%']]},
  {id:'sci4', name:'Breakthrough Theory', category:'Research', tier:4, x:1240, y:540, base:'locked', desc:'Fundamental advances ripple out into every other discipline.', prereq:'sci3', prereqName:'Academy Charter', crCost:12000, rpCost:340, fx:[['sci','+15%'],['prod','+3%']]},
  // --- Logistics & Admin ------------------------------------------------------
  {id:'log1', name:'Colony Charter', category:'Logistics', tier:1, x:40, y:670, base:'available', desc:'Formal colony administration — a Town Hall to run tax and records.', prereq:null, crCost:1600, rpCost:28, unlocks:['TW']},
  {id:'log2', name:'Freight Logistics', category:'Logistics', tier:2, x:440, y:670, base:'locked', desc:'Dedicated transit hubs and routing widen hauler coverage across the colony.', prereq:'log1', prereqName:'Colony Charter', crCost:4000, rpCost:90, unlocks:['TH'], fx:[['prod','+3%']]},
  {id:'log3', name:'Orbital Infrastructure', category:'Logistics', tier:3, x:840, y:670, base:'locked', desc:'Full-size spaceports and an orbital terminal — mass immigration and docking.', prereq:'log2', prereqName:'Freight Logistics', crCost:7500, rpCost:200, unlocks:['SP','OT']},
  // --- Frontier -----------------------------------------------------------
  {id:'belt1', name:'Belt Expedition', category:'Logistics', tier:4, x:1240, y:670, base:'locked', desc:'Mount the first mission beyond Luna — the asteroid belt opens as a second build region, rich in ore, ice, He-3 and rare metals.', prereq:'log3', prereqName:'Orbital Infrastructure', crCost:16000, rpCost:340, unlocks:['GB','IW','XM','BR','BH','BW']}
];
// The node whose completion opens the belt region switcher.
const BELT_TECH_ID = 'belt1';
// mono -> the node that unlocks it. A node may list several buildings.
const TECH_UNLOCK_BUILDING = {};
TECH_NODES.forEach(n => {
  if (!n.unlocks) return;
  (Array.isArray(n.unlocks) ? n.unlocks : [n.unlocks]).forEach(m => { TECH_UNLOCK_BUILDING[m] = n; });
});

const FILTER_CATS = ['All', 'Ecology', 'Habitation', 'Industry', 'Energy', 'Research', 'Logistics'];

// `allyFx` mirrors the `ally` display string into real Economy effects
// (Economy.diplomacyEffects), applied only once relation reaches "allied"
// (standingKey >= 70) — see happiness()/runTick()/game.js's _commitBuildingAt.
// Names kept as-is; only what each faction does/wants was reframed for the
// lunar setting.
const FACTIONS = [
  {id:'azure', name:'AZURE COMPACT', descriptor:'Closed-loop life support & solar engineering', territories:6, population:'2.4M', military:'●●●○○', relation:68, accent:TEAL, emblemRadius:'0', emblemTransform:'rotate(45deg)',
   leader:'Consul Vaerin', stance:'Cautiously friendly', wants:'Shared solar & recycling technology', ally:'+8% eco index while allied', allyFx:[['eco','8']]},
  {id:'ironreach', name:'IRONREACH COMBINE', descriptor:'Deep-crater mining & heavy industry', territories:9, population:'3.1M', military:'●●●●○', relation:41, accent:AMBER, emblemRadius:'3px', emblemTransform:'none',
   leader:'Overseer Kohl', stance:'Transactional', wants:'Mineral export rights', ally:'−15% ore & alloy prices while allied', allyFx:[['oreDiscount','15']]},
  {id:'verdant', name:'VERDANT CIRCLE', descriptor:'Bioregenerative agriculture & heritage preservation', territories:4, population:'1.1M', military:'●●○○○', relation:52, accent:'#48a260', emblemRadius:'50%', emblemTransform:'none',
   leader:'Steward Ílsa', stance:'Idealistic', wants:'Protected Apollo heritage sites', ally:'+1 research point / cycle while allied', allyFx:[['research','1']]}
];

// Diplomatic treaties. `req` = minimum relation to sign; breaking one costs `drop`.
const TREATIES = [
  { id:'trade',    req:40, drop:6,  gain:3 },
  { id:'pact',     req:55, drop:10, gain:4 },
  { id:'research', req:70, drop:8,  gain:5 }
];
const STANDING_LADDER = [
  { key:'allied',      min:70 },
  { key:'cooperative', min:50 },
  { key:'neutral',     min:30 },
  { key:'strained',    min:0  }
];
function standingKey(v){
  if (v >= 70) return 'allied';
  if (v >= 50) return 'cooperative';
  if (v >= 30) return 'neutral';
  return 'strained';
}
function relColor(v){
  if (v >= 70) return '#5cb572';
  if (v >= 50) return '#0bc6ab';
  if (v >= 30) return '#eea743';
  return '#e55551';
}

const TRADE_ROUTES = [
  { id:'tr1', a:'Meridian', b:'Azure Basin',     partner:'azure',     cargo:'algae', vol:'840 t',   trips:3, income:340, days:'2.1', risk:'low',  load:0.82, status:'active' },
  { id:'tr2', a:'Meridian', b:'Ironreach Deep',  partner:'ironreach', cargo:'ore',   vol:'1 200 t', trips:2, income:510, days:'3.4', risk:'med',  load:0.64, status:'active' },
  { id:'tr3', a:'Meridian', b:'Aitken Outpost 9', partner:null,        cargo:'water', vol:'400 t',   trips:4, income:180, days:'0.9', risk:'low',  load:0.55, status:'paused' }
];
const CARGO_COLOR = { algae: '#5cb572', ore: '#cf976a', water: '#32a8c7', alloy: '#9fadb6', parts: '#c8a747' };
const RISK_COLOR = { low: '#5cb572', med: '#e4a339', high: '#f17260' };
// Markets available to open a new route to.
const TRADE_DESTS = [
  { id:'vant013', name:'Vantage Station 13', partner:null,        days:'1.6', risk:'low',  demand:{ water:1.2, parts:1.0 } },
  { id:'ironhold', name:'Ironreach Foundry',  partner:'ironreach', days:'3.8', risk:'med',  demand:{ ore:1.3, alloy:1.4 } },
  { id:'verdbio',  name:'Verdant Biodome',    partner:'verdant',   days:'2.4', risk:'low',  demand:{ algae:1.5, water:1.1 } },
  { id:'freeport', name:'Freeport Drift',     partner:null,        days:'5.1', risk:'high', demand:{ alloy:1.2, parts:1.3, ore:1.1 } }
];
const TRADE_CARGOS = [
  { id:'algae', base:110 }, { id:'ore', base:160 }, { id:'water', base:70 },
  { id:'alloy', base:230 }, { id:'parts', base:200 }
];

// Seed fleet — copied into state.fleets at colony creation (see
// freshColonyState) and mutated from there by commission/disband; this
// const itself is never touched at runtime.
// Starting fleet — kept small so it fits the seed Landing Pad's dock bays
// (Economy.dockCapacity). Escort / Reconnaissance squadrons are commissioned
// once a bigger spaceport gives the colony room to park them.
const FLEET_GROUPS = [
  {id:'f1', name:'Transport Convoy Alpha', type:'Cargo Transport', count:4, status:'En Route'}
];
// Cargo Transports gate trade-route capacity (Economy.tradeCapacity), Naval
// Escorts blunt a route's risk penalty, Reconnaissance drones fund a small
// passive research trickle, Warships add straight to the colony's crime
// reduction (same pool as Garrison staffing and Military Laboratories) —
// see Economy.tradeRiskPenalty/fleetResearchBonus/fleetCrimeReduction.
// Commissioning a Warship additionally requires a Military Shipyard placed
// (game.js confirmFleetBuild) — every other type is ungated.
const SHIP_COST = { 'Cargo Transport': 300, 'Naval Escort': 400, 'Reconnaissance': 250, 'Colony Ship': 1200, 'Warship': 650 };
const SHIP_UPKEEP = { 'Cargo Transport': 2, 'Naval Escort': 3, 'Reconnaissance': 1, 'Colony Ship': 4, 'Warship': 5 };
const FLEET_TYPES = ['Cargo Transport', 'Naval Escort', 'Reconnaissance', 'Colony Ship', 'Warship'];
const CRIME_WARSHIP_REDUCTION = 8; // crime points cut per commissioned Warship

// P4.3 — planet/moon outposts. Survey a body (CR), then claim it with one
// Colony Ship + CR; each outpost adds `yield.perTick * level` of a resource
// to the shared pool every cycle. Levels 1-3 via upgradeCost.
const COLONISABLE = {
  phobos:  { surveyCost: 1500, claimCost: 4000,  yield: { code: 'TI', perTick: 3 },  upgradeCost: [6000, 14000] },
  deimos:  { surveyCost: 1500, claimCost: 4000,  yield: { code: 'H3', perTick: 2 },  upgradeCost: [6000, 14000] },
  ceres:   { surveyCost: 3000, claimCost: 8000,  yield: { code: 'WT', perTick: 6 },  upgradeCost: [11000, 24000] },
  vesta:   { surveyCost: 3000, claimCost: 8000,  yield: { code: 'RE', perTick: 2 },  upgradeCost: [12000, 26000] },
  mercury: { surveyCost: 4500, claimCost: 12000, yield: { code: 'CR', perTick: 14 }, upgradeCost: [16000, 34000] },
  mars:    { surveyCost: 5000, claimCost: 15000, yield: { code: 'OR', perTick: 10 }, upgradeCost: [20000, 42000] }
};
const OUTPOST_UPKEEP = 6;   // CR / cycle per outpost level

// Irregular sector territories for the fullscreen map, in a 6000x3400 world.
// `points` is an SVG polygon; buildings live inside the home sector, offset by
// (HOME_X, HOME_Y) from their stage coords.
const WORLD_W = 6000, WORLD_H = 3400;
const HOME_X = 2060, HOME_Y = 1180;
// `status` is the *initial* state; live state lives in `s.sectorState` (game.js
// sectorStatus()). Non-home sectors go unexplored -> scouted (SECTOR_SCOUT_COST
// CR, reveals `deposits`) -> owned (SECTOR_CLAIM_COST CR + 1 Colony Ship). An
// owned sector becomes a build region you switch to (like the asteroid belt).
// `s13` is held by a rival AI — retake it for SECTOR_RETAKE_COST + a Colony Ship
// (its deposits are the richest). `s11` is an allied faction's ground: shown,
// not claimable. `deposits` are build-grid coords (56x22), same as DEPOSITS.
const SECTORS = [
  { id:'s07', num:7,  status:'unexplored', points:'880,380 2110,300 2170,1130 1880,1000 1000,1210 740,800',                     cx:1380, cy:760,
    deposits:[ {col:12,row:5,resource:'OR'}, {col:26,row:4,resource:'OR'}, {col:38,row:9,resource:'OR'}, {col:44,row:14,resource:'TI'} ] },
  { id:'s08', num:8,  status:'unexplored', points:'2170,320 3420,210 4000,560 3880,1240 3040,1050 2180,1180 2110,610',           cx:3050, cy:660,
    deposits:[ {col:10,row:6,resource:'WT'}, {col:30,row:5,resource:'WT'}, {col:22,row:13,resource:'H3'}, {col:42,row:16,resource:'H3'} ] },
  { id:'s09', num:9,  status:'unexplored', points:'4000,410 5000,540 5200,1380 4420,1740 3980,2010 3880,1240',                    cx:4520, cy:1090,
    deposits:[ {col:14,row:7,resource:'RE'}, {col:36,row:6,resource:'RE'}, {col:26,row:15,resource:'TI'}, {col:46,row:12,resource:'TI'} ] },
  { id:'s11', num:11, status:'allied',     points:'980,1250 1880,1020 2060,1830 1850,2240 1030,2130 740,1610',                    cx:1420, cy:1680 },
  { id:'s13', num:13, status:'ai',         points:'3430,2380 4420,1740 5060,2140 4940,2980 3980,3180 3290,2900',                  cx:4180, cy:2520,
    deposits:[ {col:10,row:5,resource:'OR'}, {col:22,row:4,resource:'WT'}, {col:34,row:8,resource:'RE'}, {col:44,row:6,resource:'H3'}, {col:16,row:15,resource:'TI'}, {col:38,row:16,resource:'RE'} ] },
  { id:'s16', num:16, status:'unexplored', points:'1950,2270 2530,2360 3290,2900 2820,3200 1940,3080 1800,2260',                  cx:2500, cy:2780,
    deposits:[ {col:12,row:6,resource:'OR'}, {col:30,row:5,resource:'TI'}, {col:24,row:14,resource:'H3'}, {col:42,row:15,resource:'OR'} ] },
  { id:'s12', num:12, status:'home',       points:'2180,1180 3040,1050 3880,1240 3980,2010 3430,2380 2530,2360 2060,1830',        cx:3030, cy:1730 }
];
const SECTOR_SCOUT_COST  = 2000;
const SECTOR_CLAIM_COST   = 6000;   // + 1 Colony Ship
const SECTOR_RETAKE_COST  = 14000;  // + 1 Colony Ship (the AI-held s13)
// Sector deposits flattened into the shared deposit list, tagged by sector id
// as their `region` so the build viewport shows them once you're managing that
// sector. Revealed to the player only after a scout (game.js filters).
const SECTOR_DEPOSITS = SECTORS.reduce((acc, sc) => {
  (sc.deposits || []).forEach((d, i) => acc.push({ id: sc.id + '_d' + i, col: d.col, row: d.row, resource: d.resource, region: sc.id }));
  return acc;
}, []);
ALL_DEPOSITS = DEPOSITS.concat(BELT_DEPOSITS).concat(SECTOR_DEPOSITS);

// Luna whole-planet view. Surface features are placed by (roughly real)
// selenographic latitude/longitude and projected onto an orthographic globe
// that rotates freely on all axes. `type` is cosmetic labeling only — the
// renderer (globeFeatures in game.js) just draws lat/lon/r/color, so it's
// safe to mix maria and craters freely.
const GLOBE_R = 94;
const LUNA_FEATURES = [
  { type:'mare', lat:18,  lon:-57, r:34, color:'rgba(35, 39, 43, 0.55)' },   // Oceanus Procellarum
  { type:'mare', lat:33,  lon:-16, r:30, color:'rgba(36, 42, 47, 0.5)' },   // Mare Imbrium
  { type:'mare', lat:28,  lon:18,  r:22, color:'rgba(39, 44, 49, 0.48)' },  // Mare Serenitatis
  { type:'mare', lat:9,   lon:31,  r:20, color:'rgba(39, 44, 48, 0.46)' },   // Mare Tranquillitatis (Apollo 11)
  { type:'mare', lat:17,  lon:59,  r:16, color:'rgba(36, 42, 47, 0.46)' },  // Mare Crisium
  { type:'mare', lat:-15, lon:36,  r:14, color:'rgba(39, 44, 48, 0.44)' },   // Mare Nectaris
  { type:'crater', lat:-43, lon:-11, r:10, color:'rgba(125, 122, 117, 0.42)' }, // Tycho
  { type:'crater', lat:10,  lon:-20, r:9,  color:'rgba(120, 116, 112, 0.4)' },  // Copernicus
  { type:'crater', lat:-58, lon:-14, r:12, color:'rgba(114, 110, 106, 0.42)' }, // Clavius
  // Shackleton — permanently shadowed south-pole crater, the real-world
  // reason the ice deposits (DEPOSITS `resource:'WT'`) live near the poles.
  { type:'crater', lat:-85, lon:0, r:7, color:'rgba(94, 136, 149, 0.55)' }
];
// Colony sectors on the surface. `home` is our sector — sitting right at the
// edge of Mare Tranquillitatis, a nod to the first landing before the colony
// pushed outward.
const PLANET_SECTORS = [
  { id:'p_ax1', label:'AX-1', lat:44,  lon:-28 },
  { id:'p_ax2', label:'AX-2', lat:40,  lon:52 },
  { id:'p_br2', label:'BR-2', lat:4,   lon:-72 },
  { id:'p_home', label:'HOME', lat:8, lon:26, home:true },
  { id:'p_br3', label:'BR-3', lat:-2,  lon:84 },
  { id:'p_cd4', label:'CD-4', lat:-42, lon:-30 },
  { id:'p_cd5', label:'CD-5', lat:-46, lon:44 }
];

// Rotate a lat/lon point on the unit sphere by yaw (Y), pitch (X), roll (Z),
// then orthographically project. Returns screen coords in a 0..200 box + depth.
function projectGlobe(latDeg, lonDeg, yaw, pitch, roll) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
  let x = Math.cos(la) * Math.sin(lo);
  let y = Math.sin(la);
  let z = Math.cos(la) * Math.cos(lo);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let nx = x * cy + z * sy, nz = -x * sy + z * cy; x = nx; z = nz;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  let ny = y * cp - z * sp, nz2 = y * sp + z * cp; y = ny; z = nz2;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  let rx = x * cr - y * sr, ry = x * sr + y * cr; x = rx; y = ry;
  return { x: 100 + x * GLOBE_R, y: 100 - y * GLOBE_R, z: z, ang: Math.atan2(-y, x) * 180 / Math.PI };
}

// Equirectangular surface maps (Solar System Scope, CC-BY 4.0). Optional layer over the
// procedural gradient — if a file fails to load the gradient shows through unchanged.
const TEX_BASE = 'assets/textures/';
const SYS_TEX = {
  // Venus shows its opaque cloud deck, not the (radar-only) surface.
  mercury: '2k_mercury.jpg', venus: '2k_venus_atmosphere.jpg', earth: '2k_earth_daymap.jpg',
  mars: '2k_mars.jpg', jupiter: '2k_jupiter.jpg', saturn: '2k_saturn.jpg',
  uranus: '2k_uranus.jpg', neptune: '2k_neptune.jpg', ceres: '2k_ceres_fictional.jpg',
  // small airless bodies reuse the Ceres map
  vesta: '2k_ceres_fictional.jpg', pallas: '2k_ceres_fictional.jpg', hygiea: '2k_ceres_fictional.jpg',
  pluto: '2k_ceres_fictional.jpg', makemake: '2k_makemake_fictional.jpg', eris: '2k_ceres_fictional.jpg', haumea: '2k_ceres_fictional.jpg'
};
const MOON_TEX = { luna: '2k_moon.jpg', phobos: '2k_ceres_fictional.jpg', deimos: '2k_ceres_fictional.jpg' };
// Grayscale height maps for a bumpMap — derived from each body's albedo (no
// public elevation data reachable here), so read as "surface has texture" more
// than exact topography. Rocky bodies only; gas giants / Venus's clouds get none.
const SYS_BUMP = { mercury: '2k_mercury_height.jpg', mars: '2k_mars_height.jpg' };
const MOON_BUMP = { luna: '2k_moon_height.jpg' };
const MILKYWAY_TEX = TEX_BASE + '8k_stars_milky_way.jpg';
// Per-body colony / outpost data for the info panel.
const BODY_DETAIL = {
  mars:    { owner: 'claimed', pop: '—',       res: ['Fe', 'Si', 'Water ice', 'Perchlorate'], buildings: 0 },
  earth:   { owner: 'archive', pop: '—',       res: ['Legacy vault', 'Gene bank'],           buildings: 3 },
  luna:    { owner: 'colony',  pop: '8 412',   res: ['He-3', 'Ti', 'Regolith'],              buildings: 5 },
  phobos:  { owner: 'outpost', pop: '86',      res: ['Survey rig', 'Fuel depot'],            buildings: 2 },
  ceres:   { owner: 'mining',  pop: '640',     res: ['Water', 'Ammonia', 'Carbonates'],      buildings: 5 },
  vesta:   { owner: 'mining',  pop: '210',     res: ['Fe', 'Ni', 'HED basalt'],              buildings: 3 },
  venus:   { owner: 'hostile', pop: '—',       res: ['—'],                                   buildings: 0 },
  mercury: { owner: 'claimed', pop: '—',       res: ['Solar potential'],                     buildings: 0 }
};
const OWNER_COLOR = {
  colony: '#0bc6ab', outpost: '#36baba', mining: '#5cb572',
  archive: '#84a6dd', hostile: '#f17260', claimed: '#99a7b0'
};

// Fleets moving across / stationed in the system.
const SYS_FLEETS = [
  { id: 'sf1', kind: 'convoy', route: ['luna', 'earth'],    speed: 0.55, phase: 0 },
  { id: 'sf2', kind: 'survey', route: ['ceres', 'mars'],     speed: 0.40, phase: 55 },
  { id: 'sf3', kind: 'patrol', at: 'luna', ang: 35 },
  { id: 'sf4', kind: 'convoy', route: ['earth', 'jupiter'],  speed: 0.28, phase: 20 },
  { id: 'sf5', kind: 'patrol', at: 'earth', ang: 210 }
];
const FLEET_KIND_COLOR = { convoy: '#dab249', survey: '#00c4c4', patrol: '#69ba7c' };

// Real Solar System orrery (compressed orbits) in an 800x800 viewBox, centre (400,400).
const SYSTEM_PLANETS = [
  { id:'mercury', name:'Mercury', orbit:56,  r:4,  color:'#807971',  speed:4.15, phase:20,  kind:'rocky',    status:'unexplored', au:'0.39 AU' },
  { id:'venus',   name:'Venus',   orbit:80,  r:8,  color:'#cebd8a',   speed:1.62, phase:150, kind:'rocky',    status:'hostile',    au:'0.72 AU' },
  { id:'earth',   name:'Earth',   orbit:104, r:9,  color:'#1d85b0',  speed:1.0,  phase:255, kind:'ocean',    status:'origin',     au:'1.00 AU',
    // The colony's actual seat — a moon of Earth, not a planet in its own
    // right, so `home` lives on this nested entry (SYS_BODY_BY_ID flattens
    // moons into the same lookup, so isHome/status still resolve normally).
    moons:[{ id:'luna', name:'Luna', r:2.6, dist:9, speed:3.0, phase:40, kind:'moon', status:'home', home:true, km:'384 000' }] },
  { id:'mars',    name:'Mars',    orbit:130, r:6,  color:'#be4a1b',   speed:0.53, phase:60,  kind:'rocky',    status:'unexplored', au:'1.52 AU',
    moons:[
      { id:'phobos', name:'Phobos', r:1.6, dist:5,  speed:8.0, phase:0,   kind:'moon', status:'surveyed',   km:'9 380' },
      { id:'deimos', name:'Deimos', r:1.2, dist:9,  speed:3.2, phase:190, kind:'moon', status:'unexplored', km:'23 460' }
    ] },
  { id:'ceres',   name:'Ceres',   orbit:158, r:3,  color:'#80878f', speed:0.24, phase:110, kind:'dwarf',    status:'mined',      au:'2.77 AU', belt:true },
  { id:'vesta',   name:'Vesta',   orbit:165, r:2.4,color:'#a29784',   speed:0.27, phase:210, kind:'asteroid', status:'mined',      au:'2.36 AU', belt:true },
  { id:'pallas',  name:'Pallas',  orbit:172, r:2.4,color:'#6d7e7f',  speed:0.24, phase:330, kind:'asteroid', status:'surveyed',   au:'2.77 AU', belt:true },
  { id:'hygiea',  name:'Hygiea',  orbit:179, r:2.4,color:'#636975',  speed:0.20, phase:40,  kind:'asteroid', status:'unexplored', au:'3.14 AU', belt:true },
  { id:'jupiter', name:'Jupiter', orbit:240, r:28, color:'#a58665',   speed:0.084,phase:340, kind:'gas',      status:'surveyed',   au:'5.20 AU', ring:false },
  { id:'saturn',  name:'Saturn',  orbit:296, r:23, color:'#b6aa87',   speed:0.034,phase:120, kind:'gas',      status:'surveyed',   au:'9.58 AU', ring:true },
  { id:'uranus',  name:'Uranus',  orbit:340, r:15, color:'#69babf',  speed:0.012,phase:215, kind:'ice',      status:'unexplored', au:'19.2 AU', ring:true },
  { id:'neptune', name:'Neptune', orbit:378, r:14, color:'#3578b8',  speed:0.006,phase:300, kind:'ice',      status:'unexplored', au:'30.1 AU' },
  { id:'pluto',    name:'Pluto',    orbit:406, r:2.8, color:'#a18e80',  speed:0.004, phase:150, kind:'dwarf', status:'unexplored', au:'39.5 AU', belt:true },
  { id:'haumea',   name:'Haumea',   orbit:424, r:2.2, color:'#acbac3', speed:0.0035,phase:20,  kind:'dwarf', status:'unexplored', au:'43.1 AU', belt:true },
  { id:'makemake', name:'Makemake', orbit:440, r:2.5, color:'#a17d6d',  speed:0.003, phase:250, kind:'dwarf', status:'unexplored', au:'45.8 AU', belt:true },
  { id:'eris',     name:'Eris',     orbit:458, r:2.9, color:'#b9bfc2',speed:0.0022,phase:70,  kind:'dwarf', status:'unexplored', au:'67.8 AU', belt:true }
];
// Orbital elements (eccentricity, inclination °, argument of periapsis °, axial tilt °).
const ORBIT_ELEM = {
  mercury: { ecc: 0.206, incl: 7.0,  peri: 29,  tilt: 0 },
  venus:   { ecc: 0.007, incl: 3.4,  peri: 55,  tilt: 3 },
  earth:   { ecc: 0.017, incl: 0.0,  peri: 103, tilt: 23.4 },
  mars:    { ecc: 0.093, incl: 1.85, peri: 286, tilt: 25.2 },
  ceres:   { ecc: 0.076, incl: 10.6, peri: 73,  tilt: 4 },
  vesta:   { ecc: 0.089, incl: 7.1,  peri: 151, tilt: 29 },
  pallas:  { ecc: 0.231, incl: 12.0, peri: 310, tilt: 60 },
  hygiea:  { ecc: 0.112, incl: 3.8,  peri: 312, tilt: 0 },
  jupiter: { ecc: 0.049, incl: 1.30, peri: 274, tilt: 3.1 },
  saturn:  { ecc: 0.057, incl: 2.49, peri: 339, tilt: 26.7 },
  uranus:  { ecc: 0.046, incl: 0.77, peri: 97,  tilt: 97.8 },
  neptune:  { ecc: 0.009, incl: 1.77, peri: 274, tilt: 28.3 },
  pluto:    { ecc: 0.07, incl: 3.5, peri: 113, tilt: 120 },
  haumea:   { ecc: 0.06, incl: 3.0, peri: 240, tilt: 0 },
  makemake: { ecc: 0.05, incl: 3.2, peri: 296, tilt: 0 },
  eris:     { ecc: 0.08, incl: 4.0, peri: 151, tilt: 0 }
};
SYSTEM_PLANETS.forEach(function (p) {
  var e = ORBIT_ELEM[p.id] || {};
  p.ecc = e.ecc || 0; p.incl = e.incl || 0; p.peri = e.peri || 0; p.tilt = e.tilt || 0;
});

// Flat lookup of every selectable body (planets + moons).
const SYS_BODY_BY_ID = {};
SYSTEM_PLANETS.forEach(function (p) {
  SYS_BODY_BY_ID[p.id] = p;
  (p.moons || []).forEach(function (m) {
    SYS_BODY_BY_ID[m.id] = Object.assign({}, m, { moon: true, parent: p.id });
  });
});

// The asteroid + Kuiper belts on the system map are generated procedurally
// in game-solarsystem3d.js (buildAsteroidBelt) — no shared data needed here.

function sectorStyle(status) {
  if (status === 'home')       return { border: 'rgba(11, 198, 171, 0.85)', bg: 'rgba(4, 14, 19, 1)',     label: '#0bc6ab', sub: '#63988c' };
  if (status === 'owned')      return { border: 'rgba(11, 198, 171, 0.55)', bg: 'rgba(0, 45, 38, 0.4)',   label: '#43d9be', sub: '#5e9b90' };
  if (status === 'allied')     return { border: 'rgba(0, 140, 116, 0.5)',   bg: 'rgba(5, 26, 22, 0.35)',  label: '#0bc6ab', sub: '#63988c' };
  if (status === 'ai')         return { border: 'rgba(219, 108, 102, 0.6)', bg: 'rgba(38, 12, 10, 0.4)',  label: '#e08078', sub: '#b06860' };
  if (status === 'contested')  return { border: 'rgba(211, 142, 34, 0.5)',  bg: 'rgba(41, 22, 0, 0.3)',   label: '#eea743', sub: '#b48952' };
  if (status === 'scouted')    return { border: 'rgba(222, 230, 234, 0.3)', bg: 'rgba(12, 24, 32, 0.55)', label: '#c2c9cd', sub: '#7d858a' };
  if (status === 'neutral')    return { border: 'rgba(222, 230, 234, 0.18)', bg: 'rgba(9, 19, 25, 0.5)',  label: '#9fa6aa', sub: '#636a6f' };
  return { border: 'rgba(222, 230, 234, 0.08)', bg: 'rgba(2, 8, 13, 0.65)', label: '#484e52', sub: '#383e42' };   // unexplored
}

