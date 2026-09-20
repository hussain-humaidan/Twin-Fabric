/**
 * Signal-chain rendering: the collapsible text tree in the inspector and the
 * generated 2D connection diagram. Both are derived from the same trace data.
 */
import { h } from './dom.js';
import { SIGNALS } from '../model/signals.js';
import { select, focusOn, setHighlight } from '../core/store.js';
import { getCableType } from '../model/queries.js';
import { fmtLen } from '../core/util.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
};

export function signalColor(signal) { return SIGNALS[signal]?.color || '#8d9aab'; }

/**
 * Render a trace tree as an indented chain.
 * @param {object} node result of logic/trace.js trace()
 * @param {'downstream'|'upstream'} direction
 */
export function renderChain(project, node, direction, { origin = true } = {}) {
  if (!node) return h('div', { class: 'hint' }, 'Nothing connected.');
  const wrap = h('div', { class: 'chain' });

  const walk = (n, depth, container) => {
    const row = h('div', {
      class: `chain-node${depth === 0 && origin ? ' origin' : ''}`,
      onclick: () => { select('device', n.device.id); focusOn('device', n.device.id); },
    },
    h('span', { class: 'nm', title: n.device.name }, n.device.name),
    h('span', { class: 'cd', style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--dim)' } }, n.device.id));
    container.appendChild(row);

    if (!n.children.length) {
      if (n.truncated) container.appendChild(h('div', { class: 'hint', style: { paddingLeft: '16px' } }, '… chain continues'));
      return;
    }
    const kids = h('div', { class: n.children.length > 1 ? 'chain-indent' : '' });
    for (const c of n.children) {
      const type = getCableType(project, c.cable.typeId);
      const color = type?.color || signalColor(c.cable.signal);
      kids.appendChild(h('div', {
        class: 'chain-link',
        title: `${c.cable.id} · ${fmtLen(c.cable.length)} · ${c.cable.status}`,
        onclick: (e) => {
          e.stopPropagation();
          select('cable', c.cable.id);
          focusOn('cable', c.cable.id);
        },
      },
      h('i', { style: { background: color } }),
      h('span', null, `${direction === 'downstream' ? '▼' : '▲'} ${type?.name || c.cable.typeId}`),
      h('span', { style: { color: 'var(--dim)' } }, `${c.port ? c.port.name : ''} · ${fmtLen(c.cable.length)}`)));
      walk(c, depth + 1, kids);
    }
    container.appendChild(kids);
  };

  walk(node, 0, wrap);
  return wrap;
}

/** Linear chain produced by findPath() — the TRACE PATH result. */
export function renderPathSteps(project, steps) {
  if (!steps?.length) return h('div', { class: 'hint' }, 'No signal path found between these devices.');
  const wrap = h('div', { class: 'chain' });
  wrap.appendChild(deviceRow(steps[0].fromDevice, steps[0].fromPort, 'Source'));
  for (const s of steps) {
    const type = getCableType(project, s.cable.typeId);
    wrap.appendChild(h('div', {
      class: 'chain-link',
      onclick: () => { select('cable', s.cable.id); focusOn('cable', s.cable.id); },
    },
    h('i', { style: { background: type?.color || signalColor(s.cable.signal) } }),
    h('span', null, `▼ ${s.cable.id} · ${type?.name || ''}`),
    h('span', { style: { color: 'var(--dim)' } }, fmtLen(s.cable.length))));
    wrap.appendChild(deviceRow(s.toDevice, s.toPort, null));
  }
  return wrap;

  function deviceRow(device, port, tag) {
    return h('div', {
      class: 'chain-node',
      onclick: () => { select('device', device.id); focusOn('device', device.id); },
    },
    h('span', { class: 'nm' }, device.name),
    port ? h('span', { class: 'cd', style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)' } }, port.name) : null,
    tag ? h('span', { class: 'badge' }, tag) : null);
  }
}

/* ------------------------------------------------------------------ */
/* 2D connection diagram                                               */
/* ------------------------------------------------------------------ */

const BOX_W = 168;
const BOX_H = 44;
const GAP_X = 74;
const GAP_Y = 22;

/**
 * Draw a device's connection diagram: upstream on the left, the device in the
 * middle, downstream on the right. Generated from the 3D data, no layout file.
 */
export function renderConnectionDiagram(project, up, down, rootDevice) {
  const upList = flatten(up?.root, 'up');
  const downList = flatten(down?.root, 'down');

  const columns = new Map();   // depth (negative = upstream) -> nodes
  for (const n of upList) push(columns, -n.depth, n);
  for (const n of downList) push(columns, n.depth, n);
  columns.set(0, [{ device: rootDevice, depth: 0, cable: null, port: null }]);

  const depths = Array.from(columns.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(...depths.map((d) => columns.get(d).length), 1);
  const width = depths.length * (BOX_W + GAP_X) + GAP_X;
  const height = maxRows * (BOX_H + GAP_Y) + GAP_Y * 2;

  const pos = new Map();       // deviceId+depth -> {x,y}
  const root = svg('svg', {
    class: 'diagram', viewBox: `0 0 ${width} ${height}`,
    style: `min-height:${Math.min(height, 520)}px`,
  });

  depths.forEach((d, ci) => {
    const list = columns.get(d);
    list.forEach((n, ri) => {
      const x = GAP_X / 2 + ci * (BOX_W + GAP_X);
      const y = (height - list.length * (BOX_H + GAP_Y)) / 2 + ri * (BOX_H + GAP_Y);
      pos.set(key(n, d), { x, y });
    });
  });

  // edges first so boxes paint over them
  for (const d of depths) {
    for (const n of columns.get(d)) {
      if (!n.cable || !n.parent) continue;
      const a = pos.get(key(n.parent, n.parentDepth));
      const b = pos.get(key(n, d));
      if (!a || !b) continue;
      const type = getCableType(project, n.cable.typeId);
      const color = type?.color || signalColor(n.cable.signal);
      const [from, to] = d > 0 ? [a, b] : [b, a];
      const x1 = from.x + BOX_W, y1 = from.y + BOX_H / 2;
      const x2 = to.x, y2 = to.y + BOX_H / 2;
      const mx = (x1 + x2) / 2;
      root.appendChild(svg('path', {
        class: 'edge', stroke: color,
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        'marker-end': 'url(#arrow)',
      }));
      root.appendChild(svg('text', {
        class: 'lbl-dim', x: mx, y: (y1 + y2) / 2 - 5, 'text-anchor': 'middle', fill: color,
      }, `${type?.name || n.cable.typeId}`));
    }
  }

  const defs = svg('defs', {},
    svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
      svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' })));
  root.insertBefore(defs, root.firstChild);

  for (const d of depths) {
    for (const n of columns.get(d)) {
      const pt = pos.get(key(n, d));
      if (!pt) continue;
      const g = svg('g', { class: 'node-g', transform: `translate(${pt.x},${pt.y})` });
      g.addEventListener('click', () => { select('device', n.device.id); focusOn('device', n.device.id); });
      g.appendChild(svg('rect', { class: `box${d === 0 ? ' sel' : ''}`, width: BOX_W, height: BOX_H, rx: 3 }));
      g.appendChild(svg('text', { x: 9, y: 18 }, trunc(n.device.name, 24)));
      g.appendChild(svg('text', { class: 'lbl-dim', x: 9, y: 33 }, `${n.device.id}${n.port ? ` · ${trunc(n.port.name, 14)}` : ''}`));
      root.appendChild(g);
    }
  }
  return root;

  function key(n, d) { return `${n.device.id}@${d}`; }
  function push(map, d, n) {
    if (!map.has(d)) map.set(d, []);
    if (!map.get(d).some((x) => x.device.id === n.device.id)) map.get(d).push(n);
  }
  function flatten(node, dir, out = [], parent = null, parentDepth = 0) {
    if (!node) return out;
    for (const c of node.children) {
      out.push({ ...c, parent: node, parentDepth: dir === 'up' ? -parentDepth : parentDepth });
      flatten(c, dir, out, c, c.depth);
    }
    return out;
  }
  function trunc(s, n) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
}

/** Highlight a whole trace in 3D. */
export function highlightTrace(result, label) {
  setHighlight({
    cables: Array.from(result.cables || []),
    devices: Array.from(result.devices || []),
    label,
  });
}
