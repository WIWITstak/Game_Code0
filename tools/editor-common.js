'use strict';
const fs = require('fs');
const path = require('path');

/* Shared code for the tools/editor-*.html suite — block extraction/
 * serialization, DOM/modal helpers, undo-arming. Loaded as a classic
 * <script> before each editor's own renderer script (same global-scope
 * convention as game.js loading game-data.js/game-economy.js). Each editor
 * keeps its own state shape, undo stack, validation and render logic —
 * only the generic, stateless plumbing lives here. */

/* ------------------------------------------------------------------ */
/* block extraction / serialization                                    */
/* ------------------------------------------------------------------ */

function scanBlockFrom(src, startIdx) {
  let i = startIdx;
  while (/\s/.test(src[i])) i++;
  const openChar = src[i];
  if (openChar !== '{' && openChar !== '[') return null;
  const closeChar = openChar === '{' ? '}' : ']';
  const blockStart = i;
  let depth = 0, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return { blockStart, blockEnd: i + 1, source: src.slice(blockStart, i + 1) };
    }
  }
  return null;
}

function findBlock(src, varName) {
  const re = new RegExp('(?:const|let|var)\\s+' + varName + '\\s*=\\s*');
  const m = re.exec(src);
  if (!m) return null;
  return scanBlockFrom(src, m.index + m[0].length);
}

// Finds the n-th occurrence of `keyName: {`/`keyName: [` as an object
// property (not a top-level const) — e.g. reaching into I18N's nested
// `en.objectives` (1st match) / `ru.objectives` (2nd match) without parsing
// the whole (huge) surrounding object. Only counts matches whose value is
// actually an object/array — a same-named key with a string/other value
// elsewhere in the file (e.g. a short nav-rail label `tech: 'Technology'`
// living alongside the real `tech: {...}` node table) is skipped rather
// than thrown off the count.
function findNthKeyBlock(src, keyName, n) {
  const re = new RegExp('\\b' + keyName + '\\s*:\\s*', 'g');
  let m, count = 0;
  while ((m = re.exec(src))) {
    const afterIdx = m.index + m[0].length;
    let i = afterIdx;
    while (/\s/.test(src[i])) i++;
    if (src[i] !== '{' && src[i] !== '[') continue;
    count++;
    if (count === n) return scanBlockFrom(src, afterIdx);
  }
  return null;
}

function evalBlock(src) { return (0, eval)('(' + src + ')'); }

function keyStr(k) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k); }

function serialize(v, ind) {
  if (typeof v === 'function') return v.toString();
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const inner = ind + '  ';
    return '[\n' + v.map((x) => inner + serialize(x, inner)).join(',\n') + '\n' + ind + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    const inner = ind + '  ';
    return '{\n' + keys.map((k) => inner + keyStr(k) + ': ' + serialize(v[k], inner)).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}

function cloneData(v) {
  if (typeof v === 'function' || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneData);
  const o = {};
  for (const k in v) o[k] = cloneData(v[k]);
  return o;
}

function bumpVersion(html, scriptName) {
  const re = new RegExp('(' + scriptName.replace('.', '\\.') + '\\?v=)(\\d+)');
  return html.replace(re, (m, pre, num) => pre + (parseInt(num, 10) + 1));
}

function backupFile(p, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(p, path.join(backupDir, path.basename(p) + '.' + stamp + '.bak'));
}

/* ------------------------------------------------------------------ */
/* undo-arming — each editor points UNDO_HOOK at its own snapshot fn     */
/* ------------------------------------------------------------------ */

// A script-driven `.focus()` can resolve asynchronously in Electron, so
// arming only on 'focus' can capture the snapshot AFTER a same-tick value
// change already landed; mousedown/keydown always fire synchronously with
// the interaction that's about to edit the field, so arm on whichever of
// the three fires first (guarded so it's still one snapshot per session).
let UNDO_HOOK = null;
function armUndo(elm) {
  const arm = () => { if (!elm._undoArmed) { if (UNDO_HOOK) UNDO_HOOK(); elm._undoArmed = true; } };
  elm.addEventListener('mousedown', arm);
  elm.addEventListener('keydown', arm);
  elm.addEventListener('focus', arm);
  elm.addEventListener('blur', () => { elm._undoArmed = false; });
}

/* ------------------------------------------------------------------ */
/* small DOM helpers                                                    */
/* ------------------------------------------------------------------ */

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => { if (c) e.appendChild(c); });
  if (tag === 'input' || tag === 'select' || tag === 'textarea') armUndo(e);
  return e;
}
function field(labelText, inputEl) {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: labelText }), inputEl]);
}
function textInput(value, onInput, opts) {
  const i = el('input', { type: 'text', class: (opts && opts.cls) || '' });
  i.value = value || '';
  i.addEventListener('input', () => onInput(i.value));
  return i;
}
// Commits on blur/Enter instead of every keystroke — for renames that
// trigger a full tab re-render (which would otherwise steal focus mid-type).
function textInputCommit(value, onCommit) {
  const i = el('input', { type: 'text' });
  i.value = value || '';
  const commit = () => onCommit(i.value.trim());
  i.addEventListener('blur', commit);
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
  return i;
}
function numInput(value, onInput) {
  const i = el('input', { type: 'number', class: 'num' });
  i.value = value == null ? '' : value;
  i.addEventListener('input', () => onInput(i.value === '' ? 0 : Number(i.value)));
  return i;
}
function textArea(value, onInput, rows, mono) {
  const t = el('textarea', { rows: String(rows || 2), class: mono ? 'mono' : '' });
  t.value = value || '';
  t.addEventListener('input', () => onInput(t.value));
  return t;
}
function checkbox(checked, onChange) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}
function select(options, value, onChange) {
  const s = el('select', {});
  options.forEach((o) => {
    const opt = el('option', { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
// onChange receives the parsed object; the CALLER decides whether/how to
// mark its document dirty (each editor tracks that differently).
function jsonField(value, onChange, rows, placeholder) {
  const t = textArea(value && Object.keys(value).length ? JSON.stringify(value) : '', (txt) => {
    if (txt.trim() === '') { onChange({}); t.classList.remove('bad'); return; }
    try { onChange(JSON.parse(txt)); t.classList.remove('bad'); }
    catch (e) { t.classList.add('bad'); }
  }, rows, true);
  t.placeholder = placeholder || '{"cr":1000}';
  return t;
}

/* Electron's renderer doesn't reliably show window.prompt() (it can silently
 * return without ever displaying a dialog), so every prompt/confirm/alert in
 * this tool suite is one of these in-page modals instead. Their inputs are
 * plain DOM nodes (not built via `el()`), deliberately opted out of
 * undo-arming since they're transient UI, not persistent document fields. */
function showModal(contentEl, opts) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box' + (opts && opts.wide ? ' wide' : '') }, [contentEl]);
  overlay.appendChild(box);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return close;
}
function promptModal(title, defaultValue, onOk) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue || '';
  const okBtn = el('button', { class: 'btn small', text: 'OK' });
  const cancelBtn = el('button', { class: 'btn small ghost', text: 'Отмена' });
  const box = el('div', {}, [
    el('div', { class: 'modal-title', text: title }),
    input,
    el('div', { class: 'modal-actions' }, [cancelBtn, okBtn]),
  ]);
  const close = showModal(box);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => { const v = input.value.trim(); close(); if (v) onOk(v); });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
function confirmModal(message, onOk) {
  const okBtn = el('button', { class: 'btn small danger-btn', text: 'Да' });
  const cancelBtn = el('button', { class: 'btn small ghost', text: 'Отмена' });
  const box = el('div', {}, [
    el('div', { class: 'modal-title', text: message }),
    el('div', { class: 'modal-actions' }, [cancelBtn, okBtn]),
  ]);
  const close = showModal(box);
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', () => { close(); onOk(); });
}
function infoModal(message) {
  const okBtn = el('button', { class: 'btn small', text: 'OK' });
  const box = el('div', {}, [
    el('div', { class: 'modal-title', text: message }),
    el('div', { class: 'modal-actions' }, [okBtn]),
  ]);
  const close = showModal(box);
  okBtn.addEventListener('click', close);
}
