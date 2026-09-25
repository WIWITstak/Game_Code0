// Colony economy simulation — pure functions only, no `this`/DOM/React.
// Loaded after game-data.js (uses MONO_INFO/buildingEff) and before game.js,
// which just calls into this module from _runEconomyTick and renderVals.
'use strict';

// Biomass eaten per colonist per cycle. Tuned so the seeded Algae Cultivator
// -> Algae Bioreactor chain (12 BM/cycle) just covers the starting
// population (8412) with a small surplus — more colonists or Habitat Spires
// need more farms.
const FOOD_PER_CAPITA = 0.0012;
// Water drunk per colonist per cycle. There's no atmosphere to pull humidity
// from up here, so this is deliberately tighter than food — the starting
// stockpile plus Closed-Loop Reclamation's trickle buys time, but only a
// Mining Rig on an ice deposit (DEPOSITS `resource:'WT'`) actually solves it.
const WATER_PER_CAPITA = 0.0008;

// Comms signal (Comm Dome) and medical care (Med Station) demanded per
// colonist per cycle. Unlike food/water these never *kill* directly — a
// shortfall dents morale and, for medical, lets more colonists slip through
// the food/water attrition. Tuned so one tier-1 building covers a few
// thousand colonists.
const COMMS_PER_CAPITA = 0.004;   // one rate-8 Comm Dome covers ~2000 colonists
const MED_PER_CAPITA = 0.006;     // one rate-12 Med Station covers ~2000 colonists

// Population attrition, batched to the sol boundary like arrivals. Each is the
// fraction of the colony lost per sol at *total* shortfall (satisfaction 0);
// it scales linearly with the gap, so a mild dip barely stings and a full
// outage empties the colony in a couple of weeks. Emigration kicks in only
// once morale drops below MORALE_FLOOR.
const STARVE_SOL_RATE = 0.06;
const DEHYDRATE_SOL_RATE = 0.08;
const EMIGRATE_SOL_RATE = 0.04;
const MORALE_FLOOR = 35;

// Faction relations drift back toward their starting value each sol — a gift
// spike fades if you don't keep the relationship warm.
const RELATION_DECAY_PER_SOL = 0.5;

// Closed-Loop Reclamation (t1a, unlocked from colony founding) recovers
// water from air scrubbers and waste processing — real recycling, not the
// free atmospheric harvesting a wetter world would allow, so it only ever
// covers part of colony demand. See DEPOSITS/Mining Rig for the actual
// water source.
const PASSIVE_WATER_RECLAIM = 5;

// A lunar day/night cycle: ~14 (game-)sols of daylight then ~14 of hard
// night, each sol being 24 economy cycles (see game-data.js's solDate).
// `dayOnly` power plants (Solar Array) produce nothing at all at night.
const LUNAR_DAY_SOLS = 14;
// One sol = 24 economy cycles (game-data.js's solDate). Population growth
// is batched to this boundary — colonists arrive as one discrete shipment
// a sol instead of a fractional trickle every 4-second cycle.
const CYCLES_PER_SOL = 24;

// Population job categories, filled in this priority order from whatever
// workforce is available — general labour before specialists, since a
// young colony always has more hands than trained engineers/scientists.
const STAFF_TYPES = ['worker', 'engineer', 'scientist', 'military'];
// Children/elderly — never part of the working-age pool, regardless of
// how well-staffed the colony's jobs are.
const DEPENDENT_RATIO = 0.35;

const Economy = {
  // Every job-providing building's demand, bucketed into the four labour
  // categories — only buildings actually on the road network count (an
  // unconnected building would otherwise "steal" demand from a category
  // without ever producing anything itself).
  staffDemand(placed, links) {
    const connected = Economy.connectedBuildingIds(placed, links);
    const demand = { worker: 0, engineer: 0, scientist: 0, military: 0 };
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.staffType || demand[info.staffType] == null) return;
      const isConnected = placed.length <= 1 || connected.has(b.id);
      if (isConnected) demand[info.staffType] += info.staffCount || 0;
    });
    return demand;
  },

  // Live staffing snapshot: working-age population fills job demand in
  // priority order (worker > engineer > scientist > military); leftover
  // workforce beyond total demand is unemployed. `fillRatio` (0-1 per
  // category) is what actually throttles that category's production in
  // runTick — an understaffed Research Outpost still exists, it just runs
  // at a fraction of its rate.
  staffStatus(st) {
    const demand = Economy.staffDemand(st.placed, st.links);
    const workforce = Math.round(st.population * (1 - DEPENDENT_RATIO));
    let remaining = workforce;
    const filled = {}, fillRatio = {};
    STAFF_TYPES.forEach(type => {
      const f = Math.min(demand[type], remaining);
      filled[type] = f;
      remaining -= f;
      fillRatio[type] = demand[type] > 0 ? f / demand[type] : 1;
    });
    return { demand, filled, fillRatio, workforce, unemployed: Math.max(0, remaining), dependents: st.population - workforce };
  },

  // The colony's one-of-a-kind Town Hall (see SHELF_ITEMS `unique`): raises
  // tax efficiency and funds a small passive research trickle. Doesn't need
  // road access — like habitationCapacity, it's foundational, not a producer.
  townHallBonus(placed) {
    const th = placed.map(b => MONO_INFO[b.mono]).find(info => info && info.crTaxBonus);
    return { taxMult: th ? (1 + th.crTaxBonus) : 1, rpBonus: th ? (th.rpBonus || 0) : 0 };
  },

  // A Garrison's upkeep discount (fewer losses to raiding/pilferage) — flat
  // colony-wide %, same "exists, doesn't need a road" treatment as the Town
  // Hall bonus above.
  upkeepDiscount(placed) {
    const gn = placed.map(b => MONO_INFO[b.mono]).find(info => info && info.upkeepDiscount);
    return gn ? gn.upkeepDiscount : 0;
  },

  // Draws `amount` out of the combined food pool (Biomass, Grain, Protein),
  // BM first — mutates `res` in place. Population doesn't care which food
  // resource it eats, but warehouses/production still track them separately.
  consumeFood(res, amount) {
    let remaining = amount;
    ['BM', 'GR', 'PR'].forEach(code => {
      if (remaining <= 0) return;
      const avail = res[code] || 0;
      const take = Math.min(avail, remaining);
      res[code] = avail - take;
      remaining -= take;
    });
  },

  // Colony-wide capacity for the three warehouse-gated goods: a small base
  // floor (so the seeded colony never opens already over capacity) plus
  // every placed warehouse's capBonus — generic warehouses (no
  // warehouseFor) widen every code a little, specialized depots dump a
  // bigger bonus into just their one resource. CR is uncapped by design.
  storageCapacity(placed) {
    const cap = Object.assign({}, BASE_STORAGE_CAP);
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.warehouse || !info.capBonus) return;
      if (info.warehouseFor) cap[info.warehouseFor] = (cap[info.warehouseFor] || 0) + info.capBonus;
      else Object.keys(cap).forEach(code => { cap[code] += info.capBonus; });
    });
    return cap;
  },

  // Nominal Science flow for the top-bar SC popup — raw produced by labs vs.
  // raw drawn by refiners (Institute / Academy). Connected-only, module eff
  // and tech `sci` bonus applied; skips the fine throttles (display, like
  // powerBreakdown). runTick stays the authority on what actually moves.
  scFlow(st) {
    const connected = Economy.connectedBuildingIds(st.placed, st.links);
    const sci = 1 + Economy.techEffects(st.techOverride).sci / 100;
    let produced = 0, refined = 0;
    st.placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (st.placed.length > 1 && !connected.has(b.id)) return;
      const amt = (info.rate || 0) * (buildingEff(b.modules) / 100) * sci;
      if (info.out === 'SC') produced += amt;
      if (info.refineFrom === 'SC') refined += amt;
    });
    return { produced: Math.round(produced * 10) / 10, refined: Math.round(refined * 10) / 10 };
  },

  // Live fill status for the top-bar / warehouse-panel UI — real stock vs.
  // real capacity, not the old fixed mock numbers.
  storageStatus(st) {
    const cap = Economy.storageCapacity(st.placed);
    const out = {};
    Object.keys(cap).forEach(code => {
      const stock = Math.round((st.resources && st.resources[code]) || 0);
      out[code] = { stock, cap: cap[code], pct: Math.min(100, Math.round(stock / cap[code] * 100)), full: stock >= cap[code] };
    });
    return out;
  },


  // Real-time food-supply snapshot — usable both live (current resources,
  // for display) and inside runTick (post-production resources, to gate
  // growth and consume stock for that same cycle). Population doesn't need
  // a specific food resource, just enough combined Biomass/Grain/Protein.
  // Never shrinks the colony by itself; a deficit only slows growth and
  // dents happiness.
  foodStatus(st) {
    const needed = Math.round(st.population * FOOD_PER_CAPITA);
    const res = st.resources || {};
    const stock = (res.BM || 0) + (res.GR || 0) + (res.PR || 0);
    const satisfaction = needed > 0 ? Math.max(0, Math.min(1, stock / needed)) : 1;
    return { needed, stock, satisfaction };
  },

  // Same idea as foodStatus but for drinking/process water — there's no
  // atmosphere to recycle from at scale, so satisfaction leans hard on
  // whatever's actually been mined from an ice deposit. Doesn't gate growth
  // (food already does); a shortfall just dents happiness.
  waterStatus(st) {
    const needed = Math.round(st.population * WATER_PER_CAPITA);
    const stock = (st.resources && st.resources.WT) || 0;
    const satisfaction = needed > 0 ? Math.max(0, Math.min(1, stock / needed)) : 1;
    return { needed, stock, satisfaction };
  },

  // Comms-signal coverage (from Comm Domes, `out:'CX'`). Full coverage lifts
  // morale and speeds research; a shortfall only dents morale.
  commsStatus(st) {
    const needed = Math.round(st.population * COMMS_PER_CAPITA);
    const stock = (st.resources && st.resources.CX) || 0;
    return { needed, stock, satisfaction: needed > 0 ? Math.max(0, Math.min(1, stock / needed)) : 1 };
  },
  // Medical coverage (from Med Stations, `out:'HP'`). Full coverage lifts
  // morale and halves food/water attrition losses.
  medStatus(st) {
    const needed = Math.round(st.population * MED_PER_CAPITA);
    const stock = (st.resources && st.resources.HP) || 0;
    return { needed, stock, satisfaction: needed > 0 ? Math.max(0, Math.min(1, stock / needed)) : 1 };
  },

  // True during the ~14-sol lunar day, false during the ~14-sol night —
  // purely derived from st.cycle, so it stays correct across save/load.
  isLunarDay(cycle) {
    const sol = Math.floor((cycle || 0) / CYCLES_PER_SOL);
    return (sol % (LUNAR_DAY_SOLS * 2)) < LUNAR_DAY_SOLS;
  },

  // Splits a freshly-arrived batch of colonists into flavor categories for
  // the arrival notification: working-age arrivals fill whatever job
  // categories still have open demand (same worker > engineer > scientist
  // > military priority as staffStatus), covering real skill shortages
  // first, with any leftover joining as general workers; the rest of the
  // batch (DEPENDENT_RATIO share) arrives as dependents. Purely cosmetic —
  // staffStatus recomputes actual staffing from the total population every
  // tick regardless of how this one batch gets labeled.
  arrivalBreakdown(count, st) {
    const staff = Economy.staffStatus(st);
    let remaining = Math.round(count * (1 - DEPENDENT_RATIO));
    const dependents = count - remaining;
    const groups = {};
    STAFF_TYPES.forEach(type => {
      const open = Math.max(0, staff.demand[type] - staff.filled[type]);
      const assigned = Math.min(open, remaining);
      if (assigned > 0) groups[type] = assigned;
      remaining -= assigned;
    });
    if (remaining > 0) groups.worker = (groups.worker || 0) + remaining;
    if (dependents > 0) groups.dependents = dependents;
    return groups;
  },

  // Collapses the player's five policy picks (game-data.js POLICIES) into a
  // flat { eco, power, cr, prod, happy, jobs, pop, research, military } sum
  // of every chosen option's fx tags — '+6%'/'−2%'/'+2/cyc' style strings
  // all parseFloat cleanly since the unit is just trailing text. `jobs` and
  // `military` have no real system to plug into yet and stay display-only.
  policyEffects(policyChoice) {
    const out = { eco: 0, power: 0, cr: 0, prod: 0, happy: 0, jobs: 0, pop: 0, research: 0, military: 0 };
    POLICIES.forEach(p => {
      const chosenId = (policyChoice && policyChoice[p.id]) || p.def;
      const opt = p.opts.find(o => o.id === chosenId) || p.opts.find(o => o.id === p.def);
      if (!opt) return;
      opt.fx.forEach(([k, v]) => { out[k] = (out[k] || 0) + (parseFloat(v) || 0); });
    });
    return out;
  },

  // Turns "allied" standing (relation >= 70) into the real effects each
  // faction's `ally` flavor text already promises (game-data.js FACTIONS
  // `allyFx`) — an unmet relation threshold contributes nothing.
  diplomacyEffects(st) {
    const out = { eco: 0, oreDiscount: 0, research: 0 };
    const relations = st.diploRelations || {};
    FACTIONS.forEach(f => {
      if (!f.allyFx) return;
      const rel = relations[f.id] != null ? relations[f.id] : f.relation;
      if (standingKey(rel) !== 'allied') return;
      f.allyFx.forEach(([k, v]) => { if (out[k] != null) out[k] += parseFloat(v) || 0; });
    });
    return out;
  },

  // Flat colony bonuses from every RESEARCHED tech node's `fx` list (game-data
  // TECH_NODES). Same shape/summing as policyEffects. Channels currently wired
  // into runTick: prod (% output), power (% power output), cr (% credits),
  // sci (% SC & RP output), upkeep (% upkeep, negative = cheaper).
  techEffects(techOverride) {
    const out = { prod: 0, power: 0, cr: 0, sci: 0, upkeep: 0 };
    const ov = techOverride || {};
    TECH_NODES.forEach(n => {
      if (!n.fx) return;
      if ((ov[n.id] || n.base) !== 'unlocked') return;
      n.fx.forEach(([k, v]) => { if (out[k] != null) out[k] += parseFloat(v) || 0; });
    });
    return out;
  },

  // Building ids touched by at least one endpoint of a player-built road /
  // conveyor / pipe. A building with no route in or out doesn't produce —
  // roads are player infrastructure, not scenery (see game-data.js LINK_STYLE).
  connectedBuildingIds(placed, links) {
    const set = new Set();
    links.forEach(lk => {
      const lr = lk.region || 'luna';
      placed.forEach(b => {
        if ((b.region || 'luna') !== lr) return;
        if ((b.col === lk.a.col && b.row === lk.a.row) || (b.col === lk.b.col && b.row === lk.b.row)) set.add(b.id);
      });
    });
    return set;
  },

  // Housing capacity supported by every placed Habitat/Skyline-type building
  // (structural floor space — doesn't need a road to exist, only to fill up).
  habitationCapacity(placed) {
    let cap = 0;
    placed.forEach(b => { const info = MONO_INFO[b.mono] || {}; if (info.out === 'PO') cap += (info.rate || 0) * 100; });
    return cap;
  },

  // Total colonists-per-cycle the colony's road-connected spaceports can
  // process — the immigration throughput (before food/staff throttling).
  // Zero means the colony physically cannot grow. Display-only; runTick
  // recomputes the throttled figure itself.
  arrivalCapacity(placed, links) {
    const connected = Economy.connectedBuildingIds(placed, links);
    let sum = 0;
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.arrivals) return;
      if (placed.length <= 1 || connected.has(b.id)) sum += info.arrivals;
    });
    return sum;
  },

  // Total ship/rocket parking the colony's road-connected spaceports provide.
  // Fleet Command can't commission a ship past this (every ship needs a bay).
  dockCapacity(placed, links) {
    const connected = Economy.connectedBuildingIds(placed, links);
    let sum = 0;
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.dockBays) return;
      if (placed.length <= 1 || connected.has(b.id)) sum += info.dockBays;
    });
    return sum;
  },
  // Every ship the colony owns needs a home bay, whatever its current status.
  fleetTotal(fleets) {
    return (fleets || []).reduce((n, f) => n + (f.count || 0), 0);
  },

  // --- Logistics / haulers -------------------------------------------------
  // Two gates on every goods producer:
  //   1. Coverage — it must sit inside the logistics zone of a Warehouse or
  //      Transit Hub (`logiRange`, Chebyshev cells). Outside every zone its
  //      goods can't be shipped and its non-power output nearly stalls.
  //   2. Fleet throughput — enough dispatched haulers (`whMachines`, capped by
  //      Hangar capacity, assigned on the warehouse panel) to service the
  //      covered producers; short on haulers and they're all throttled.
  // Power / housing / spaceport / civic buildings ship nothing physical.
  HAULER_SERVES: 2,       // covered producers one dispatched hauler keeps fed
  HAULER_BASE: 2,         // built-in depot fleet before any Hangar
  UNCOVERED_FACTOR: 0.3,  // a producer with no zone can barely move its goods

  // Fleet capacity = base + every placed Hangar's haulerCap. `whMachines`
  // (dispatched) is clamped to this in game.js.
  haulerCapacity(placed) {
    let cap = Economy.HAULER_BASE;
    placed.forEach(b => { const info = MONO_INFO[b.mono] || {}; cap += info.haulerCap || 0; });
    return cap;
  },

  // Is a goods producer haulable at all (chain / refiner / deposit / stockpiled good)?
  _isHaulable(info) {
    return info.hasChain || !!info.refineFrom || info.depositBased || (info.out && BASE_STORAGE_CAP[info.out] != null);
  },

  // Live progress value for one objective (game-data OBJECTIVES). Display +
  // the runTick completion check both read this.
  objectiveValue(st, obj) {
    switch (obj.type) {
      case 'pop':       return st.population || 0;
      case 'housing':   return Economy.habitationCapacity(st.placed);
      case 'buildings': return (st.placed || []).length;
      case 'tech':      return TECH_NODES.filter(n => ((st.techOverride || {})[n.id] || n.base) === 'unlocked').length;
      case 'sols':      return Math.floor((st.cycle || 0) / CYCLES_PER_SOL);
      case 'trade':     return Economy.activeTradeRouteCount(st);
      case 'crnet':     return Economy.creditBreakdown(st).net * CYCLES_PER_SOL;
      case 'research':  return st.researchOutput || 0;
      case 'outposts':  return Object.keys(st.outposts || {}).length;
      case 'sectors':   return Object.keys(st.sectorState || {}).filter(k => st.sectorState[k] === 'owned').length;
      default:          return 0;
    }
  },

  // Output multiplier from a building's durability: full above the throttle
  // floor, linear down to it, zero at HP_DEAD.
  hpFactor(hp) {
    const h = hp == null ? 100 : hp;
    if (h <= HP_DEAD) return 0;
    if (h >= HP_THROTTLE_FLOOR) return 1;
    return h / HP_THROTTLE_FLOOR;
  },

  // Ids of every building inside the logistics zone of any Warehouse / Transit
  // Hub (`logiRange` in Chebyshev grid cells). The zone source needs road
  // access itself to project (an unconnected depot serves nothing).
  coveredBuildingIds(placed, links) {
    const connected = Economy.connectedBuildingIds(placed, links);
    const nodes = placed.filter(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.logiRange) return false;
      return placed.length <= 1 || connected.has(b.id);
    });
    const set = new Set();
    placed.forEach(b => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], r = (MONO_INFO[n.mono] || {}).logiRange || 0;
        if ((b.region || 'luna') !== (n.region || 'luna')) continue;
        if (Math.max(Math.abs(b.col - n.col), Math.abs(b.row - n.row)) <= r) { set.add(b.id); break; }
      }
    });
    return set;
  },

  // { covered, uncovered } counts of road-connected goods producers.
  logisticsDemand(placed, links) {
    const connected = Economy.connectedBuildingIds(placed, links);
    const covered = Economy.coveredBuildingIds(placed, links);
    let c = 0, u = 0;
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (info.warehouse || !Economy._isHaulable(info)) return;
      if (placed.length > 1 && !connected.has(b.id)) return;
      if (covered.has(b.id)) c++; else u++;
    });
    return { covered: c, uncovered: u };
  },

  // Throughput factor for a *covered* producer: enough dispatched haulers for
  // the covered fleet -> 1, short -> down to 40%.
  logisticsFactor(st) {
    const d = Economy.logisticsDemand(st.placed, st.links);
    if (d.covered <= 0) return 1;
    const served = (st.whMachines || 0) * Economy.HAULER_SERVES;
    return Math.max(0.4, Math.min(1, served / d.covered));
  },

  // Producer output vs. every other building's draw, scaled by the energy
  // policy's `power` %. `isDay` (Economy.isLunarDay) zeroes out any
  // `dayOnly` plant (Solar Array) once the two-week night falls — everything
  // else (RTG, Regolith Thermal, Fusion) keeps running. Not road-gated (v1)
  // — treat the power grid as separate from goods logistics. Same numbers
  // feed the top-bar popup.
  powerBreakdown(placed, policyChoice, isDay, techOverride) {
    let produced = 0, consumed = 0;
    placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (info.warehouse) return;
      const eff = buildingEff(b.modules) / 100;
      if (info.out === 'PW') {
        if (info.dayOnly && !isDay) return;
        produced += (info.rate || 0) * eff;
      } else consumed += info.hasChain ? 4 : 1;
    });
    const pol = Economy.policyEffects(policyChoice);
    const techFx = Economy.techEffects(techOverride);
    produced *= Math.max(0, 1 + (pol.power + techFx.power) / 100);
    return { produced: Math.round(produced), consumed: Math.round(consumed) };
  },
  powerBalance(placed, policyChoice, isDay, techOverride) {
    const b = Economy.powerBreakdown(placed, policyChoice, isDay, techOverride);
    return b.produced - b.consumed;
  },
  // Production penalty during a power deficit ("brownout") — floors at 40%
  // so a colony never fully stalls from power alone. Power producers
  // themselves are exempt (see runTick) or the grid could never recover.
  powerFactor(placed, policyChoice, isDay, techOverride) {
    const bal = Economy.powerBalance(placed, policyChoice, isDay, techOverride);
    return bal < 0 ? Math.max(0.4, 1 + bal / 100) : 1;
  },

  // Fleet ship count of one type (see game-data.js SHIP_COST/SHIP_UPKEEP for
  // the type keys) — 0 if the colony has none.
  fleetCount(fleets, type) {
    return (fleets || []).filter(f => f.type === type).reduce((sum, f) => sum + (f.count || 0), 0);
  },
  // How many trade routes can run active at once — one Cargo Transport ship
  // crews two routes, so growing trade always needs real transport capacity,
  // not just another route toggled on.
  tradeCapacity(fleets) {
    return Math.floor(Economy.fleetCount(fleets, 'Cargo Transport') / 2);
  },
  activeTradeRouteCount(st) {
    const all = TRADE_ROUTES.concat(st.tradeAdded || []);
    return all.filter(r => ((st.tradeStatus && st.tradeStatus[r.id]) || r.status) === 'active').length;
  },
  // A route's risk trims its income unless Naval Escorts cover the gap —
  // each escort ship claws back 2 points (more with Pilot Training Center's
  // veteran-crew bonus), capped at no penalty at all.
  tradeRiskPenalty(risk, fleets, placed) {
    const base = { low: 1, med: 0.9, high: 0.75 }[risk];
    if (base == null) return 1;
    const perShip = 0.02 * (1 + Economy.fleetEffBonus(placed));
    return Math.min(1, base + Economy.fleetCount(fleets, 'Naval Escort') * perShip);
  },
  // Flat colony-wide multiplier from every placed Pilot Training Center,
  // applied per-hull to Naval Escort/Reconnaissance effectiveness.
  fleetEffBonus(placed) {
    return (placed || []).reduce((sum, b) => sum + ((MONO_INFO[b.mono] || {}).fleetEffBonus || 0), 0);
  },
  // A route to a faction-run market rides that faction's relation — allied
  // partners pay a premium, strained ones a real discount. Independent
  // markets (`partner: null`) are unaffected.
  tradeRelationMult(st, partnerId) {
    if (!partnerId) return 1;
    const relations = st.diploRelations || {};
    const fac = FACTIONS.find(f => f.id === partnerId);
    const rel = relations[partnerId] != null ? relations[partnerId] : (fac ? fac.relation : 50);
    return 0.6 + (rel / 100) * 0.7; // 0 relation -> 0.6x, 100 relation -> 1.3x
  },
  // Passive research trickle from Reconnaissance drones — scouting still
  // produces useful survey data even without a fog-of-war system to reveal.
  // Pilot Training Center's veteran-crew bonus applies here too.
  fleetResearchBonus(fleets, placed) {
    return Economy.fleetCount(fleets, 'Reconnaissance') * 0.4 * (1 + Economy.fleetEffBonus(placed));
  },
  fleetUpkeep(fleets) {
    let sum = 0;
    (fleets || []).forEach(f => { sum += (SHIP_UPKEEP[f.type] || 0) * (f.count || 0); });
    return sum;
  },
  // Sums every placed Fleet Command's upkeep cut (stacks, unlike Garrison's
  // building upkeepDiscount).
  fleetUpkeepDiscount(placed) {
    return (placed || []).reduce((sum, b) => sum + ((MONO_INFO[b.mono] || {}).fleetUpkeepDiscount || 0), 0);
  },

  // Net CR/cycle from every trade route (built-in + player-added) currently
  // marked active — tradeStatus overrides a route's own default status.
  // Real relation and risk/escort math, not the flat sum it used to be.
  tradeIncome(st) {
    const all = TRADE_ROUTES.concat(st.tradeAdded || []);
    let sum = 0;
    all.forEach(r => {
      const status = (st.tradeStatus && st.tradeStatus[r.id]) || r.status;
      if (status !== 'active') return;
      sum += (r.income || 0) * Economy.tradeRiskPenalty(r.risk, st.fleets, st.placed) * Economy.tradeRelationMult(st, r.partner);
    });
    return Math.round(sum);
  },

  // Real CR income/expense split for the top-bar hover popup. `net` applies
  // the Town Hall's tax bonus, the Garrison's upkeep discount, fleet upkeep
  // and the `cr` policy % the same way runTick nets into resources.CR, so
  // the popup total always matches the actual delta the player sees land.
  creditBreakdown(st) {
    const th = Economy.townHallBonus(st.placed);
    const taxIncome = Math.round(st.population * 0.1 * th.taxMult);
    const tradeIncome = Economy.tradeIncome(st);
    const discount = Economy.upkeepDiscount(st.placed);
    const techFx = Economy.techEffects(st.techOverride);
    let upkeep = 0, moduleUpkeep = 0;
    st.placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (!info.warehouse) upkeep += Math.max(1, Math.round((info.cost || 0) / 20));
      (b.modules || []).forEach(m => { moduleUpkeep += ((MODULE_BY_ID[m.moduleId] || {}).upkeep || 0); });
    });
    let outpostUpkeep = 0;
    Object.keys(st.outposts || {}).forEach(id => { outpostUpkeep += OUTPOST_UPKEEP * ((st.outposts[id] || {}).level || 1); });
    const fleetDiscount = Economy.fleetUpkeepDiscount(st.placed);
    const fleetUpkeep = Math.round(Economy.fleetUpkeep(st.fleets) * Math.max(0.2, 1 - fleetDiscount));
    upkeep = Math.round(upkeep * Math.max(0.2, 1 - discount + techFx.upkeep / 100)) + moduleUpkeep + outpostUpkeep + fleetUpkeep;
    const pol = Economy.policyEffects(st.policyChoice);
    // Petty theft & graft — a small ongoing drain scaling with crime, the
    // continuous (non-hazard) half of what a Garrison's crime reduction buys back.
    const crimeLoss = Math.round(Economy.crimeRate(st) * CRIME_LOSS_CR_MULT);
    const net = Math.round((taxIncome + tradeIncome - upkeep - crimeLoss) * Math.max(0, 1 + (pol.cr + techFx.cr) / 100));
    return { taxIncome, tradeIncome, upkeep, crimeLoss, net };
  },

  // Colony morale: food AND water security (co-equal — this is the Moon,
  // both are genuinely scarce) plus whatever the ecology/labour policies and
  // allied factions add or subtract, minus a crime penalty, clamped to
  // 0-100. Sustained morale below MORALE_FLOOR drives emigration in runTick;
  // otherwise this is display.
  _moraleValue(food, water, pol, dip, comms, med, crime) {
    const c = comms ? comms.satisfaction : 1;
    const m = med ? med.satisfaction : 1;
    return Math.max(0, Math.min(100, Math.round(
      22 + 26 * food.satisfaction + 26 * water.satisfaction + 13 * c + 13 * m
      + pol.eco + pol.happy + dip.eco - (crime || 0) * CRIME_MORALE_PENALTY_MULT)));
  },
  happiness(st) {
    return Economy._moraleValue(
      Economy.foodStatus(st), Economy.waterStatus(st),
      Economy.policyEffects(st.policyChoice), Economy.diplomacyEffects(st),
      Economy.commsStatus(st), Economy.medStatus(st), Economy.crimeRate(st));
  },
  // Crime pressure (0-100, higher = worse) — colony-size baseline plus idle
  // population, cut down by staffed military (Garrison) jobs. See the
  // CRIME_* tuning constants (game-data.js) for the exact weights.
  crimeRate(st) {
    const staff = Economy.staffStatus(st);
    const sizeFactor = Math.min(CRIME_SIZE_CAP, (st.population || 0) / CRIME_SIZE_DIVISOR);
    const unemploymentFactor = staff.workforce > 0 ? (staff.unemployed / staff.workforce) * CRIME_UNEMPLOYMENT_WEIGHT : 0;
    const jobReduction = Math.min(CRIME_MILITARY_REDUCTION_CAP, (staff.filled.military || 0) * CRIME_MILITARY_REDUCTION_PER_JOB);
    const buildingReduction = Economy.buildingCrimeReduction(st.placed);
    const shipReduction = Economy.fleetCrimeReduction(st.fleets);
    return Math.max(0, Math.min(100, Math.round(sizeFactor + unemploymentFactor - jobReduction - buildingReduction - shipReduction)));
  },
  // Player-facing positive-framed stat (Eco Index / Happiness convention).
  stability(st) { return 100 - Economy.crimeRate(st); },
  // Flat crime-point cut from every placed Military Laboratory — unlike
  // Garrison's upkeepDiscount (first-match-only), this sums across all of them.
  buildingCrimeReduction(placed) {
    return (placed || []).reduce((sum, b) => sum + ((MONO_INFO[b.mono] || {}).crimeReduction || 0), 0);
  },
  // Warships add straight to the same crime-reduction pool — a Military
  // Shipyard-gated way to buy stability directly instead of through jobs.
  fleetCrimeReduction(fleets) {
    return Economy.fleetCount(fleets, 'Warship') * CRIME_WARSHIP_REDUCTION;
  },

  // One economy cycle: connected buildings produce (gated by road access +
  // module efficiency), chain buildings additionally need their input
  // resource(s) already sitting in the shared pool (1 unit of each input per
  // unit of output — no point-to-point logistics, just city-wide stock) and
  // consume it, every building pays upkeep, active trade routes pay in,
  // population grows toward housing capacity. Anno-style production loop.
  // Pure: takes the relevant slice of component state, returns a setState patch.
  runTick(st) {
    const connected = Economy.connectedBuildingIds(st.placed, st.links);
    const pol = Economy.policyEffects(st.policyChoice);
    const dip = Economy.diplomacyEffects(st);
    const techFx = Economy.techEffects(st.techOverride);
    const isDay = Economy.isLunarDay(st.cycle);
    const brownout = Economy.powerFactor(st.placed, st.policyChoice, isDay, st.techOverride);
    const prodMult = Math.max(0.1, 1 + (pol.prod + techFx.prod) / 100);
    const sciMult = Math.max(0.1, 1 + techFx.sci / 100);
    // Active dust storm(s): everything runs at `mag`, Solar Arrays go dark.
    const activeHazards = (st.activeHazards || []).filter(h => (h.until || 0) > st.cycle);
    const storm = activeHazards.find(h => h.type === 'storm');
    const stormAdj = storm ? (storm.mag || 0.85) : 1;
    const stormDark = !!storm;   // solar down entirely during a storm
    const staff = Economy.staffStatus(st);
    // Logistics: `covered` = goods producers inside a Warehouse/Transit Hub
    // zone (they haul at `logistics`, the fleet-throughput factor); anything
    // outside every zone crawls at UNCOVERED_FACTOR.
    const covered = Economy.coveredBuildingIds(st.placed, st.links);
    const logistics = Economy.logisticsFactor(st);
    const res = Object.assign({}, st.resources);
    let poGain = 0;
    // Research Points produced this cycle. RP is pure flow — it never lands in
    // `res`; it pours into the active research node further down.
    let rpTick = 0;
    st.placed.forEach(b => {
      const info = MONO_INFO[b.mono] || {};
      if (info.warehouse) return;
      const isConnected = st.placed.length <= 1 || connected.has(b.id);
      // Durability throttle — a worn building produces less, a dead one nothing.
      const hpAdj = Economy.hpFactor(b.hp);
      // Housing (`out:'PO'`) only widens habitationCapacity — no per-cycle
      // output. Colonists come through a spaceport instead.
      if (info.out === 'PO') return;
      // Spaceport: `arrivals` colonists per cycle it can process, gated by
      // road access and staffing. This is the colony's only growth source.
      if (info.arrivals) {
        if (!isConnected) return;
        const eff = buildingEff(b.modules) / 100;
        const sAdj = info.staffType ? (staff.fillRatio[info.staffType] != null ? staff.fillRatio[info.staffType] : 1) : 1;
        poGain += info.arrivals * eff * sAdj * hpAdj;
        return;
      }
      // Mining Rig has no fixed `out` — it mines whatever deposit it was
      // built on (recorded on the instance at placement time).
      const outCode = info.depositBased ? (b.resource || '') : info.out;
      if (!isConnected || !outCode || !info.rate) return;
      // Solar Array (dayOnly) goes dark through the ~14-sol night — and any
      // time a dust storm is blotting out the sun.
      if (info.dayOnly && (!isDay || stormDark)) return;
      const eff = buildingEff(b.modules) / 100;
      // Power producers are exempt from their own brownout penalty — the
      // grid punishing itself into a deeper deficit could never recover.
      const powerAdj = outCode === 'PW' ? 1 : brownout;
      // Goods need hauling (power, comms and medical care don't; a chain's own
      // source building hands off next door, no cart): covered producers ride
      // the fleet factor, uncovered ones barely move anything.
      const noHaul = outCode === 'PW' || outCode === 'CX' || outCode === 'HP' || info.source;
      const logiAdj = noHaul ? 1 : (covered.has(b.id) ? logistics : Economy.UNCOVERED_FACTOR);
      const staffAdj = info.staffType ? (staff.fillRatio[info.staffType] != null ? staff.fillRatio[info.staffType] : 1) : 1;
      let amount = info.rate * eff * prodMult * powerAdj * logiAdj * staffAdj * hpAdj * stormAdj;
      // Research output (raw Science and refined Points) rides the tech tree's
      // `sci` bonus on top of everything else.
      if (outCode === 'SC' || outCode === 'RP') amount *= sciMult;
      if (info.hasChain && info.inputs && info.inputs.length) {
        const hasStock = info.inputs.every((code) => (res[code] || 0) >= amount);
        if (!hasStock) return; // no input on hand -> production halts this cycle
        info.inputs.forEach((code) => { res[code] -= amount; });
      }
      // Refiner (Research Institute / Academy of Sciences): consumes 1 unit of
      // `refineFrom` (Science) per unit of output, straight from the stockpile.
      if (info.refineFrom) {
        if ((res[info.refineFrom] || 0) < amount) return; // no Science on hand -> idle
        res[info.refineFrom] -= amount;
      }
      // Fusion Reactor burns real He-3 fuel, at its own rate — independent
      // of the power-output amount above, so tuning one doesn't warp the other.
      if (info.fuelType) {
        const fuelNeed = (info.fuelRate || 0) * eff * staffAdj;
        if ((res[info.fuelType] || 0) < fuelNeed) return; // no fuel -> reactor idles
        res[info.fuelType] -= fuelNeed;
      }
      // Research Points don't stockpile — bank them for the queue instead.
      if (outCode === 'RP') { rpTick += amount; return; }
      res[outCode] = (res[outCode] || 0) + amount;
    });
    // Closed-Loop Reclamation's passive recycling — real, but nowhere near
    // enough on its own; the same brownout throttle applies since the
    // scrubbers themselves draw power.
    res.WT = (res.WT || 0) + PASSIVE_WATER_RECLAIM * brownout;
    // Planetary outposts (P4.3) ship a steady trickle home, scaled by level.
    Object.keys(st.outposts || {}).forEach(id => {
      const o = st.outposts[id], def = COLONISABLE[id];
      if (!o || !def) return;
      res[def.yield.code] = (res[def.yield.code] || 0) + def.yield.perTick * (o.level || 1);
    });
    // Colonists eat and drink before they multiply: food AND water satisfaction
    // (from this cycle's own production, already folded into `res` above) both
    // throttle growth, then both meals are drawn from their pools. A severe
    // shortfall of either also kills colonists at the sol boundary below.
    const food = Economy.foodStatus({ population: st.population, resources: res });
    Economy.consumeFood(res, food.needed);
    const water = Economy.waterStatus({ population: st.population, resources: res });
    res.WT = Math.max(0, (res.WT || 0) - water.needed);
    // Comms + medical coverage: same "draw from the pool" idea, single code
    // each. They don't stockpile usefully — keep at most a few cycles' buffer.
    const comms = Economy.commsStatus({ population: st.population, resources: res });
    res.CX = Math.max(0, Math.min((res.CX || 0) - comms.needed, comms.needed * 4 + 20));
    const med = Economy.medStatus({ population: st.population, resources: res });
    res.HP = Math.max(0, Math.min((res.HP || 0) - med.needed, med.needed * 4 + 20));
    const crimeNow = Economy.crimeRate(st);
    const morale = Economy._moraleValue(food, water, pol, dip, comms, med, crimeNow);
    // Warehouse capacity caps every stockpiled good — anything produced
    // past a full depot is simply lost, the classic "build more storage"
    // pressure.
    const cap = Economy.storageCapacity(st.placed);
    Object.keys(cap).forEach(code => { res[code] = Math.min(res[code] || 0, cap[code]); });
    // Growth accumulates in a pool toward remaining housing room instead of
    // trickling into the population count every 4s cycle. `poGain` is the
    // spaceport throughput this cycle — with no working spaceport it's 0 and
    // the colony can't grow at all, migration policy included. Food AND water
    // satisfaction both throttle it. The pool is cashed in once a sol
    // (CYCLES_PER_SOL) as one discrete shipment, broken down by job category
    // (Economy.arrivalBreakdown) for the arrival notification. On the same
    // boundary a severe food/water shortfall or collapsed morale removes
    // colonists — the colony can now actually shrink and fail.
    const room = Math.max(0, Economy.habitationCapacity(st.placed) - st.population);
    const portOpen = poGain > 0;
    const growthPool = (st.popGrowthAccum || 0)
      + poGain * food.satisfaction * water.satisfaction
      + (portOpen ? (pol.pop || 0) : 0);
    const nextCycle = st.cycle + 1;
    let population = st.population;
    let popGrowthAccum = growthPool;
    let arrival = null;
    let casualties = null;
    if (nextCycle % CYCLES_PER_SOL === 0) {
      const batch = Math.max(0, Math.min(Math.round(growthPool), room));
      if (batch > 0) {
        arrival = Object.assign({ total: batch }, Economy.arrivalBreakdown(batch, st));
      }
      // Medical coverage cushions the food/water attrition — a well-cared-for
      // colony loses up to half as many to a shortage.
      const medCushion = 1 - 0.5 * med.satisfaction;
      const starve    = food.satisfaction  < 1 ? st.population * STARVE_SOL_RATE   * (1 - food.satisfaction)  * medCushion : 0;
      const dehydrate = water.satisfaction < 1 ? st.population * DEHYDRATE_SOL_RATE * (1 - water.satisfaction) * medCushion : 0;
      const emigrate  = morale < MORALE_FLOOR ? st.population * EMIGRATE_SOL_RATE  * (MORALE_FLOOR - morale) / MORALE_FLOOR : 0;
      const lost = Math.round(starve + dehydrate + emigrate);
      population = Math.max(0, st.population + batch - lost);
      const actualLost = st.population + batch - population;
      if (actualLost > 0) {
        casualties = {
          total: actualLost,
          starve: Math.round(starve), dehydrate: Math.round(dehydrate), emigrate: Math.round(emigrate)
        };
      }
      // Leftover — a fractional remainder, or a batch housing couldn't fully
      // absorb — carries into the next sol instead of vanishing: a full
      // colony just backlogs would-be settlers until new habitation opens
      // room for them.
      popGrowthAccum = growthPool - batch;
    }
    // Faction relations drift toward their base each sol (see diploAct — gifts
    // spike, then fade if not maintained).
    let diploRelations = null;
    // Building wear: every placed building loses a little HP each sol, more per
    // fitted module. Below HP_THROTTLE_FLOOR output drops (hpFactor); a building
    // that just crossed that line raises a one-off alert.
    let placedPatch = null;
    let wearAlert = 0;
    if (nextCycle % CYCLES_PER_SOL === 0) {
      const cur = st.diploRelations || {};
      FACTIONS.forEach(f => {
        const have = cur[f.id];
        if (have == null) return;
        const gap = f.relation - have;
        if (Math.abs(gap) < 0.01) return;
        const step = Math.sign(gap) * Math.min(RELATION_DECAY_PER_SOL, Math.abs(gap));
        diploRelations = diploRelations || Object.assign({}, cur);
        diploRelations[f.id] = Math.round((have + step) * 100) / 100;
      });
      placedPatch = st.placed.map(b => {
        const info = MONO_INFO[b.mono] || {};
        const before = b.hp == null ? 100 : b.hp;
        const rate = (WEAR_PER_SOL + (b.modules || []).length * WEAR_PER_MODULE)
          * (info.warehouse || info.out === 'PO' ? WEAR_PASSIVE_MULT : 1);
        const after = Math.max(0, Math.round((before - rate) * 10) / 10);
        if (before >= HP_THROTTLE_FLOOR && after < HP_THROTTLE_FLOOR && !info.warehouse && info.out !== 'PO') wearAlert++;
        return after === before ? b : Object.assign({}, b, { hp: after });
      });
    }
    // creditBreakdown already folds in the Town Hall tax bonus, Garrison
    // upkeep discount and `cr` policy % — reuse it so the popup always
    // matches exactly what lands in resources.CR.
    const credit = Economy.creditBreakdown(st);
    res.CR = (res.CR || 0) + credit.net;
    const townHall = Economy.townHallBonus(st.placed);
    // Total Research Points generated this cycle: refined by institutes (rpTick)
    // plus a flat trickle from admin records / science policy / treaties / recon
    // drones. RP is pure flow — none of it is stockpiled. A covered comms
    // network speeds the whole effort (data sharing across the colony).
    const researchOutput = Math.max(0, (rpTick
      + Math.max(0, pol.research) + (townHall.rpBonus || 0)
      + (dip.research || 0) + Economy.fleetResearchBonus(st.fleets, st.placed))
      * (1 + 0.15 * comms.satisfaction));
    // Pour it into the research queue: the head node advances first, any
    // overflow rolls into the next, and a finished node flips to 'unlocked' and
    // opens its dependents (same effect the old instant researchSelected had).
    const queue = (st.researchQueue || []).slice();
    const progress = Object.assign({}, st.researchProgress || {});
    const techOverride = Object.assign({}, st.techOverride || {});
    let research = null;
    if (queue.length && researchOutput > 0) {
      let pool = researchOutput, guard = 0;
      while (queue.length && pool > 0 && guard++ < 12) {
        const id = queue[0];
        const node = TECH_NODES.find(n => n.id === id);
        if (!node) { queue.shift(); continue; }
        const need = Math.max(0, (node.rpCost || 0) - (progress[id] || 0));
        if (pool >= need) {
          pool -= need;
          delete progress[id];
          queue.shift();
          techOverride[id] = 'unlocked';
          TECH_NODES.forEach(n => {
            if (n.prereq === id && !techOverride[n.id] && n.base === 'locked') techOverride[n.id] = 'available';
          });
          research = { id: id, name: node.name };
        } else {
          progress[id] = (progress[id] || 0) + pool;
          pool = 0;
        }
      }
    }
    const rOut = Math.round(researchOutput * 10) / 10;

    // --- Objectives ------------------------------------------------------
    // Check the live checklist against the just-computed post-tick figures.
    let objectivesDone = null;
    const objectivesJustDone = [];
    {
      const doneSet = st.objectivesDone || [];
      const probe = Object.assign({}, st, {
        population, cycle: nextCycle, placed: placedPatch || st.placed,
        techOverride, researchOutput: rOut
      });
      OBJECTIVES.forEach(obj => {
        if (doneSet.indexOf(obj.id) !== -1) return;
        if (Economy.objectiveValue(probe, obj) >= obj.target) {
          objectivesDone = objectivesDone || doneSet.slice();
          objectivesDone.push(obj.id);
          const rw = obj.reward || {};
          if (rw.cr) res.CR = (res.CR || 0) + rw.cr;
          if (rw.res) for (const k in rw.res) res[k] = (res[k] || 0) + rw.res[k];
          objectivesJustDone.push({ id: obj.id, cr: rw.cr || 0, res: rw.res || null });
        }
      });
    }

    // --- Hazards --------------------------------------------------------
    let outHazards = activeHazards;
    let hazard = null;
    if (nextCycle % CYCLES_PER_SOL === 0) {
      const sol = Math.floor(nextCycle / CYCLES_PER_SOL);
      const diffMult = HAZARD_DIFF_MULT[st.newGameDiff] || 1;
      if (sol >= MIN_HAZARD_SOL && Math.random() < HAZARD_CHANCE_PER_SOL * diffMult) {
        // Crime pressure skews the draw toward raids (up to 3x weight at 100
        // crime) without touching storm/breakdown odds — a high-crime colony
        // gets raided more often, a low-crime one barely ever.
        const crimeForRaid = Economy.crimeRate(st);
        const weightFor = h => h.type === 'raid' ? h.weight * (1 + crimeForRaid * CRIME_RAID_WEIGHT_MULT) : h.weight;
        const totW = HAZARDS.reduce((n, h) => n + weightFor(h), 0);
        let r = Math.random() * totW, pick = HAZARDS[0];
        for (let i = 0; i < HAZARDS.length; i++) { r -= weightFor(HAZARDS[i]); if (r <= 0) { pick = HAZARDS[i]; break; } }
        if (pick.type === 'storm') {
          hazard = { type: 'storm', until: nextCycle + (pick.durSols || 3) * CYCLES_PER_SOL, mag: pick.mag || 0.85 };
          outHazards = activeHazards.concat([hazard]);
        } else if (pick.type === 'breakdown') {
          const pool = (placedPatch || st.placed).filter(b => {
            const info = MONO_INFO[b.mono] || {};
            return !info.warehouse && info.out !== 'PO' && (st.placed.length <= 1 || connected.has(b.id));
          });
          if (pool.length) {
            const victim = pool[Math.floor(Math.random() * pool.length)];
            placedPatch = (placedPatch || st.placed).map(b => b.id === victim.id ? Object.assign({}, b, { hp: pick.hpTo || 20 }) : b);
            hazard = { type: 'breakdown', targetName: victim.name };
          }
        } else if (pick.type === 'raid') {
          const staffNow = Economy.staffStatus(st);
          const defended = Economy.upkeepDiscount(st.placed) > 0 && (staffNow.filled.military || 0) >= 3;
          if (defended) {
            hazard = { type: 'raid', fizzled: true };
          } else {
            const goods = ['OR', 'BM', 'GR', 'PR', 'TI', 'H3', 'SC'].filter(c => (res[c] || 0) > 50);
            if (goods.length) {
              const g = goods[Math.floor(Math.random() * goods.length)];
              const severityMult = CRIME_RAID_SEVERITY_MIN_MULT + (1 - CRIME_RAID_SEVERITY_MIN_MULT) * crimeForRaid / 100;
              const lost = Math.round(res[g] * (pick.lossFrac || 0.25) * severityMult);
              res[g] = Math.max(0, res[g] - lost);
              hazard = { type: 'raid', lostCode: g, lostAmount: lost };
            } else {
              hazard = { type: 'raid', lostAmount: 0 };
            }
          }
        }
      }
    }

    const patch = {
      resources: res,
      population,
      popGrowthAccum,
      arrival,
      casualties,
      research,
      researchQueue: queue,
      researchProgress: progress,
      researchOutput: rOut,
      cycle: nextCycle,
      lastDeltas: { CR: credit.net, PO: population - st.population }
    };
    if (research) patch.techOverride = techOverride;
    if (diploRelations) patch.diploRelations = diploRelations;
    if (placedPatch) patch.placed = placedPatch;
    if (wearAlert > 0) patch.wearAlert = wearAlert;
    if (objectivesDone) { patch.objectivesDone = objectivesDone; patch.objectivesJustDone = objectivesJustDone; }
    if (outHazards !== activeHazards || (st.activeHazards || []).length !== activeHazards.length) patch.activeHazards = outHazards;
    if (hazard) patch.hazard = hazard;
    return patch;
  }
};
