/** Minimal DOM helpers — no framework, no virtual DOM, no build step. */

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list' && typeof v !== 'object') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(4)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function replace(el, ...children) { clear(el); return append(el, children); }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- common widgets ---------------- */

export function btn(label, onClick, opts = {}) {
  return h('button', {
    class: `btn${opts.class ? ` ${opts.class}` : ''}`,
    title: opts.title || '',
    onclick: onClick,
    disabled: opts.disabled,
  }, opts.icon ? h('span', null, opts.icon) : null, label,
  opts.kbd ? h('kbd', null, opts.kbd) : null);
}

export function iconBtn(icon, onClick, opts = {}) {
  return h('button', { class: `btn icon${opts.class ? ` ${opts.class}` : ''}`, title: opts.title || '', onclick: onClick }, icon);
}

export function seg(options, value, onChange) {
  return h('div', { class: 'seg' }, options.map((o) => h('button', {
    class: o.value === value ? 'on' : '',
    title: o.title || '',
    onclick: () => onChange(o.value),
  }, o.label)));
}

export function field(label, control, opts = {}) {
  return h('div', { class: `field${opts.wide ? ' wide' : ''}` },
    h('label', { title: opts.title || label }, label), control);
}

export function textInput(value, onChange, opts = {}) {
  const el = h('input', {
    type: opts.type || 'text', value: value ?? '', placeholder: opts.placeholder || '',
    readOnly: opts.readOnly, class: opts.class || '', step: opts.step, min: opts.min, max: opts.max,
  });
  const fire = () => {
    const v = opts.type === 'number' ? parseFloat(el.value) : el.value;
    if (opts.type === 'number' && Number.isNaN(v)) return;
    onChange(v);
  };
  el.addEventListener('change', fire);
  if (opts.live) el.addEventListener('input', fire);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { fire(); el.blur(); } e.stopPropagation(); });
  return el;
}

export function numberInput(value, onChange, opts = {}) {
  return textInput(value, onChange, { ...opts, type: 'number', step: opts.step ?? 0.01, class: 'num' });
}

export function selectInput(options, value, onChange, opts = {}) {
  const el = h('select', { onchange: () => onChange(el.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  if (opts.title) el.title = opts.title;
  return el;
}

export function checkbox(label, checked, onChange, opts = {}) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'check', title: opts.title || '' }, input, h('span', null, label),
    opts.badge ? opts.badge : null);
}

export function colorInput(value, onChange) {
  const el = h('input', { type: 'color', value: value || '#888888', oninput: () => onChange(el.value) });
  return el;
}

export function textarea(value, onChange, opts = {}) {
  const el = h('textarea', { placeholder: opts.placeholder || '' });
  el.value = value || '';
  el.addEventListener('change', () => onChange(el.value));
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return el;
}

export function badge(text, kind = '') {
  return h('span', { class: `badge${kind ? ` ${kind}` : ''}` }, text);
}

export function section(title, body, opts = {}) {
  const open = opts.open !== false;
  const wrap = h('div', { class: `section${open ? '' : ' closed'}` });
  const chev = h('span', { class: 'chev' }, open ? '▼' : '▶');
  const head = h('div', { class: 'section-head', onclick: () => {
    wrap.classList.toggle('closed');
    chev.textContent = wrap.classList.contains('closed') ? '▶' : '▼';
    opts.onToggle?.(!wrap.classList.contains('closed'));
  } }, chev, h('h3', null, title),
  opts.count != null ? h('span', { class: 'count' }, String(opts.count)) : null,
  opts.action || null);
  const bodyEl = h('div', { class: 'section-body' }, body);
  wrap.append(head, bodyEl);
  wrap.bodyEl = bodyEl;
  return wrap;
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [
    h('dt', null, k),
    h('dd', null, v instanceof Node ? v : String(v ?? '—')),
  ]));
}

export function bar(ratio, opts = {}) {
  const pct = Math.max(0, Math.min(1, ratio || 0));
  const cls = pct > 0.9 ? 'err' : pct > 0.6 ? 'warn' : '';
  return h('div', { class: 'bar', title: opts.title || `${(pct * 100).toFixed(0)}%` },
    h('i', { class: cls, style: { width: `${pct * 100}%` } }));
}

export function empty(message, icon = '◇') {
  return h('div', { class: 'empty' }, h('span', { class: 'big' }, icon), message);
}

export function table(columns, rows, opts = {}) {
  const tbl = h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', {
      onclick: () => opts.onSort?.(c.key),
      title: c.title || c.label,
    }, c.label + (opts.sortKey === c.key ? (opts.sortDir === 1 ? ' ▲' : ' ▼') : ''))))),
    h('tbody', null, rows.map((r) => {
      const tr = h('tr', {
        class: opts.isSelected?.(r) ? 'sel' : '',
        onclick: () => opts.onRow?.(r),
        ondblclick: () => opts.onRowDouble?.(r),
      }, columns.map((c) => {
        const v = c.render ? c.render(r) : r[c.key];
        return h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : (v ?? '—'));
      }));
      return tr;
    })));
  return h('div', { class: 'tbl-wrap', style: opts.style || {} }, tbl);
}
