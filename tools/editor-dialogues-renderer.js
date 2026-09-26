'use strict';
/* Dialogue & objective editor — reads/writes the real source files by
 * locating the STORY_SPEAKERS / STORY_DIALOGUES / OBJECTIVES literal blocks
 * with a bracket-depth scanner (respects strings/comments), `eval()`-ing
 * just that slice into real JS values, editing them in memory, then
 * re-serializing and splicing the text back in place. Everything else in
 * the file (comments, helper consts, other code) is left byte-identical.
 *
 * Dialogue `trigger` fields stay real functions end-to-end: we never call
 * them, only show/edit `fn.toString()`, so free variables like `sol()` /
 * `pop()` (declared elsewhere in game-story.js) don't need to resolve here
 * — they resolve fine once the regenerated file loads in the game.
 *
 * Shared plumbing (block scanning/serialization, DOM/modal helpers,
 * cloneData, undo-arming) lives in editor-common.js, loaded before this
 * file — see that file's header for why. */

const ROOT = path.join(__dirname, '..');
const STORY_PATH = path.join(ROOT, 'game-story.js');
const DATA_PATH = path.join(ROOT, 'game-data.js');
const I18N_PATH = path.join(ROOT, 'game-i18n.js');
const INDEX_PATH = path.join(ROOT, 'index.html');
const BACKUP_DIR = path.join(ROOT, '.storyedit-backup');

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */

let storySrc = '', dataSrc = '', i18nSrc = '';
let spkBlock = null, dlgBlock = null, objBlock = null, i18nEnObjBlock = null, i18nRuObjBlock = null;
let speakers = {}, dialogues = [], objectives = [];
// objectiveText[id] = { name:{ru,en}, desc:{ru,en} } — merged from I18N's
// en.objectives / ru.objectives (see loadAll); the OBJECTIVES array itself
// only ever carries the mechanical id/type/target/reward/kind/dialogueIds.
let objectiveText = {};
let dirty = false;
let activeTab = 'dialogues';
let selectedDialogueId = null;

function loadAll() {
  storySrc = fs.readFileSync(STORY_PATH, 'utf8');
  dataSrc = fs.readFileSync(DATA_PATH, 'utf8');
  i18nSrc = fs.readFileSync(I18N_PATH, 'utf8');
  spkBlock = findBlock(storySrc, 'STORY_SPEAKERS');
  dlgBlock = findBlock(storySrc, 'STORY_DIALOGUES');
  objBlock = findBlock(dataSrc, 'OBJECTIVES');
  i18nEnObjBlock = findNthKeyBlock(i18nSrc, 'objectives', 1);
  i18nRuObjBlock = findNthKeyBlock(i18nSrc, 'objectives', 2);
  if (!spkBlock) throw new Error('Не найден блок STORY_SPEAKERS в game-story.js');
  if (!dlgBlock) throw new Error('Не найден блок STORY_DIALOGUES в game-story.js');
  if (!objBlock) throw new Error('Не найден блок OBJECTIVES в game-data.js');
  if (!i18nEnObjBlock || !i18nRuObjBlock) throw new Error('Не найден блок objectives в game-i18n.js (en/ru)');
  speakers = evalBlock(spkBlock.source);
  dialogues = evalBlock(dlgBlock.source);
  objectives = evalBlock(objBlock.source);
  const enText = evalBlock(i18nEnObjBlock.source);
  const ruText = evalBlock(i18nRuObjBlock.source);

  // normalize: every objective always has kind + dialogueIds, and every
  // objective id (from either the data array or either language table) has
  // an objectiveText entry — callers never need `|| {}` guards after this.
  objectives.forEach((o) => {
    if (!o.kind) o.kind = 'main';
    if (!o.dialogueIds) o.dialogueIds = [];
  });
  objectiveText = {};
  const allIds = new Set([...objectives.map((o) => o.id), ...Object.keys(enText), ...Object.keys(ruText)]);
  allIds.forEach((id) => {
    objectiveText[id] = {
      name: { en: (enText[id] && enText[id].name) || '', ru: (ruText[id] && ruText[id].name) || '' },
      desc: { en: (enText[id] && enText[id].desc) || '', ru: (ruText[id] && ruText[id].desc) || '' },
    };
  });

  dirty = false;
  selectedDialogueId = dialogues.length ? dialogues[0].id : null;
  undoStack.length = 0;
}

function objectiveTextForLang(lang) {
  const out = {};
  for (const id in objectiveText) {
    const t = objectiveText[id];
    if (t.name[lang] || t.desc[lang]) out[id] = { name: t.name[lang] || '', desc: t.desc[lang] || '' };
  }
  return out;
}

function saveAll() {
  // dialogues block sits after speakers block in the file — splice the
  // later one first so the earlier block's recorded offsets stay valid.
  let newStorySrc = storySrc.slice(0, dlgBlock.blockStart) + serialize(dialogues, '') + storySrc.slice(dlgBlock.blockEnd);
  newStorySrc = newStorySrc.slice(0, spkBlock.blockStart) + serialize(speakers, '') + newStorySrc.slice(spkBlock.blockEnd);
  const newDataSrc = dataSrc.slice(0, objBlock.blockStart) + serialize(objectives, '') + dataSrc.slice(objBlock.blockEnd);
  // ru.objectives sits after en.objectives in the file — same later-first rule.
  let newI18nSrc = i18nSrc.slice(0, i18nRuObjBlock.blockStart) + serialize(objectiveTextForLang('ru'), '') + i18nSrc.slice(i18nRuObjBlock.blockEnd);
  newI18nSrc = newI18nSrc.slice(0, i18nEnObjBlock.blockStart) + serialize(objectiveTextForLang('en'), '') + newI18nSrc.slice(i18nEnObjBlock.blockEnd);

  backupFile(STORY_PATH, BACKUP_DIR);
  backupFile(DATA_PATH, BACKUP_DIR);
  backupFile(I18N_PATH, BACKUP_DIR);
  fs.writeFileSync(STORY_PATH, newStorySrc, 'utf8');
  fs.writeFileSync(DATA_PATH, newDataSrc, 'utf8');
  fs.writeFileSync(I18N_PATH, newI18nSrc, 'utf8');

  try {
    let html = fs.readFileSync(INDEX_PATH, 'utf8');
    html = bumpVersion(html, 'game-story.js');
    html = bumpVersion(html, 'game-data.js');
    html = bumpVersion(html, 'game-i18n.js');
    fs.writeFileSync(INDEX_PATH, html, 'utf8');
  } catch (e) { /* non-fatal — version bump is a cache-buster nicety */ }

  loadAll(); // re-parse from disk so in-memory state matches saved text exactly
}

/* ------------------------------------------------------------------ */
/* undo — snapshot-based, keeps functions (triggers) by reference       */
/* ------------------------------------------------------------------ */

const undoStack = [];
const MAX_UNDO = 60;

function snapshotForUndo() {
  undoStack.push({ dialogues: cloneData(dialogues), speakers: cloneData(speakers), objectives: cloneData(objectives), objectiveText: cloneData(objectiveText) });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoButton();
}
function undo() {
  if (!undoStack.length) return;
  const snap = undoStack.pop();
  dialogues = snap.dialogues; speakers = snap.speakers; objectives = snap.objectives; objectiveText = snap.objectiveText;
  if (!dialogues.some((d) => d.id === selectedDialogueId)) selectedDialogueId = dialogues.length ? dialogues[0].id : null;
  dirty = true;
  renderAll();
}
function updateUndoButton() {
  const b = document.getElementById('undo-btn');
  if (b) b.disabled = undoStack.length === 0;
}
UNDO_HOOK = snapshotForUndo;

const TRIGGER_TEMPLATES = [
  { label: '— вставить заготовку —', code: '' },
  { label: 'Сол колонии ≥ N', code: '(s) => sol(s) >= 10' },
  { label: 'Население ≥ N', code: '(s) => pop(s) >= 50' },
  { label: 'Построено зданий ≥ N', code: '(s) => built(s) >= 10' },
  { label: 'Открыто технологий ≥ N', code: '(s) => techN(s) >= 5' },
  { label: 'Нехватка еды', code: '(s) => foodLow(s)' },
  { label: 'Нехватка воды', code: '(s) => waterLow(s)' },
  { label: 'Сол ≥ N И построек ≥ M (сочетание)', code: '(s) => sol(s) >= 10 && built(s) >= 8' },
  { label: 'Установлен флаг сюжета (замените FLAG_NAME)', code: '(s, flags) => !!flags.FLAG_NAME' },
  { label: 'Отношения с фракцией ≥ N (замените id)', code: "(s) => (s.diploRelations && s.diploRelations.azure || 0) >= 70" },
  { label: 'Всегда (для проверки)', code: '(s) => true' },
  { label: 'Никогда (заготовка, выключено)', code: '(s) => false' },
];

function markDirty() { dirty = true; renderStatus(); renderValidation(); }

/* ------------------------------------------------------------------ */
/* status / tabs                                                        */
/* ------------------------------------------------------------------ */

function renderStatus() {
  const s = document.getElementById('status');
  s.textContent = dirty ? 'Есть несохранённые изменения' : 'Сохранено';
  s.className = dirty ? 'status dirty' : 'status clean';
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === activeTab);
  });
  document.getElementById('tab-dialogues').hidden = activeTab !== 'dialogues';
  document.getElementById('tab-speakers').hidden = activeTab !== 'speakers';
  document.getElementById('tab-objectives').hidden = activeTab !== 'objectives';
  document.getElementById('tab-flags').hidden = activeTab !== 'flags';
}

/* ------------------------------------------------------------------ */
/* validation — runs after every change, blocks Save on real errors     */
/* ------------------------------------------------------------------ */

function validateAll() {
  const errors = [];
  const warnings = [];
  const dlgIds = new Set();
  dialogues.forEach((d) => {
    if (dlgIds.has(d.id)) errors.push({ msg: 'Повторяющийся ID диалога: "' + d.id + '"', dlg: d.id });
    dlgIds.add(d.id);
    const keys = nodeKeys(d);
    if (!d.nodes[d.start]) { errors.push({ msg: 'Диалог "' + d.id + '": стартовый узел "' + d.start + '" не существует', dlg: d.id }); return; }
    const reachable = new Set();
    const stack = [d.start];
    while (stack.length) {
      const k = stack.pop();
      if (reachable.has(k)) continue;
      reachable.add(k);
      const n = d.nodes[k];
      if (!n) continue;
      if (n.next) stack.push(n.next);
      if (n.choices) n.choices.forEach((c) => { if (c.goto) stack.push(c.goto); });
    }
    keys.forEach((k) => {
      const n = d.nodes[k];
      if (n.next && !d.nodes[n.next]) errors.push({ msg: 'Диалог "' + d.id + '", узел "' + k + '": переход на несуществующий узел "' + n.next + '"', dlg: d.id });
      if (n.choices) n.choices.forEach((c, i) => {
        if (c.goto && !d.nodes[c.goto]) errors.push({ msg: 'Диалог "' + d.id + '", узел "' + k + '", вариант ' + (i + 1) + ': переход на несуществующий узел "' + c.goto + '"', dlg: d.id });
      });
      if (n.speaker && !speakers[n.speaker]) warnings.push({ msg: 'Диалог "' + d.id + '", узел "' + k + '": неизвестный спикер "' + n.speaker + '"', dlg: d.id });
      if (!reachable.has(k)) warnings.push({ msg: 'Диалог "' + d.id + '", узел "' + k + '": недостижим от стартового узла', dlg: d.id });
    });
  });
  const objIds = new Set();
  objectives.forEach((o) => {
    if (objIds.has(o.id)) errors.push({ msg: 'Повторяющийся ID задания: "' + o.id + '"' });
    objIds.add(o.id);
    (o.dialogueIds || []).forEach((did) => {
      if (!dialogues.some((d) => d.id === did)) warnings.push({ msg: 'Задание "' + o.id + '": привязанный диалог "' + did + '" не найден' });
    });
  });
  const badFields = document.querySelectorAll('.bad').length;
  if (badFields > 0) errors.push({ msg: 'Есть поля с ошибками JSON/JS (подсвечены красным) — ' + badFields + ' шт.' });
  return { errors, warnings };
}

function renderValidation() {
  const bar = document.getElementById('validation-bar');
  if (!bar) return;
  const { errors, warnings } = validateAll();
  bar.innerHTML = '';
  if (!errors.length && !warnings.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const mk = (item, cls) => {
    const row = el('div', { class: 'val-row ' + cls });
    row.appendChild(el('span', { text: item.msg }));
    if (item.dlg) {
      const jump = el('button', { class: 'val-jump', text: 'Перейти →' });
      jump.addEventListener('click', () => { activeTab = 'dialogues'; selectedDialogueId = item.dlg; renderAll(); });
      row.appendChild(jump);
    }
    return row;
  };
  errors.forEach((e) => bar.appendChild(mk(e, 'val-error')));
  warnings.forEach((w) => bar.appendChild(mk(w, 'val-warning')));
}

/* ------------------------------------------------------------------ */
/* dialogue preview / simulator                                         */
/* ------------------------------------------------------------------ */

function effectHintLocal(effects) {
  if (!effects) return '';
  const p = [];
  if (effects.cr) p.push((effects.cr > 0 ? '+' : '') + effects.cr + ' CR');
  if (effects.res) for (const k in effects.res) p.push((effects.res[k] > 0 ? '+' : '') + effects.res[k] + ' ' + k);
  if (effects.relation) for (const id in effects.relation) p.push((effects.relation[id] > 0 ? '+' : '') + effects.relation[id] + ' ' + id);
  if (effects.flag) for (const k in effects.flag) p.push('флаг ' + k + '=' + JSON.stringify(effects.flag[k]));
  if (effects.sectorGrant) p.push('сектор ' + effects.sectorGrant);
  return p.join('  ·  ');
}

function openPreview(d) {
  let curKey = d.start;
  let lang = 'ru';
  const body = el('div', { class: 'preview-body' });
  const closeBtn = el('button', { class: 'icon-btn', text: '×', title: 'Закрыть' });
  const box = el('div', { class: 'preview-wrap' }, [
    el('div', { class: 'modal-title preview-title' }, [document.createTextNode('Предпросмотр: ' + d.id), closeBtn]),
    body,
  ]);
  const close = showModal(box, { wide: true });
  closeBtn.addEventListener('click', close);

  function renderStep() {
    body.innerHTML = '';
    const n = d.nodes[curKey];
    if (!n) { body.appendChild(el('div', { text: 'Узел "' + curKey + '" не найден.' })); return; }
    const spk = speakers[n.speaker] || { name: { ru: n.speaker, en: n.speaker }, color: '#8090a0', glyph: '??' };
    const langBtn = el('button', { class: 'btn small ghost', text: lang === 'ru' ? 'EN' : 'RU' });
    langBtn.addEventListener('click', () => { lang = lang === 'ru' ? 'en' : 'ru'; renderStep(); });
    body.appendChild(el('div', { class: 'preview-speaker' }, [
      el('span', { class: 'preview-glyph', text: spk.glyph, style: 'background:' + spk.color }),
      el('span', { class: 'preview-speaker-name', text: (spk.name && spk.name[lang]) || n.speaker }),
      langBtn,
    ]));
    body.appendChild(el('div', { class: 'preview-text', text: (n.text && n.text[lang]) || '(пусто)' }));

    const choices = n.choices || (n.end ? [{ __end: true, text: { ru: 'Закрыть', en: 'Close' } }] : [{ goto: n.next, text: { ru: 'Далее', en: 'Continue' } }]);
    choices.forEach((c) => {
      const btn = el('button', { class: 'btn small preview-choice', text: (c.text && c.text[lang]) || '...' });
      const hintTxt = effectHintLocal(c.effects);
      const reqTxt = c.requireFlag && Object.keys(c.requireFlag).length ? 'условие: ' + JSON.stringify(c.requireFlag) : '';
      btn.addEventListener('click', () => {
        if (c.__end || (!c.goto && !n.next)) { close(); return; }
        curKey = c.goto || n.next;
        renderStep();
      });
      const row = el('div', { class: 'preview-choice-row' }, [btn]);
      if (hintTxt) row.appendChild(el('span', { class: 'preview-hint', text: hintTxt }));
      if (reqTxt) row.appendChild(el('span', { class: 'preview-hint preview-req', text: reqTxt }));
      body.appendChild(row);
    });

    const restartBtn = el('button', { class: 'btn small ghost preview-restart', text: '⟲ Начать сначала' });
    restartBtn.addEventListener('click', () => { curKey = d.start; renderStep(); });
    body.appendChild(restartBtn);
  }
  renderStep();
}

/* ------------------------------------------------------------------ */
/* dialogues tab                                                        */
/* ------------------------------------------------------------------ */

function nodeKeys(d) { return Object.keys(d.nodes || {}); }

function renameNodeKey(d, oldKey, newKey) {
  if (!newKey || newKey === oldKey || d.nodes[newKey]) return false;
  const newNodes = {};
  for (const k in d.nodes) newNodes[k === oldKey ? newKey : k] = d.nodes[k];
  d.nodes = newNodes;
  if (d.start === oldKey) d.start = newKey;
  for (const k in d.nodes) {
    const n = d.nodes[k];
    if (n.next === oldKey) n.next = newKey;
    if (n.choices) n.choices.forEach((c) => { if (c.goto === oldKey) c.goto = newKey; });
  }
  return true;
}

function newDialogueSkeleton(id) {
  return { id, once: true, priority: 10, trigger: new Function('return (s) => false')(), start: 'a', nodes: { a: { speaker: Object.keys(speakers)[0] || 'admin', text: { ru: '', en: '' }, end: true } } };
}
function newNodeSkeleton() { return { speaker: Object.keys(speakers)[0] || 'admin', text: { ru: '', en: '' }, end: true }; }
function newChoiceSkeleton() { return { text: { ru: '', en: '' }, effects: {}, goto: null }; }

// A dialogue's category comes from what links to it, not from its own data
// (avoids a separate field that could drift out of sync): linked to a
// 'main' objective → сюжетный; linked only to 'side' objectives → побочный;
// linked to none → отдельный (standalone, just its own trigger).
function dialogueCategory(d) {
  const linked = objectives.filter((o) => o.dialogueIds.includes(d.id));
  if (!linked.length) return 'standalone';
  return linked.some((o) => o.kind !== 'side') ? 'main' : 'side';
}

function renderDialogueItem(d) {
  const item = el('div', { class: 'dlg-item' + (d.id === selectedDialogueId ? ' active' : '') });
  item.appendChild(el('div', { class: 'dlg-item-id', text: d.id }));
  item.appendChild(el('div', { class: 'dlg-item-meta', text: 'приоритет ' + (d.priority || 0) + (d.once ? ' · once' : '') }));
  item.addEventListener('click', () => { selectedDialogueId = d.id; renderDialoguesTab(); });
  const dup = el('button', { class: 'icon-btn dup', text: '⧉', title: 'Дублировать диалог' });
  dup.addEventListener('click', (e) => {
    e.stopPropagation();
    promptModal('ID копии диалога:', d.id + '_copy', (newId) => {
      if (dialogues.some((x) => x.id === newId)) { infoModal('Такой ID уже есть: "' + newId + '".'); return; }
      snapshotForUndo();
      const copy = cloneData(d); copy.id = newId;
      dialogues.push(copy);
      selectedDialogueId = newId;
      markDirty(); renderDialoguesTab();
    });
  });
  const del = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить диалог' });
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmModal('Удалить диалог "' + d.id + '"?', () => {
      snapshotForUndo();
      dialogues = dialogues.filter((x) => x !== d);
      if (selectedDialogueId === d.id) selectedDialogueId = dialogues.length ? dialogues[0].id : null;
      markDirty(); renderDialoguesTab(); renderObjectivesTab();
    });
  });
  item.appendChild(dup);
  item.appendChild(del);
  return item;
}

function renderDialoguesTab() {
  const root = document.getElementById('tab-dialogues');
  root.innerHTML = '';
  const groups = { main: [], side: [], standalone: [] };
  dialogues.forEach((d) => groups[dialogueCategory(d)].push(d));
  const list = el('div', { class: 'dlg-list' });
  [['main', 'Сюжетные'], ['side', 'Побочные'], ['standalone', 'Отдельные']].forEach(([key, label]) => {
    if (!groups[key].length) return;
    list.appendChild(el('div', { class: 'dlg-group-label', text: label }));
    groups[key].forEach((d) => list.appendChild(renderDialogueItem(d)));
  });
  const addBtn = el('button', { class: 'btn', text: '+ Новый диалог' });
  addBtn.addEventListener('click', () => {
    promptModal('ID нового диалога (латиницей, без пробелов):', 'new_dialogue', (id) => {
      if (dialogues.some((x) => x.id === id)) { infoModal('Такой ID уже есть: "' + id + '".'); return; }
      snapshotForUndo();
      dialogues.push(newDialogueSkeleton(id));
      selectedDialogueId = id;
      markDirty(); renderDialoguesTab();
    });
  });
  const sidebar = el('div', { class: 'sidebar' }, [addBtn, list]);

  const detail = el('div', { class: 'detail' });
  const d = dialogues.find((x) => x.id === selectedDialogueId);
  if (d) detail.appendChild(renderDialogueForm(d));
  else detail.appendChild(el('div', { class: 'empty-hint', text: 'Нет диалогов — создайте новый слева.' }));

  root.appendChild(sidebar);
  root.appendChild(detail);
}

function renderDialogueForm(d) {
  const wrap = el('div', { class: 'dlg-form' });

  const idInput = textInput(d.id, (v) => {
    v = v.trim();
    if (!v || (v !== d.id && dialogues.some((x) => x.id === v))) return;
    const oldId = d.id;
    d.id = v; selectedDialogueId = v;
    objectives.forEach((o) => { o.dialogueIds = o.dialogueIds.map((x) => (x === oldId ? v : x)); });
    markDirty();
  });
  const onceCb = checkbox(d.once, (c) => { d.once = c; markDirty(); });
  const prioInput = numInput(d.priority || 0, (v) => { d.priority = v; markDirty(); });

  const previewBtn = el('button', { class: 'btn small ghost', text: '▶ Предпросмотр диалога' });
  previewBtn.addEventListener('click', () => openPreview(d));

  const toolbar = el('div', { class: 'dlg-form-toolbar' }, [previewBtn]);
  const linkedObjs = objectives.filter((o) => o.dialogueIds.includes(d.id));
  if (linkedObjs.length) {
    toolbar.appendChild(el('span', { class: 'linked-obj-label', text: 'Привязано к заданию:' }));
    linkedObjs.forEach((o) => {
      const b = el('button', { class: 'flag-ref-btn', text: o.id + (o.kind === 'side' ? ' (побочное)' : ' (основное)') });
      b.addEventListener('click', () => { activeTab = 'objectives'; renderAll(); });
      toolbar.appendChild(b);
    });
  } else {
    toolbar.appendChild(el('span', { class: 'linked-obj-label', text: 'Отдельный диалог (не привязан к заданию)' }));
  }

  const header = el('div', { class: 'grid3' }, [
    field('ID', idInput),
    field('Приоритет', prioInput),
    field('Разовый (once)', onceCb),
  ]);

  let fnBody = '(s) => false';
  try { fnBody = d.trigger.toString(); } catch (e) {}
  const triggerInput = textArea(fnBody, (v) => {
    try {
      const fn = new Function('return (' + v + ')')();
      if (typeof fn !== 'function') throw new Error('not a function');
      d.trigger = fn; triggerInput.classList.remove('bad'); markDirty();
    } catch (e) { triggerInput.classList.add('bad'); markDirty(); }
  }, 2, true);
  const templateSelect = select(TRIGGER_TEMPLATES.map((t, i) => ({ value: String(i), label: t.label })), '0', (v) => {
    const code = TRIGGER_TEMPLATES[Number(v)].code;
    if (code) { triggerInput.value = code; triggerInput.dispatchEvent(new Event('input')); }
    templateSelect.value = '0';
  });
  templateSelect.classList.add('template-select');
  const templateRow = el('div', { class: 'template-row' }, [el('span', { class: 'field-label', text: 'Заготовка:' }), templateSelect]);
  const triggerField = field('Условие показа — JS-функция, s = состояние игры. Например: (s) => sol(s) >= 13 && built(s) >= 7', el('div', {}, [templateRow, triggerInput]));

  const startSelect = select(nodeKeys(d).map((k) => ({ value: k, label: k })), d.start, (v) => { d.start = v; markDirty(); });
  const startField = field('Стартовый узел', startSelect);

  wrap.appendChild(toolbar);
  wrap.appendChild(header);
  wrap.appendChild(triggerField);
  wrap.appendChild(startField);
  wrap.appendChild(el('hr'));

  const nodesWrap = el('div', { class: 'nodes-wrap' });
  nodeKeys(d).forEach((key) => nodesWrap.appendChild(renderNodeForm(d, key)));
  const addNodeBtn = el('button', { class: 'btn', text: '+ Узел' });
  addNodeBtn.addEventListener('click', () => {
    promptModal('Ключ нового узла:', 'node' + (nodeKeys(d).length + 1), (key) => {
      if (d.nodes[key]) { infoModal('Такой ключ уже есть: "' + key + '".'); return; }
      snapshotForUndo();
      d.nodes[key] = newNodeSkeleton();
      markDirty(); renderDialoguesTab();
    });
  });
  wrap.appendChild(el('div', { class: 'section-title', text: 'Узлы диалога' }));
  wrap.appendChild(nodesWrap);
  wrap.appendChild(addNodeBtn);
  return wrap;
}

function renderNodeForm(d, key) {
  const n = d.nodes[key];
  const box = el('div', { class: 'node-box' });

  const keyInput = textInputCommit(key, (v) => {
    if (renameNodeKey(d, key, v)) { markDirty(); renderDialoguesTab(); }
  });
  const speakerSelect = select(Object.keys(speakers).map((id) => ({ value: id, label: speakers[id].name.ru + ' (' + id + ')' })), n.speaker, (v) => { n.speaker = v; markDirty(); });
  const dupNodeBtn = el('button', { class: 'icon-btn', text: '⧉', title: 'Дублировать узел' });
  dupNodeBtn.addEventListener('click', () => {
    promptModal('Ключ копии узла:', key + '_copy', (newKey) => {
      if (d.nodes[newKey]) { infoModal('Такой ключ уже есть: "' + newKey + '".'); return; }
      snapshotForUndo();
      d.nodes[newKey] = cloneData(n);
      markDirty(); renderDialoguesTab();
    });
  });
  const delNodeBtn = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить узел' });
  delNodeBtn.addEventListener('click', () => {
    if (Object.keys(d.nodes).length <= 1) { infoModal('Нельзя удалить последний узел диалога.'); return; }
    confirmModal('Удалить узел "' + key + '"?', () => {
      snapshotForUndo();
      delete d.nodes[key];
      if (d.start === key) d.start = Object.keys(d.nodes)[0];
      markDirty(); renderDialoguesTab();
    });
  });

  box.appendChild(el('div', { class: 'node-head' }, [
    el('span', { class: 'node-key-label', text: 'Узел:' }),
    keyInput,
    speakerSelect,
    dupNodeBtn,
    delNodeBtn,
  ]));

  const textRu = textArea(n.text && n.text.ru, (v) => { n.text = n.text || {}; n.text.ru = v; markDirty(); }, 3);
  const textEn = textArea(n.text && n.text.en, (v) => { n.text = n.text || {}; n.text.en = v; markDirty(); }, 3);
  box.appendChild(el('div', { class: 'grid2' }, [field('Текст RU', textRu), field('Текст EN', textEn)]));

  const kind = n.choices ? 'choices' : (n.end ? 'end' : 'next');
  const kindRow = el('div', { class: 'kind-row' });
  [['next', 'Далее →'], ['end', 'Конец'], ['choices', 'Выбор игрока']].forEach(([val, label]) => {
    const r = el('input', { type: 'radio', name: 'kind-' + key });
    r.checked = kind === val;
    r.addEventListener('change', () => {
      delete n.next; delete n.end; delete n.choices;
      if (val === 'end') n.end = true;
      else if (val === 'next') n.next = nodeKeys(d).find((k) => k !== key) || key;
      else n.choices = [newChoiceSkeleton()];
      markDirty(); renderDialoguesTab();
    });
    const lbl = el('label', { class: 'radio-lbl' }, [r, document.createTextNode(label)]);
    kindRow.appendChild(lbl);
  });
  box.appendChild(kindRow);

  if (kind === 'next') {
    const opts = nodeKeys(d).filter((k) => k !== key).map((k) => ({ value: k, label: k }));
    box.appendChild(field('Переход к узлу', select(opts, n.next, (v) => { n.next = v; markDirty(); })));
  } else if (kind === 'choices') {
    const choicesWrap = el('div', { class: 'choices-wrap' });
    n.choices.forEach((c, i) => choicesWrap.appendChild(renderChoiceForm(d, n, c, i)));
    const addChoiceBtn = el('button', { class: 'btn small', text: '+ Вариант ответа' });
    addChoiceBtn.addEventListener('click', () => { snapshotForUndo(); n.choices.push(newChoiceSkeleton()); markDirty(); renderDialoguesTab(); });
    box.appendChild(choicesWrap);
    box.appendChild(addChoiceBtn);
  }
  return box;
}

function renderChoiceForm(d, n, c, i) {
  const box = el('div', { class: 'choice-box' });
  const delBtn = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить вариант' });
  delBtn.addEventListener('click', () => {
    snapshotForUndo();
    n.choices.splice(i, 1);
    if (!n.choices.length) n.choices.push(newChoiceSkeleton());
    markDirty(); renderDialoguesTab();
  });
  box.appendChild(el('div', { class: 'choice-head' }, [el('span', { text: 'Вариант ' + (i + 1) }), delBtn]));

  const textRu = textInput(c.text && c.text.ru, (v) => { c.text = c.text || {}; c.text.ru = v; markDirty(); });
  const textEn = textInput(c.text && c.text.en, (v) => { c.text = c.text || {}; c.text.en = v; markDirty(); });
  box.appendChild(el('div', { class: 'grid2' }, [field('Текст RU', textRu), field('Текст EN', textEn)]));

  const gotoOpts = [{ value: '', label: '— конец диалога —' }].concat(nodeKeys(d).map((k) => ({ value: k, label: k })));
  const gotoSel = select(gotoOpts, c.goto || '', (v) => { c.goto = v || null; markDirty(); });
  box.appendChild(field('Ведёт к узлу', gotoSel));

  box.appendChild(field('Эффекты (JSON: cr, res, relation, flag, sectorGrant)', jsonField(c.effects || {}, (v) => { c.effects = v; markDirty(); }, 2)));
  box.appendChild(field('Требуемый флаг для показа (JSON, необязательно)', jsonField(c.requireFlag || {}, (v) => { c.requireFlag = Object.keys(v).length ? v : undefined; markDirty(); }, 1)));
  return box;
}

/* ------------------------------------------------------------------ */
/* speakers tab                                                         */
/* ------------------------------------------------------------------ */

function newSpeakerSkeleton() { return { glyph: '??', color: '#8090a0', name: { ru: '', en: '' }, role: { ru: '', en: '' } }; }

function speakerUsageCount(id) {
  let n = 0;
  dialogues.forEach((d) => { for (const k in d.nodes) if (d.nodes[k].speaker === id) n++; });
  return n;
}

function renameSpeakerId(oldId, newId) {
  if (!newId || newId === oldId || speakers[newId]) return false;
  const ordered = {};
  for (const k in speakers) ordered[k === oldId ? newId : k] = speakers[k];
  speakers = ordered;
  dialogues.forEach((d) => { for (const k in d.nodes) if (d.nodes[k].speaker === oldId) d.nodes[k].speaker = newId; });
  return true;
}

function renderSpeakersTab() {
  const root = document.getElementById('tab-speakers');
  root.innerHTML = '';
  const grid = el('div', { class: 'speaker-grid' });
  Object.keys(speakers).forEach((id) => grid.appendChild(renderSpeakerCard(id)));
  const addBtn = el('button', { class: 'btn', text: '+ Новый спикер' });
  addBtn.addEventListener('click', () => {
    promptModal('ID нового спикера (латиницей):', 'new_speaker', (id) => {
      if (speakers[id]) { infoModal('Такой ID уже есть: "' + id + '".'); return; }
      snapshotForUndo();
      speakers[id] = newSpeakerSkeleton();
      markDirty(); renderSpeakersTab();
    });
  });
  root.appendChild(el('div', { class: 'section-title', text: 'Спикеры диалогов' }));
  root.appendChild(grid);
  root.appendChild(addBtn);
}

function renderSpeakerCard(id) {
  const s = speakers[id];
  const card = el('div', { class: 'speaker-card' });
  const idInput = textInputCommit(id, (v) => {
    if (renameSpeakerId(id, v)) { markDirty(); renderSpeakersTab(); }
  });
  const usage = speakerUsageCount(id);
  const delBtn = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить спикера' });
  delBtn.addEventListener('click', () => {
    const doDelete = () => { snapshotForUndo(); delete speakers[id]; markDirty(); renderSpeakersTab(); };
    if (usage > 0) confirmModal('Спикер используется в ' + usage + ' узлах диалогов. Всё равно удалить?', doDelete);
    else doDelete();
  });
  card.appendChild(el('div', { class: 'speaker-head' }, [idInput, delBtn]));
  card.appendChild(el('div', { class: 'speaker-usage', text: usage ? ('используется в ' + usage + ' узлах') : 'не используется' }));

  const glyphInput = textInput(s.glyph, (v) => { s.glyph = v; markDirty(); });
  const colorInput = el('input', { type: 'color' });
  colorInput.value = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#8090a0';
  colorInput.addEventListener('input', () => { s.color = colorInput.value; markDirty(); });

  card.appendChild(el('div', { class: 'grid2' }, [field('Значок (2 символа)', glyphInput), field('Цвет', colorInput)]));
  card.appendChild(el('div', { class: 'grid2' }, [
    field('Имя RU', textInput(s.name && s.name.ru, (v) => { s.name = s.name || {}; s.name.ru = v; markDirty(); })),
    field('Имя EN', textInput(s.name && s.name.en, (v) => { s.name = s.name || {}; s.name.en = v; markDirty(); })),
  ]));
  card.appendChild(el('div', { class: 'grid2' }, [
    field('Роль RU', textInput(s.role && s.role.ru, (v) => { s.role = s.role || {}; s.role.ru = v; markDirty(); })),
    field('Роль EN', textInput(s.role && s.role.en, (v) => { s.role = s.role || {}; s.role.en = v; markDirty(); })),
  ]));
  return card;
}

/* ------------------------------------------------------------------ */
/* objectives tab                                                       */
/* ------------------------------------------------------------------ */

const OBJECTIVE_TYPES = ['pop', 'housing', 'buildings', 'tech', 'sols', 'trade', 'crnet', 'research', 'outposts', 'sectors'];

function newObjectiveSkeleton() {
  let n = objectives.length + 1;
  while (objectives.some((o) => o.id === 'o' + n)) n++;
  return { id: 'o' + n, type: 'pop', target: 100, kind: 'side', reward: { cr: 1000 }, dialogueIds: [] };
}

function renderObjectivesTab() {
  const root = document.getElementById('tab-objectives');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'section-title', text: 'Задания колонии — основные (сюжетные) и побочные. Порядок важен (проходятся по списку); прогресс по «Цели» считает Economy.objectiveValue.' }));
  const list = el('div', { class: 'obj-list' });
  objectives.forEach((o, i) => list.appendChild(renderObjectiveCard(o, i)));
  root.appendChild(list);
  const addBtn = el('button', { class: 'btn', text: '+ Новое задание' });
  addBtn.addEventListener('click', () => {
    snapshotForUndo();
    const o = newObjectiveSkeleton();
    objectives.push(o);
    objectiveText[o.id] = { name: { ru: '', en: '' }, desc: { ru: '', en: '' } };
    markDirty(); renderObjectivesTab();
  });
  root.appendChild(addBtn);
}

function renderObjectiveCard(o, i) {
  const card = el('div', { class: 'obj-card' });
  const txt = objectiveText[o.id] || (objectiveText[o.id] = { name: { ru: '', en: '' }, desc: { ru: '', en: '' } });

  const idInput = textInputCommit(o.id, (v) => {
    if (!v || (v !== o.id && objectives.some((x) => x.id === v))) return;
    const oldId = o.id;
    o.id = v;
    objectiveText[v] = objectiveText[oldId] || { name: { ru: '', en: '' }, desc: { ru: '', en: '' } };
    if (v !== oldId) delete objectiveText[oldId];
    markDirty(); renderObjectivesTab();
  });
  const typeSelect = select(OBJECTIVE_TYPES.map((t) => ({ value: t, label: t })), o.type, (v) => { o.type = v; markDirty(); });
  const targetInput = numInput(o.target, (v) => { o.target = v; markDirty(); });
  const kindSelect = select([{ value: 'main', label: 'Основное (сюжет)' }, { value: 'side', label: 'Побочное' }], o.kind, (v) => { o.kind = v; markDirty(); renderDialoguesTab(); });

  const moveWrap = el('div', { class: 'obj-move' });
  const upBtn = el('button', { class: 'icon-btn', text: '▲', title: 'Переместить выше' });
  upBtn.disabled = i === 0;
  upBtn.addEventListener('click', () => {
    if (i === 0) return;
    snapshotForUndo();
    [objectives[i - 1], objectives[i]] = [objectives[i], objectives[i - 1]];
    markDirty(); renderObjectivesTab();
  });
  const downBtn = el('button', { class: 'icon-btn', text: '▼', title: 'Переместить ниже' });
  downBtn.disabled = i === objectives.length - 1;
  downBtn.addEventListener('click', () => {
    if (i === objectives.length - 1) return;
    snapshotForUndo();
    [objectives[i + 1], objectives[i]] = [objectives[i], objectives[i + 1]];
    markDirty(); renderObjectivesTab();
  });
  moveWrap.appendChild(upBtn); moveWrap.appendChild(downBtn);

  const delBtn = el('button', { class: 'icon-btn danger', text: '×', title: 'Удалить задание' });
  delBtn.addEventListener('click', () => {
    confirmModal('Удалить задание "' + o.id + '"?', () => {
      snapshotForUndo();
      objectives.splice(i, 1);
      delete objectiveText[o.id];
      markDirty(); renderObjectivesTab();
    });
  });

  card.appendChild(el('div', { class: 'obj-card-head' }, [
    field('ID', idInput),
    field('Тип', typeSelect),
    field('Цель', targetInput),
    field('Категория', kindSelect),
    moveWrap,
    delBtn,
  ]));

  card.appendChild(el('div', { class: 'grid2' }, [
    field('Название RU', textInput(txt.name.ru, (v) => { txt.name.ru = v; markDirty(); })),
    field('Название EN', textInput(txt.name.en, (v) => { txt.name.en = v; markDirty(); })),
  ]));
  card.appendChild(el('div', { class: 'grid2' }, [
    field('Описание RU', textInput(txt.desc.ru, (v) => { txt.desc.ru = v; markDirty(); })),
    field('Описание EN', textInput(txt.desc.en, (v) => { txt.desc.en = v; markDirty(); })),
  ]));
  card.appendChild(field('Награда (JSON: cr, res)', jsonField(o.reward || {}, (v) => { o.reward = v; markDirty(); }, 1)));

  const chipsWrap = el('div', { class: 'obj-dlg-chips' });
  o.dialogueIds.forEach((did) => {
    const exists = dialogues.some((d) => d.id === did);
    const chip = el('div', { class: 'obj-dlg-chip' + (exists ? '' : ' bad') });
    const label = el('span', { text: did });
    if (exists) { label.style.cursor = 'pointer'; label.addEventListener('click', () => { activeTab = 'dialogues'; selectedDialogueId = did; renderAll(); }); }
    const rm = el('button', { class: 'chip-x', text: '×', title: 'Отвязать' });
    rm.addEventListener('click', () => {
      snapshotForUndo();
      o.dialogueIds = o.dialogueIds.filter((x) => x !== did);
      markDirty(); renderObjectivesTab(); renderDialoguesTab();
    });
    chip.appendChild(label); chip.appendChild(rm);
    chipsWrap.appendChild(chip);
  });
  if (!o.dialogueIds.length) chipsWrap.appendChild(el('span', { class: 'flag-empty', text: '— нет привязанных диалогов —' }));

  const addOpts = [{ value: '', label: '— добавить существующий —' }].concat(dialogues.filter((d) => !o.dialogueIds.includes(d.id)).map((d) => ({ value: d.id, label: d.id })));
  const addSelect = select(addOpts, '', (v) => {
    if (!v) return;
    snapshotForUndo();
    o.dialogueIds = o.dialogueIds.concat([v]);
    markDirty(); renderObjectivesTab(); renderDialoguesTab();
  });
  const createBtn = el('button', { class: 'btn small ghost', text: '+ Создать новый' });
  createBtn.addEventListener('click', () => {
    promptModal('ID нового диалога для задания "' + o.id + '":', o.id + '_dlg', (newId) => {
      if (dialogues.some((x) => x.id === newId)) { infoModal('Такой ID уже есть: "' + newId + '".'); return; }
      snapshotForUndo();
      dialogues.push(newDialogueSkeleton(newId));
      o.dialogueIds = o.dialogueIds.concat([newId]);
      activeTab = 'dialogues'; selectedDialogueId = newId;
      markDirty(); renderAll();
    });
  });
  card.appendChild(field('Привязанные диалоги', chipsWrap));
  card.appendChild(el('div', { class: 'obj-dlg-add-row' }, [addSelect, createBtn]));

  return card;
}

/* ------------------------------------------------------------------ */
/* flags tab — read-only cross-reference of story flags                 */
/* ------------------------------------------------------------------ */

function collectFlagRefs() {
  const map = {};
  function ensure(name) { if (!map[name]) map[name] = { sets: [], reads: [] }; return map[name]; }
  dialogues.forEach((d) => {
    let src = '';
    try { src = d.trigger.toString(); } catch (e) {}
    const re = /flags(?:\.(\w+)|\[['"](\w+)['"]\])/g;
    let m;
    while ((m = re.exec(src))) ensure(m[1] || m[2]).reads.push({ dlg: d.id, label: d.id + ' / условие показа' });
    for (const key in d.nodes) {
      const n = d.nodes[key];
      if (n.choices) n.choices.forEach((c, i) => {
        if (c.effects && c.effects.flag) for (const f in c.effects.flag) ensure(f).sets.push({ dlg: d.id, label: d.id + ' / ' + key + ' / вариант ' + (i + 1) + ' = ' + JSON.stringify(c.effects.flag[f]) });
        if (c.requireFlag) for (const f in c.requireFlag) ensure(f).reads.push({ dlg: d.id, label: d.id + ' / ' + key + ' / вариант ' + (i + 1) + ' (видимость)' });
      });
    }
  });
  return map;
}

function makeFlagRefBtn(ref) {
  const b = el('button', { class: 'flag-ref-btn', text: ref.label });
  b.addEventListener('click', () => { activeTab = 'dialogues'; selectedDialogueId = ref.dlg; renderAll(); });
  return b;
}

function renderFlagsTab() {
  const root = document.getElementById('tab-flags');
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'section-title', text: 'Флаги сюжета — где выставляются и где читаются (по всем диалогам)' }));
  const map = collectFlagRefs();
  const names = Object.keys(map).sort();
  if (!names.length) { root.appendChild(el('div', { class: 'empty-hint', text: 'Флаги не найдены — ни один эффект/условие ещё их не использует.' })); return; }
  names.forEach((name) => {
    const entry = map[name];
    const card = el('div', { class: 'flag-card' });
    const setOnly = entry.sets.length && !entry.reads.length;
    const readOnly = entry.reads.length && !entry.sets.length;
    card.appendChild(el('div', { class: 'flag-name' }, [
      document.createTextNode(name),
      (setOnly || readOnly) ? el('span', { class: 'flag-warn', text: setOnly ? 'нигде не читается' : 'нигде не выставляется' }) : null,
    ]));
    const setsRow = el('div', { class: 'flag-refs' }, [el('span', { class: 'flag-refs-label', text: 'Ставится:' })]);
    if (!entry.sets.length) setsRow.appendChild(el('span', { class: 'flag-empty', text: '— нигде —' }));
    entry.sets.forEach((s) => setsRow.appendChild(makeFlagRefBtn(s)));
    const readsRow = el('div', { class: 'flag-refs' }, [el('span', { class: 'flag-refs-label', text: 'Читается:' })]);
    if (!entry.reads.length) readsRow.appendChild(el('span', { class: 'flag-empty', text: '— нигде —' }));
    entry.reads.forEach((r) => readsRow.appendChild(makeFlagRefBtn(r)));
    card.appendChild(setsRow);
    card.appendChild(readsRow);
    root.appendChild(card);
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */

function renderAll() {
  renderTabs();
  renderDialoguesTab();
  renderSpeakersTab();
  renderObjectivesTab();
  renderFlagsTab();
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
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.tab; renderTabs(); }));
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
