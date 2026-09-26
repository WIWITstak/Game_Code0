// Runs inside a browser/Electron page (needs real DOMParser + SVG-aware HTML
// parsing). Transforms the legacy DC `<x-dc>` template string into standard
// HTML annotated with the data-* bindings that view.js understands.
//
//   {{ path }}              -> data-text / ${path} inside data-style|data-attr
//   onClick="{{ h }}"       -> data-on="click:h"
//   ref="{{ r }}"           -> data-ref="r"
//   <sc-for list as>        -> <template data-for="as in list">
//   <sc-if value>           -> <div data-if="value" hidden style="display:contents">
//
// Returns the transformed innerHTML string. Collects warnings on window.__warnings.
function __convert(src) {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var doc = new DOMParser().parseFromString(
    '<!doctype html><body><x-dc>' + src + '</x-dc></body>', 'text/html'
  );
  var xdc = doc.querySelector('x-dc');
  var warnings = [];

  function extract(v) {
    var m = String(v).trim().match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
    return m ? m[1].trim() : String(v).trim();
  }
  function toTemplate(v) {
    return String(v).replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, function (_, e) { return '${' + e.trim() + '}'; });
  }
  function hasMustache(v) { return /\{\{/.test(String(v)); }

  function processFragment(container) {
    var kids = [].slice.call(container.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3) { processText(k, container); continue; }
      if (k.nodeType !== 1) continue;
      var tag = k.tagName.toLowerCase();
      if (tag === 'helmet' || tag === 'sc-helmet') { k.remove(); continue; }
      if (tag === 'sc-for') { processScFor(k); continue; }
      if (tag === 'sc-if') { processScIf(k); continue; }
      processEl(k);
    }
  }

  function processText(node, parent) {
    var txt = node.textContent;
    if (!hasMustache(txt)) return;
    var inSvg = parent.namespaceURI === SVG_NS;
    var musts = txt.trim().match(/\{\{\s*[\s\S]+?\s*\}\}/g) || [];
    var single = musts.length === 1 && musts[0] === txt.trim()
      ? musts[0].match(/^\{\{\s*([\s\S]+?)\s*\}\}$/) : null;
    if (single && parent.childNodes.length === 1 && !inSvg) {
      parent.setAttribute('data-text', single[1].trim());
      node.remove();
      return;
    }
    if (inSvg) { warnings.push('mustache text inside <svg>: ' + txt.trim()); return; }
    var frag = doc.createDocumentFragment();
    var parts = txt.split(/(\{\{\s*[\s\S]+?\s*\}\})/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var m = p.match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
      if (m) {
        var s = doc.createElement('span');
        s.setAttribute('data-text', m[1].trim());
        frag.appendChild(s);
      } else {
        frag.appendChild(doc.createTextNode(p));
      }
    }
    node.replaceWith(frag);
  }

  function processEl(el) {
    var on = [], styleDyn = [], attrDyn = [];
    var attrs = [].slice.call(el.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, val = attrs[a].value, lower = name.toLowerCase();
      if (lower === 'ref') {
        el.removeAttribute(name);
        el.setAttribute('data-ref', extract(val));
      } else if (/^on[a-z]+$/i.test(name)) {
        el.removeAttribute(name);
        on.push(lower.slice(2) + ':' + extract(val));
      } else if (lower === 'style-hover') {
        el.removeAttribute(name);               // was inert at runtime anyway
      } else if (lower === 'class' && hasMustache(val)) {
        var whole = val.match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
        if (whole) {
          el.removeAttribute(name);
          el.setAttribute('data-class', whole[1].trim());
        } else {
          var dyn = val.match(/\{\{\s*([\s\S]+?)\s*\}\}/);
          el.setAttribute('class', val.replace(/\{\{[\s\S]+?\}\}/g, '').replace(/\s+/g, ' ').trim());
          el.setAttribute('data-class', dyn[1].trim());
        }
      } else if (lower === 'style' && hasMustache(val)) {
        var keep = [];
        val.split(';').forEach(function (decl) {
          if (!decl.trim()) return;
          var ci = decl.indexOf(':');
          if (ci === -1) { keep.push(decl.trim()); return; }
          var prop = decl.slice(0, ci).trim(), pv = decl.slice(ci + 1).trim();
          if (hasMustache(pv)) styleDyn.push(prop + ':' + toTemplate(pv));
          else keep.push(prop + ':' + pv);
        });
        if (keep.length) el.setAttribute('style', keep.join(';'));
        else el.removeAttribute('style');
      } else if (hasMustache(val)) {
        el.removeAttribute(name);
        attrDyn.push(name + ':' + toTemplate(val));
      }
    }
    if (on.length) el.setAttribute('data-on', on.join(';'));
    if (styleDyn.length) el.setAttribute('data-style', styleDyn.join(';'));
    if (attrDyn.length) el.setAttribute('data-attr', attrDyn.join(';'));

    if (el.tagName.toLowerCase() === 'template') processFragment(el.content);
    else processFragment(el);
  }

  function processScFor(sc) {
    var asName = sc.getAttribute('as') || 'item';
    var listExpr = extract(sc.getAttribute('list') || '');
    if (sc.namespaceURI === SVG_NS) {
      // <template> inside <svg> is parsed as a foreign (SVG) element with no
      // .content — use an <g> group (layout-neutral) as the repeat container.
      var g = doc.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-for', asName + ' in ' + listExpr);
      while (sc.firstChild) g.appendChild(sc.firstChild);
      processFragment(g);
      sc.replaceWith(g);
      return;
    }
    var tpl = doc.createElement('template');
    tpl.setAttribute('data-for', asName + ' in ' + listExpr);
    while (sc.firstChild) tpl.content.appendChild(sc.firstChild);
    processFragment(tpl.content);
    sc.replaceWith(tpl);
  }

  function processScIf(sc) {
    var cond = extract(sc.getAttribute('value') || 'false');
    var wrap = doc.createElement('div');
    wrap.setAttribute('data-if', cond);
    wrap.setAttribute('hidden', '');
    wrap.setAttribute('style', 'display:contents');
    while (sc.firstChild) wrap.appendChild(sc.firstChild);
    processFragment(wrap);
    sc.replaceWith(wrap);
  }

  processFragment(xdc);

  try { window.__warnings = warnings; } catch (e) { /* noop */ }
  return xdc.innerHTML;
}
