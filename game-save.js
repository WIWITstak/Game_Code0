// Save/load — pure data in, pure data out. localStorage is the only browser
// API touched here, wrapped in try/catch (private browsing, quota, disabled
// storage, corrupt JSON all throw or return garbage in the wild). game.js
// owns *when* to call these (autosave tick, manual Save, Continue, a Load
// slot click); this module only knows *what* game progress looks like and
// how to turn it back into a setState-able patch.
'use strict';

const SaveSystem = (function () {
  const PREFIX = 'marsAwakening_v1_';

  // Keys copied out of/into component state. Deliberately just game
  // progress — camera position, open panels, hover state etc. stay out so a
  // save/load never resurrects stale UI.
  const FIELDS = [
    'colonyNameOverride', 'resources', 'population', 'cycle', 'lastDeltas',
    'placed', 'links', 'techOverride', 'selectedTechId', 'policyChoice',
    'tradeStatus', 'tradeAdded', 'diploRelations', 'diploTreaties', 'diploLog',
    'sysFleetsHidden', 'fleets', 'popGrowthAccum', 'colonyEvents', 'whMachines',
    'researchQueue', 'researchProgress', 'objectivesDone', 'activeHazards',
    'activeRegion', 'beltPanX', 'beltPanY', 'outposts', 'surveys', 'story',
    'sectorState', 'regionCam', 'ally'
  ];

  function snapshot(state) {
    const out = { savedAt: Date.now() };
    FIELDS.forEach((k) => { out[k] = state[k]; });
    return out;
  }

  function save(slotId, state) {
    try {
      localStorage.setItem(PREFIX + slotId, JSON.stringify(snapshot(state)));
      return true;
    } catch (e) { return false; }
  }

  // Returns a plain object of just the saved fields (safe to spread into
  // setState), or null if the slot is empty/corrupt.
  function load(slotId) {
    try {
      const raw = localStorage.getItem(PREFIX + slotId);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !Array.isArray(data.placed)) return null;
      return data;
    } catch (e) { return null; }
  }

  function remove(slotId) {
    try { localStorage.removeItem(PREFIX + slotId); } catch (e) {}
  }

  function exists(slotId) {
    try { return localStorage.getItem(PREFIX + slotId) != null; } catch (e) { return false; }
  }

  return { FIELDS, save, load, remove, exists };
})();
