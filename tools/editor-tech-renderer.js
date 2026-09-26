'use strict';
/* Tech tree editor — reads/writes TECH_NODES + BELT_TECH_ID in game-data.js,
 * and the per-node name/desc override tables at I18N.en.d.tech / .ru.d.tech
 * in game-i18n.js (two levels deep — `d` is a sub-namespace of each language
 * block, see game.js's `const D = t.d;`).
 *
 * A node's EN name/desc is actually stored TWICE at runtime: the raw
 * `TECH_NODES[i].name/.desc` (the original fallback text) and the i18n
 * override `I18N.en.d.tech[id].name/.desc` (read first — see game.js:
 * `td.name || n.name`). Rather than exposing that as two separate fields
 * (confusing, and lets them drift), this editor treats "Name EN"/"Desc EN"
 * as one field and writes it to both places on save, so the fallback is
 * never stale. `prereqName` (used only as an ultimate fallback alongside
 * `prereqName`) is likewise auto-derived from the prereq node's name on
 * every save — never hand-edited.
 *
 * TECH_UNLOCK_BUILDING is NOT touched — it's derived from TECH_NODES.unlocks
 * at load time, not separately authored data. SHELF_ITEMS is read (from the
 * same file) only to validate/hint `unlocks` mono codes — never written by
 * this editor. */

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'game-data.js');
const I18N_PATH = path.join(ROOT, 'game-i18n.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const BACKUP_DIR = path.join(ROOT, '.storyedit-backup');

const CATEGORIES = ['Ecology', 'Habitation', 'Industry', 'Energy', 'Research', 'Logistics'];
const BASE_STATES = ['unlocked', 'available', 'locked'];
const FX_CHANNELS = ['prod', 'power', 'cr', 'sci', 'upkeep'];
// Fields with their own input; everything else on a node is free-form JSON
// (e.g. the legacy unused `cost:'Researched'` string on two starter nodes).
// `name`/`desc` are handled via techText (mirrored into the raw field on
// save); `prereqName` is auto-derived — neither ever appears in "extra".
const STRUCTURED_KEYS = ['id', 'name', 'desc', 'category', 'tier', 'x', 'y', 'base', 'prereq', 'prereqName', 'crCost', 'rpCost', 'unlocks', 'fx'];

function findStringConst(src, varName) {
  const re = new RegExp("(?:const|let|var)\\s+" + varName + "\\s*=\\s*(['\"])((?:\\\\.|(?!\\1).)*)\\1");
  const m = re.exec(src);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length, value: m[2] };
}
function asArray(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */

let dataSrc = '', i18nSrc = '';
let techBlock = null, beltConst = null, enTechBlock = null, ruTechBlock = null;
let techNodes = [];
let beltTechId = '';
let shelfItemsRO = {}; // read-only, for validating/hinting `unlocks` mono codes
// techText[id] = { name:{ru,en}, desc:{ru,en} } — EN mirrors into the node's
// own name/desc on save (see file header); RU only ever lives here.
let techText = {};
let dirty = false;

function loadAll() {
  dataSrc = fs.readFileSync(DATA_PATH, 'utf8');
  i18nSrc = fs.readFileSync(I18N_PATH, 'utf8');
  techBlock = findBlock(dataSrc, 'TECH_NODES');
  beltConst = findStringConst(dataSrc, 'BELT_TECH_ID');
  enTechBlock = findNthKeyBlock(i18nSrc, 'tech', 1);
  ruTechBlock = findNthKeyBlock(i18nSrc, 'tech', 2);
  if (!techBlock) throw new Error('Не найден блок TECH_NODES в game-data.js');
  if (!beltConst) throw new Error('Не найдена константа BELT_TECH_ID в game-data.js');
  if (!enTechBlock || !ruTechBlock) throw new Error('Не найден блок tech (d.tech) в game-i18n.js (en/ru)');

  techNodes = evalBlock(techBlock.source);
  beltTechId = beltConst.value;
  const shelfBlock = findBlock(dataSrc, 'SHELF_ITEMS');
  shelfItemsRO = shelfBlock ? evalBlock(shelfBlock.source) : {};

  const enText = evalBlock(enTechBlock.source);
  const ruText = evalBlock(ruTechBlock.source);
  techText = {};
  const allIds = new Set([...techNodes.map((n) => n.id), ...Object.keys(enText), ...Object.keys(ruText)]);
  allIds.forEach((id) => {
    const node = techNodes.find((n) => n.id === id);
    techText[id] = {
      name: { en: (enText[id] && enText[id].name) || (node && node.name) || '', ru: (ruText[id] && ruText[id].name) || '' },
      desc: { en: (enText[id] && enText[id].desc) || (node && node.desc) || '', ru: (ruText[id] && ruText[id].desc) || '' },
    };
  });

  dirty = false;
  undoStack.length = 0;
}

function techTextForLang(lang) {
  const out = {};
  for (const id in techText) {
    const t = techText[id];
    if (t.name[lang] || t.desc[lang]) out[id] = { name: t.name[lang] || '', desc: t.desc[lang] || '' };
  }
  return out;
}

function allKnownMonos() {
  const list = [];
  Object.keys(shelfItemsRO).forEach((cat) => {
    (shelfItemsRO[cat] || []).forEach((it) => {
      list.push(it.mono);
      if (it.chain && it.chain.sources) it.chain.sources.forEach((sc) => list.push(sc.mono));
    });
  });
  return list;
}

function saveAll() {
  // EN name/desc mirror into the node's own raw fields (the ultimate
  // fallback); prereqName is always re-derived, never hand-edited.
  techNodes.forEach((n) => {
    const txt = techText[n.id];
    if (txt) { n.name = txt.name.en; n.desc = txt.desc.en; }
  });
  techNodes.forEach((n) => {
    if (n.prereq) {
      const p = techNodes.find((x) => x.id === n.prereq);
      if (p) n.prereqName = p.name; else delete n.prereqName;
    } else delete n.prereqName;
  });

  // BELT_TECH_ID sits after TECH_NODES in the file — splice it first so
  // TECH_NODES's recorded offsets (earlier in the file) stay valid.
  let newDataSrc = dataSrc.slice(0, beltConst.start) + 'const BELT_TECH_ID = ' + JSON.stringify(beltTechId) + dataSrc.slice(beltConst.end);
  newDataSrc = newDataSrc.slice(0, techBlock.blockStart) + serialize(techNodes, '') + newDataSrc.slice(techBlock.blockEnd);

  // ru.d.tech sits after en.d.tech — same later-first rule.
  let newI18nSrc = i18nSrc.slice(0, ruTechBlock.blockStart) + serialize(techTextForLang('ru'), '') + i18nSrc.slice(ruTechBlock.blockEnd);
  newI18nSrc = newI18nSrc.slice(0, enTechBlock.blockStart) + serialize(techTextForLang('en'), '') + newI18nSrc.slice(enTechBlock.blockEnd);

  backupFile(DATA_PATH, BACKUP_DIR);
  backupFile(I18N_PATH, BACKUP_DIR);
  fs.writeFileSync(DATA_PATH, newDataSrc, 'utf8');
  fs.writeFileSync(I18N_PATH, newI18nSrc, 'utf8');

  try {
    let html = fs.readFileSync(INDEX_PATH, 'utf8');
    html = bumpVersion(html, 'game-data.js');
    html = bumpVersion(html, 'game-i18n.js');
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
  undoStack.push({ techNodes: cloneData(techNodes), techText: cloneData(techText), beltTechId });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoButton();
}
function undo() {
  if (!undoStack.length) return;
  const snap = undoStack.pop();
  techNodes = snap.techNodes; techText = snap.techText; beltTechId = snap.beltTechId;
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

function techLabel(n) { return (techText[n.id] && techText[n.id].name.en) || n.id; }

function validateAll() {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  techNodes.forEach((n) => {
    if (ids.has(n.id)) errors.push({ msg: 'Повторяющийся ID технологии: "' + n.id + '"' });
    ids.add(n.id);
  });
  const knownMonos = new Set(allKnownMonos());
  techNodes.forEach((n) => {
    if (n.prereq && !techNodes.some((x) => x.id === n.prereq)) errors.push({ msg: '«' + techLabel(n) + '»: требование "' + n.prereq + '" не существует' });
    asArray(n.unlocks).forEach((m) => {
      if (m && !knownMonos.has(m)) warnings.push({ msg: '«' + techLabel(n) + '»: открывает неизвестный mono-код "' + m + '" (нет такого здания)' });
    });
    // cycle detection along the prereq chain
    const seen = new Set();
    let cur = n;
    while (cur && cur.prereq) {
      if (seen.has(cur.id)) { errors.push({ msg: 'Цикл зависимостей начиная с «' + techLabel(n) + '»' }); break; }
      seen.add(cur.id);
      cur = techNodes.find((x) => x.id === cur.prereq);
    }
  });
  if (!techNodes.some((n) => n.id === beltTechId)) errors.push({ msg: 'BELT_TECH_ID указывает на несуществующий узел "' + beltTechId + '"' });
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
/* node cards                                                           */
/* ------------------------------------------------------------------ */

function newTechSkeleton(category) {
  const maxY = techNodes.filter((n) => n.category === category).reduce((m, n) => Math.max(m, n.y || 0), -140);
  return { id: 'new_tech', name: 'New Technology', category, tier: 1, x: 40, y: maxY + 140, base: 'locked', desc: '', prereq: null, crCost: 1000, rpCost: 20 };
}

function extraFieldsOf(node) {
  const out = {};
  for (const k in node) if (STRUCTURED_KEYS.indexOf(k) === -1) out[k] = node[k];
  return out;
}
function applyExtraFields(node, parsed) {
  Object.keys(node).forEach((k) => { if (STRUCTURED_KEYS.indexOf(k) === -1) delete node[k]; });
  Object.assign(node, parsed);
}

function renameTechId(node, newId) {
  if (!newId || newId === node.id || techNodes.some((n) => n.id === newId)) return false;
  const oldId = node.id;
  node.id = newId;
  techText[newId] = techText[oldId] || { name: { ru: '', en: '' }, desc: { ru: '', en: '' } };
  if (newId !== oldId) delete techText[oldId];
  techNodes.forEach((n) => { if (n.prereq === oldId) n.prereq = newId; });
  if (beltTechId === oldId) beltTechId = newId;
  return true;
}

function renderFxRow(node, idx) {
  const pair = node.fx[idx];
  const chSel = select(FX_CHANNELS.map((c) => ({ value: c, label: c })), pair[0], (v) => { pair[0] = v; markDirty(); });
  const valInp = textInput(pair[1], (v) => { pair[1] = v; markDirty(); });
  const rm = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить бонус' });
  rm.addEventListener('click', () => {
    snapshotForUndo();
    node.fx.splice(idx, 1);
    if (!node.fx.length) delete node.fx;
    markDirty(); renderAll();
  });
  return el('div', { class: 'fx-row' }, [chSel, valInp, rm]);
}

function renderTechCard(node) {
  const card = el('div', { class: 'tech-card' });
  const txt = techText[node.id] || (techText[node.id] = { name: { ru: '', en: '' }, desc: { ru: '', en: '' } });

  const idInput = textInputCommit(node.id, (v) => { if (renameTechId(node, v)) { markDirty(); renderAll(); } });
  const catSelect = select(CATEGORIES.map((c) => ({ value: c, label: c })), node.category, (v) => { node.category = v; markDirty(); renderAll(); });
  const tierInput = numInput(node.tier || 1, (v) => { node.tier = v; markDirty(); });
  const baseSelect = select(BASE_STATES.map((b) => ({ value: b, label: b })), node.base || 'locked', (v) => { node.base = v; markDirty(); });

  card.appendChild(el('div', { class: 'tech-row1' }, [
    field('ID', idInput),
    field('Категория', catSelect),
    field('Уровень', tierInput),
    field('Стартовое состояние', baseSelect),
  ]));

  const prereqOpts = [{ value: '', label: '— нет —' }].concat(techNodes.filter((n) => n !== node).map((n) => ({ value: n.id, label: techLabel(n) + ' (' + n.id + ')' })));
  const prereqSelect = select(prereqOpts, node.prereq || '', (v) => { node.prereq = v || null; markDirty(); renderAll(); });
  const crInput = numInput(node.crCost || 0, (v) => { node.crCost = v; markDirty(); });
  const rpInput = numInput(node.rpCost || 0, (v) => { node.rpCost = v; markDirty(); });
  const xInput = numInput(node.x || 0, (v) => { node.x = v; markDirty(); });
  const yInput = numInput(node.y || 0, (v) => { node.y = v; markDirty(); });

  card.appendChild(el('div', { class: 'tech-row2' }, [
    field('X', xInput),
    field('Y', yInput),
    field('Требование (prereq)', prereqSelect),
    field('Стоимость CR', crInput),
    field('Стоимость RP', rpInput),
  ]));

  card.appendChild(el('div', { class: 'grid2' }, [
    field('Название RU', textInput(txt.name.ru, (v) => { txt.name.ru = v; markDirty(); })),
    field('Название EN', textInput(txt.name.en, (v) => { txt.name.en = v; markDirty(); })),
  ]));
  card.appendChild(el('div', { class: 'grid2' }, [
    field('Описание RU', textArea(txt.desc.ru, (v) => { txt.desc.ru = v; markDirty(); }, 2)),
    field('Описание EN', textArea(txt.desc.en, (v) => { txt.desc.en = v; markDirty(); }, 2)),
  ]));

  const unlocksInput = textInput(asArray(node.unlocks).join(', '), (v) => {
    const list = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) node.unlocks = list; else delete node.unlocks;
    markDirty(); renderValidation();
  });
  card.appendChild(field('Открывает здания (mono-коды через запятую)', unlocksInput));

  card.appendChild(el('span', { class: 'field-label', text: 'Бонусы колонии (fx)' }));
  const fxWrap = el('div', { class: 'fx-wrap' });
  (node.fx || []).forEach((pair, i) => fxWrap.appendChild(renderFxRow(node, i)));
  card.appendChild(fxWrap);
  const addFxBtn = el('button', { class: 'btn small ghost', text: '+ Бонус' });
  addFxBtn.addEventListener('click', () => {
    snapshotForUndo();
    node.fx = node.fx || [];
    node.fx.push(['prod', '+1%']);
    markDirty(); renderAll();
  });
  card.appendChild(addFxBtn);

  const extra = extraFieldsOf(node);
  if (Object.keys(extra).length) {
    card.appendChild(el('span', { class: 'tech-extra-label', text: 'Прочие свойства (JSON, унаследовано из данных)' }));
    card.appendChild(jsonField(extra, (v) => { applyExtraFields(node, v); markDirty(); }, 2, '{}'));
  }

  const dup = el('button', { class: 'icon-btn dup', text: '⧉', title: 'Дублировать технологию' });
  dup.addEventListener('click', () => {
    promptModal('ID новой технологии:', node.id + '_copy', (newId) => {
      if (techNodes.some((n) => n.id === newId)) { infoModal('Такой ID уже есть: "' + newId + '".'); return; }
      snapshotForUndo();
      const copy = cloneData(node);
      copy.id = newId;
      delete copy.prereqName;
      techNodes.push(copy);
      techText[newId] = cloneData(techText[node.id]);
      markDirty(); renderAll();
    });
  });
  const del = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить технологию' });
  del.addEventListener('click', () => {
    const dependents = techNodes.filter((n) => n.prereq === node.id);
    const msg = 'Удалить технологию «' + techLabel(node) + '»?' + (dependents.length ? ' От неё зависит: ' + dependents.map(techLabel).join(', ') + '.' : '');
    confirmModal(msg, () => {
      snapshotForUndo();
      techNodes = techNodes.filter((n) => n !== node);
      delete techText[node.id];
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
  CATEGORIES.forEach((cat) => {
    const items = techNodes.filter((n) => n.category === cat);
    const section = el('div', { class: 'cat-section' });
    const addBtn = el('button', { class: 'btn small ghost', text: '+ Добавить' });
    addBtn.addEventListener('click', () => {
      promptModal('ID новой технологии (латиницей):', 'new_tech', (id) => {
        if (techNodes.some((n) => n.id === id)) { infoModal('Такой ID уже есть: "' + id + '".'); return; }
        snapshotForUndo();
        const skel = newTechSkeleton(cat);
        skel.id = id;
        techNodes.push(skel);
        techText[id] = { name: { ru: '', en: skel.name }, desc: { ru: '', en: '' } };
        markDirty(); renderAll();
      });
    });
    section.appendChild(el('div', { class: 'cat-head' }, [
      el('span', { class: 'cat-title', text: cat }),
      el('span', { class: 'cat-count', text: items.length + ' шт.' }),
      addBtn,
    ]));
    if (!items.length) {
      section.appendChild(el('div', { class: 'cat-empty', text: 'Пока нет технологий в этой категории.' }));
    } else {
      const list = el('div', { class: 'tech-list' });
      items.sort((a, b) => (a.tier || 0) - (b.tier || 0)).forEach((n) => list.appendChild(renderTechCard(n)));
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
