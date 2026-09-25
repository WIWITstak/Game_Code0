// Tiny standard-DOM view layer — replaces the DC runtime (support.js) + React.
//
// The UI markup in index.html is plain HTML annotated with data-* bindings:
//
//   data-text="path"                 element.textContent = value
//   data-attr="name:${p};n2:${p2}"   setAttribute / .disabled / remove-if-false
//   data-style="prop:${p} literal"   element.style.setProperty(prop, interpolated)
//   data-class="path"                append resolved string to the static class list
//   data-ref="path"                  resolve(path).current = element   (React-ref shim)
//   data-on="click:handler;..."      addEventListener, handler looked up per event
//   data-if="expr"                   toggle [hidden]; skip descendants while hidden
//   <template data-for="it in list"> clone content per list item, scope var `it`
//
// Expression language (same limited set the DC runtime used): dotted/indexed
// paths, === !== == != , leading ! , string/number/bool/null literals, parens.
// No arithmetic, no calls — all logic lives in game.js renderVals().
'use strict';

(function () {
  /* ------------------------------------------------------------------ */
  /* expression evaluation                                               */
  /* ------------------------------------------------------------------ */
  var IDENT = /^[A-Za-z_$][\w$]*/;
  var NUM = /^-?\d+(\.\d+)?$/;

  function resolvePath(scope, expr) {
    var m = expr.match(IDENT);
    if (!m) return undefined;
    var cur = scope == null ? undefined : scope[m[0]];
    var i = m[0].length;
    while (i < expr.length) {
      var c = expr[i];
      if (c === '.') {
        var mm = expr.slice(i + 1).match(IDENT) || expr.slice(i + 1).match(/^\d+/);
        if (!mm) return undefined;
        cur = cur == null ? undefined : cur[mm[0]];
        i += 1 + mm[0].length;
      } else if (c === '[') {
        var depth = 1, j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === '[') depth++;
          else if (expr[j] === ']') { depth--; if (!depth) break; }
          j++;
        }
        if (depth) return undefined;
        var key = resolve(scope, expr.slice(i + 1, j));
        cur = cur == null ? undefined : cur[key];
        i = j + 1;
      } else {
        return undefined;
      }
    }
    return cur;
  }

  function parensWrapWhole(e) {
    var depth = 0;
    for (var i = 0; i < e.length - 1; i++) {
      if (e[i] === '(') depth++;
      else if (e[i] === ')') { depth--; if (!depth) return false; }
    }
    return true;
  }

  function findEquality(e) {
    var depth = 0;
    for (var i = 0; i < e.length; i++) {
      var c = e[i];
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth--;
      else if (!depth && (c === '=' || c === '!') && e[i + 1] === '=') {
        if (i > 0 && (e[i - 1] === '=' || e[i - 1] === '!')) continue;
        if (!e.slice(0, i).trim()) continue;
        return { i: i, op: e[i + 2] === '=' ? c + '==' : c + '=' };
      }
    }
    return null;
  }

  function resolve(scope, src) {
    var e = String(src).trim();
    if (!e) return undefined;
    if (e[0] === '(' && e[e.length - 1] === ')' && parensWrapWhole(e)) return resolve(scope, e.slice(1, -1));
    var eq = findEquality(e);
    if (eq) {
      var l = resolve(scope, e.slice(0, eq.i));
      var r = resolve(scope, e.slice(eq.i + eq.op.length));
      return eq.op === '===' ? l === r : eq.op === '!==' ? l !== r : eq.op === '==' ? l == r : l != r; // eslint-disable-line eqeqeq
    }
    if (e[0] === '!') return !resolve(scope, e.slice(1));
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (e === 'null') return null;
    if (e === 'undefined') return undefined;
    if (NUM.test(e)) return Number(e);
    if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return e.slice(1, -1);
    return resolvePath(scope, e);
  }

  var INTERP = /\$\{([^}]+)\}/g;
  function interp(scope, str) {
    return str.replace(INTERP, function (_, p) {
      var v = resolve(scope, p.trim());
      return v == null ? '' : String(v);
    });
  }
  // If the whole template is a single ${expr}, return the raw value (keeps
  // booleans/numbers intact for data-attr); otherwise the interpolated string.
  function resolveMaybe(scope, str) {
    var m = str.match(/^\$\{([^}]+)\}$/);
    return m ? resolve(scope, m[1].trim()) : interp(scope, str);
  }

  // "a:${x};b:${y} px" -> [["a","${x}"],["b","${y} px"]]  (split ; then first :)
  function splitDecls(str) {
    var out = [];
    var parts = str.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.trim()) continue;
      var c = p.indexOf(':');
      if (c === -1) continue;
      out.push([p.slice(0, c).trim(), p.slice(c + 1).trim()]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* compilation: DOM subtree -> update(scope) function                  */
  /* ------------------------------------------------------------------ */

  // Compile every element child of `parent`. Returns an update fn, or null when
  // the whole subtree is static (nothing to do on render).
  function compileChildren(parent) {
    var steps = [];
    var nodes = [].slice.call(parent.childNodes);
    for (var k = 0; k < nodes.length; k++) {
      if (nodes[k].nodeType !== 1) continue;
      var s = compileEl(nodes[k]);
      if (s) steps.push(s);
    }
    if (!steps.length) return null;
    return function (scope) { for (var i = 0; i < steps.length; i++) steps[i](scope); };
  }

  function compileEl(el) {
    if (el.hasAttribute('data-for')) return compileFor(el);

    var local = [];
    var d;

    if ((d = el.getAttribute('data-ref')) != null) {
      el.removeAttribute('data-ref');
      (function (path) {
        local.push(function (sc) { var r = resolve(sc, path); if (r && typeof r === 'object') r.current = el; });
      })(d);
    }

    if ((d = el.getAttribute('data-text')) != null) {
      el.removeAttribute('data-text');
      (function (path) {
        var last;
        local.push(function (sc) {
          var v = resolve(sc, path); v = v == null ? '' : String(v);
          if (v !== last) { last = v; el.textContent = v; }
        });
      })(d);
    }

    if ((d = el.getAttribute('data-class')) != null) {
      el.removeAttribute('data-class');
      var base = (el.getAttribute('class') || '').replace(/\s+/g, ' ').trim();
      (function (path, base) {
        var last;
        local.push(function (sc) {
          var v = resolve(sc, path); v = v == null ? '' : String(v);
          var full = base ? (v ? base + ' ' + v : base) : v;
          if (full !== last) { last = full; el.setAttribute('class', full); }
        });
      })(d, base);
    }

    if ((d = el.getAttribute('data-style')) != null) {
      el.removeAttribute('data-style');
      (function (decls) {
        var lasts = [];
        local.push(function (sc) {
          for (var i = 0; i < decls.length; i++) {
            var v = interp(sc, decls[i][1]);
            if (v !== lasts[i]) { lasts[i] = v; el.style.setProperty(decls[i][0], v); }
          }
        });
      })(splitDecls(d));
    }

    if ((d = el.getAttribute('data-attr')) != null) {
      el.removeAttribute('data-attr');
      (function (pairs) {
        var lasts = [];
        local.push(function (sc) {
          for (var i = 0; i < pairs.length; i++) {
            var name = pairs[i][0];
            var v = resolveMaybe(sc, pairs[i][1]);
            if (v === lasts[i]) continue;
            lasts[i] = v;
            if (name === 'disabled' || name === 'checked' || name === 'selected' || name === 'value') {
              try { el[name] = name === 'value' ? (v == null ? '' : v) : !!v; } catch (e) { /* noop */ }
              if (name !== 'value') { if (v) el.setAttribute(name, ''); else el.removeAttribute(name); }
            } else if (v == null || v === false) {
              el.removeAttribute(name);
            } else {
              el.setAttribute(name, v === true ? '' : String(v));
            }
          }
        });
      })(splitDecls(d));
    }

    var hasOn = false;
    if ((d = el.getAttribute('data-on')) != null) {
      el.removeAttribute('data-on');
      hasOn = true;
      splitDecls(d).forEach(function (h) {
        el.addEventListener(h[0], function (ev) {
          var sc = el.__scope;
          var fn = sc && resolve(sc, h[1]);
          if (typeof fn === 'function') fn(ev);
        });
      });
    }

    var ifExpr = null;
    if (el.hasAttribute('data-if')) { ifExpr = el.getAttribute('data-if'); el.removeAttribute('data-if'); }

    var childUpd = compileChildren(el);

    if (ifExpr == null && !local.length && !childUpd && !hasOn) return null;

    return function (scope) {
      if (hasOn) el.__scope = scope;
      for (var i = 0; i < local.length; i++) local[i](scope);
      if (ifExpr != null) {
        var show = !!resolve(scope, ifExpr);
        if (el.hidden === show) el.hidden = !show;
        if (!show) return;               // don't touch descendants while hidden
      }
      if (childUpd) childUpd(scope);
    };
  }

  function compileFor(node) {
    var spec = node.getAttribute('data-for');
    var at = spec.indexOf(' in ');
    var asName = spec.slice(0, at).trim();
    var listPath = spec.slice(at + 4).trim();

    var isTemplate = node.tagName.toLowerCase() === 'template';
    var frag, marker, insertBeforeNode;
    if (isTemplate) {
      // clones go where the <template> was, before a comment marker
      marker = node.ownerDocument.createComment('for:' + asName);
      node.parentNode.insertBefore(marker, node);
      node.parentNode.removeChild(node);
      frag = node.content;
      insertBeforeNode = marker;
    } else {
      // element-as-container (used for SVG <g>): its children are the prototype,
      // clones are appended inside it
      node.removeAttribute('data-for');
      frag = node.ownerDocument.createDocumentFragment();
      while (node.firstChild) frag.appendChild(node.firstChild);
      marker = node;                 // container; append (insertBefore null)
      insertBeforeNode = null;
    }
    var parent = isTemplate ? marker.parentNode : node;
    var instances = []; // [{ nodes:[Node], steps:[fn] }]

    return function (scope) {
      var list = resolve(scope, listPath);
      if (!Array.isArray(list)) list = list == null ? [] : [].slice.call(list);

      while (instances.length < list.length) {
        var clone = document.importNode(frag, true);
        var nodes = [].slice.call(clone.childNodes);
        parent.insertBefore(clone, insertBeforeNode);
        var steps = [];
        for (var n = 0; n < nodes.length; n++) {
          if (nodes[n].nodeType !== 1) continue;
          var s = compileEl(nodes[n]);
          if (s) steps.push(s);
        }
        instances.push({ nodes: nodes, steps: steps });
      }
      while (instances.length > list.length) {
        var dead = instances.pop();
        for (var q = 0; q < dead.nodes.length; q++) {
          if (dead.nodes[q].parentNode) dead.nodes[q].parentNode.removeChild(dead.nodes[q]);
        }
      }
      for (var i = 0; i < list.length; i++) {
        var child = Object.create(scope);
        child[asName] = list[i];
        child.$index = i;
        var st = instances[i].steps;
        for (var j = 0; j < st.length; j++) st[j](child);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* base class (stands in for DCLogic / React.Component)                */
  /* ------------------------------------------------------------------ */
  function View() {}
  View.prototype.state = null;
  View.prototype.props = null;

  View.prototype.setState = function (patch, cb) {
    var p = typeof patch === 'function' ? patch(this.state) : patch;
    if (p) for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) this.state[k] = p[k];
    if (cb) (this._cbs || (this._cbs = [])).push(cb);
    this._schedule();
  };
  View.prototype.forceUpdate = function (cb) {
    if (cb) (this._cbs || (this._cbs = [])).push(cb);
    this._schedule();
  };
  View.prototype._schedule = function () {
    if (this._raf) return;
    var self = this;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self._flush(); });
  };
  View.prototype._flush = function () {
    var vals;
    try { vals = this.renderVals() || {}; }
    catch (e) { console.error('renderVals():', e); return; }
    if (this.props) for (var k in this.props) if (!(k in vals)) vals[k] = this.props[k];
    try { this._update(vals); }
    catch (e) { console.error('view update:', e); }
    var cbs = this._cbs; this._cbs = null;
    if (cbs) for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) { console.error(e); } }
  };
  View.prototype.renderVals = function () { return {}; };
  View.prototype.componentDidMount = function () {};
  View.prototype.componentWillUnmount = function () {};

  window.__View = View;

  // Shim for `React.createRef()` — game.js only ever uses createRef + `.current`.
  window.__viewReact = { createRef: function () { return { current: null }; } };

  window.__mountView = function (ComponentClass, host) {
    var comp = new ComponentClass();
    if (!comp.state) comp.state = {};
    if (!comp.props) comp.props = {};
    comp._update = compileChildren(host) || function () {};
    comp._flush();                       // first synchronous render (fills refs)
    try { comp.componentDidMount(); } catch (e) { console.error('componentDidMount:', e); }
    window.addEventListener('beforeunload', function () {
      try { comp.componentWillUnmount(); } catch (e) { /* noop */ }
    });
    window.__gameComponent = comp;
    return comp;
  };
})();
