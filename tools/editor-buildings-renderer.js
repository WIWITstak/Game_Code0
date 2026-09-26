'use strict';
/* Building editor — reads/writes SHELF_ITEMS in game-data.js. A building
 * object can carry a wide, type-dependent set of fields (plain producer,
 * housing, deposit-based extractor, production chain, spaceport, warehouse,
 * connector, power plant, unique civic building, ...) — rather than modelling
 * every combination as its own form, the handful of fields nearly every
 * building has (name/mono/cost/tier/staff/output+rate) get real inputs, and
 * everything else (chain, depositBased, arrivals/dockBays, warehouse*,
 * dayOnly/fuelType/fuelRate, unique/crTaxBonus/rpBonus/upkeepDiscount,
 * logiRange, haulerCap, refineFrom, connector) goes in one "extra" JSON
 * field per card — same trade-off as dialogue effects / objective rewards.
 *
 * MONO_INFO (game-data.js) is NOT touched here — it's derived automatically
 * from SHELF_ITEMS every time the game loads, not separately authored data.
 * TECH_UNLOCK_BUILDING (tech-gating) is likewise derived, from TECH_NODES —
 * out of scope for this editor; a new building starts ungated. */

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'game-data.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const BACKUP_DIR = path.join(ROOT, '.storyedit-backup');

const CATEGORIES = [
  { id: 'habitation', label: 'Жильё' },
  { id: 'industry', label: 'Промышленность' },
  { id: 'ecology', label: 'Экология' },
  { id: 'energy', label: 'Энергетика' },
  { id: 'public', label: 'Общественные' },
  { id: 'infra', label: 'Инфраструктура' },
  { id: 'beltmine', label: 'Пояс: добыча' },
  { id: 'beltinfra', label: 'Пояс: инфраструктура' },
];
const BELT_CAT_IDS = ['beltmine', 'beltinfra'];
const STAFF_TYPES = ['worker', 'engineer', 'scientist', 'military'];
const TIERS = [1, 2, 3];
// Fields that get their own input; everything else on a building object is
// free-form JSON. `belt` is auto-derived from category on save, so it's
// excluded from both — never hand-edited.
const STRUCTURED_KEYS = ['name', 'cost', 'mono', 'tier', 'staffType', 'staffCount', 'out', 'rate'];

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */

let dataSrc = '';
let shelfBlock = null;
let shelfItems = {};
let dirty = false;

function loadAll() {
  dataSrc = fs.readFileSync(DATA_PATH, 'utf8');
  shelfBlock = findBlock(dataSrc, 'SHELF_ITEMS');
  if (!shelfBlock) throw new Error('Не найден блок SHELF_ITEMS в game-data.js');
  shelfItems = evalBlock(shelfBlock.source);
  CATEGORIES.forEach((c) => { if (!shelfItems[c.id]) shelfItems[c.id] = []; });
  dirty = false;
  undoStack.length = 0;
}

function saveAll() {
  // belt-only categories always carry belt:true; everything else never does
  // — enforced here rather than left to hand-editing, so it can't drift.
  CATEGORIES.forEach((c) => {
    shelfItems[c.id].forEach((it) => {
      if (BELT_CAT_IDS.indexOf(c.id) !== -1) it.belt = true;
      else delete it.belt;
    });
  });
  const newDataSrc = dataSrc.slice(0, shelfBlock.blockStart) + serialize(shelfItems, '') + dataSrc.slice(shelfBlock.blockEnd);
  backupFile(DATA_PATH, BACKUP_DIR);
  fs.writeFileSync(DATA_PATH, newDataSrc, 'utf8');
  try {
    let html = fs.readFileSync(INDEX_PATH, 'utf8');
    html = bumpVersion(html, 'game-data.js');
    fs.writeFileSync(INDEX_PATH, html, 'utf8');
  } catch (e) { /* non-fatal */ }
  loadAll();
}

/* ------------------------------------------------------------------ */
/* undo                                                                 */
/* ------------------------------------------------------------------ */

const undoStack = [];
const MAX_UNDO = 60;
function snapshotForUndo() {
  undoStack.push(cloneData(shelfItems));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoButton();
}
function undo() {
  if (!undoStack.length) return;
  shelfItems = undoStack.pop();
  dirty = true;
  renderAll();
}
function updateUndoButton() {
  const b = document.getElementById('undo-btn');
  if (b) b.disabled = undoStack.length === 0;
}
UNDO_HOOK = snapshotForUndo;

function markDirty() { dirty = true; renderStatus(); renderValidation(); }
function renderStatus() {
  const s = document.getElementById('status');
  s.textContent = dirty ? 'Есть несохранённые изменения' : 'Сохранено';
  s.className = dirty ? 'status dirty' : 'status clean';
}

/* ------------------------------------------------------------------ */
/* validation                                                           */
/* ------------------------------------------------------------------ */

function allMonoRefs() {
  const list = [];
  CATEGORIES.forEach((c) => {
    (shelfItems[c.id] || []).forEach((it) => {
      list.push({ mono: it.mono, label: (it.name || '(без имени)') + ' [' + c.label + ']' });
      if (it.chain && it.chain.sources) it.chain.sources.forEach((sc) => {
        list.push({ mono: sc.mono, label: (sc.name || '(без имени)') + ' — источник для ' + (it.name || '?') });
      });
    });
  });
  return list;
}

function validateAll() {
  const errors = [];
  const warnings = [];
  const seen = {};
  allMonoRefs().forEach((r) => {
    if (!r.mono) { errors.push({ msg: 'Пустой mono-код: ' + r.label }); return; }
    if (seen[r.mono]) errors.push({ msg: 'Повторяющийся mono-код "' + r.mono + '": ' + seen[r.mono] + ' и ' + r.label });
    seen[r.mono] = r.label;
  });
  CATEGORIES.forEach((c) => {
    (shelfItems[c.id] || []).forEach((it) => {
      if (!it.name) errors.push({ msg: 'Здание без названия (mono ' + (it.mono || '?') + ') в категории «' + c.label + '»' });
      if (it.staffType && !it.staffCount) warnings.push({ msg: '«' + it.name + '»: указан тип персонала, но количество 0' });
      if (!it.staffType && it.staffCount) warnings.push({ msg: '«' + it.name + '»: указано количество персонала без типа' });
    });
  });
  const badFields = document.querySelectorAll('.bad').length;
  if (badFields > 0) errors.push({ msg: 'Есть поля с ошибками JSON — ' + badFields + ' шт.' });
  return { errors, warnings };
}

function renderValidation() {
  const bar = document.getElementById('validation-bar');
  if (!bar) return;
  const { errors, warnings } = validateAll();
  bar.innerHTML = '';
  if (!errors.length && !warnings.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const mk = (item, cls) => el('div', { class: 'val-row ' + cls }, [el('span', { text: item.msg })]);
  errors.forEach((e) => bar.appendChild(mk(e, 'val-error')));
  warnings.forEach((w) => bar.appendChild(mk(w, 'val-warning')));
}

/* ------------------------------------------------------------------ */
/* building cards                                                       */
/* ------------------------------------------------------------------ */

function newBuildingSkeleton() {
  return { name: 'Новое здание', cost: 100, mono: '??', tier: 1 };
}

function extraFieldsOf(item) {
  const out = {};
  for (const k in item) if (STRUCTURED_KEYS.indexOf(k) === -1 && k !== 'belt') out[k] = item[k];
  return out;
}
function applyExtraFields(item, parsed) {
  Object.keys(item).forEach((k) => { if (STRUCTURED_KEYS.indexOf(k) === -1 && k !== 'belt') delete item[k]; });
  Object.assign(item, parsed);
}

function moveBuildingToCategory(item, fromCatId, toCatId) {
  if (fromCatId === toCatId) return;
  shelfItems[fromCatId] = shelfItems[fromCatId].filter((x) => x !== item);
  shelfItems[toCatId] = shelfItems[toCatId] || [];
  shelfItems[toCatId].push(item);
}

function renderBuildingCard(item, catId) {
  const card = el('div', { class: 'bld-card' });

  const catSelect = select(CATEGORIES.map((c) => ({ value: c.id, label: c.label })), catId, (v) => {
    snapshotForUndo();
    moveBuildingToCategory(item, catId, v);
    markDirty(); renderAll();
  });
  const nameInput = textInput(item.name, (v) => { item.name = v; markDirty(); });
  const monoInput = textInput(item.mono, (v) => { item.mono = v.trim(); markDirty(); renderValidation(); }, { cls: 'mono' });
  const costInput = numInput(item.cost || 0, (v) => { item.cost = v; markDirty(); });

  card.appendChild(el('div', { class: 'bld-card-head' }, [
    field('Название', nameInput),
    field('Mono', monoInput),
    field('Стоимость', costInput),
    field('Категория', catSelect),
  ]));

  const tierSelect = select(TIERS.map((t) => ({ value: String(t), label: 'Уровень ' + t })), String(item.tier || 1), (v) => { item.tier = Number(v); markDirty(); });
  const staffTypeSelect = select([{ value: '', label: '— нет персонала —' }].concat(STAFF_TYPES.map((s) => ({ value: s, label: s }))), item.staffType || '', (v) => {
    if (v) item.staffType = v; else { delete item.staffType; delete item.staffCount; }
    markDirty(); renderAll();
  });
  const staffCountInput = numInput(item.staffCount || 0, (v) => { item.staffCount = v; markDirty(); });
  const outInput = textInput(item.out || '', (v) => { if (v.trim()) item.out = v.trim(); else delete item.out; markDirty(); }, { cls: 'mono' });

  const row2 = el('div', { class: 'bld-card-row2' }, [
    field('Уровень', tierSelect),
    field('Персонал', staffTypeSelect),
  ]);
  if (item.staffType) row2.appendChild(field('Кол-во', staffCountInput));
  row2.appendChild(field('Выход (код ресурса)', outInput));
  const rateInput = numInput(item.rate || 0, (v) => { if (v) item.rate = v; else delete item.rate; markDirty(); });
  row2.appendChild(field('Скорость (rate)', rateInput));
  card.appendChild(row2);

  card.appendChild(el('span', { class: 'bld-extra-label', text: 'Прочие свойства (JSON): depositBased, depositType, arrivals, dockBays, chain{sources,outputMono,outputName}, dayOnly, fuelType, fuelRate, unique, crTaxBonus, rpBonus, upkeepDiscount, logiRange, warehouse, warehouseFor, capBonus, haulerCap, refineFrom, connector' }));
  card.appendChild(jsonField(extraFieldsOf(item), (v) => { applyExtraFields(item, v); markDirty(); }, 3, '{"unique":true,"logiRange":5}'));

  const dup = el('button', { class: 'icon-btn dup', text: '⧉', title: 'Дублировать здание' });
  dup.addEventListener('click', () => {
    snapshotForUndo();
    const copy = cloneData(item);
    copy.name = (item.name || '') + ' (копия)';
    copy.mono = '??';
    shelfItems[catId].push(copy);
    markDirty(); renderAll();
  });
  const del = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить здание' });
  del.addEventListener('click', () => {
    confirmModal('Удалить здание «' + item.name + '»?', () => {
      snapshotForUndo();
      shelfItems[catId] = shelfItems[catId].filter((x) => x !== item);
      markDirty(); renderAll();
    });
  });
  card.appendChild(dup);
  card.appendChild(del);

  return card;
}

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */

function renderAll() {
  const root = document.getElementById('content');
  root.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const items = shelfItems[c.id] || [];
    const section = el('div', { class: 'cat-section' });
    const addBtn = el('button', { class: 'btn small ghost', text: '+ Добавить' });
    addBtn.addEventListener('click', () => {
      snapshotForUndo();
      shelfItems[c.id].push(newBuildingSkeleton());
      markDirty(); renderAll();
    });
    section.appendChild(el('div', { class: 'cat-head' }, [
      el('span', { class: 'cat-title', text: c.label }),
      el('span', { class: 'cat-count', text: items.length + ' шт.' }),
      addBtn,
    ]));
    if (!items.length) {
      section.appendChild(el('div', { class: 'cat-empty', text: 'Пока нет зданий в этой категории.' }));
    } else {
      const list = el('div', { class: 'bld-list' });
      items.forEach((it) => list.appendChild(renderBuildingCard(it, c.id)));
      section.appendChild(list);
    }
    root.appendChild(section);
  });
  renderStatus();
  renderValidation();
  updateUndoButton();
}

function doSave() {
  const { errors } = validateAll();
  if (errors.length) { infoModal('Нельзя сохранить — есть ошибки (' + errors.length + '). Список — под панелью вкладок.'); renderValidation(); return; }
  try { saveAll(); renderAll(); }
  catch (e) { infoModal('Ошибка сохранения: ' + (e.message || e)); }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    loadAll();
  } catch (e) {
    document.body.innerHTML = '<div class="fatal">Не удалось загрузить данные:<br>' + String(e.message || e) + '</div>';
    return;
  }
  document.getElementById('save-btn').addEventListener('click', doSave);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('home-btn').addEventListener('click', () => {
    const goHome = () => { window.location.href = 'editor.html'; };
    if (dirty) confirmModal('Есть несохранённые изменения — уйти в меню и потерять их?', goHome);
    else goHome();
  });
  document.getElementById('reload-btn').addEventListener('click', () => {
    const doReload = () => { loadAll(); renderAll(); };
    if (dirty) confirmModal('Есть несохранённые изменения — перечитать файлы с диска и потерять их?', doReload);
    else doReload();
  });
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); doSave(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.returnValue = ''; return ''; } });
  renderAll();
});
