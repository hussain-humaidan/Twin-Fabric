/**
 * Full-screen views: global search, inventories, topology trees, the 2D
 * logical infrastructure map, path tracing and the project health check.
 */
import {
  h, clear, btn, badge, table, selectInput, textInput, checkbox, kv, empty, bar,
} from './dom.js';
import { state, select, focusOn, setView, clearHighlight, toast } from '../core/store.js';
import { openDialog, showText, confirmDialog } from './dialogs.js';
import { buildSearchIndex, search, filterCables, filterDevices } from '../logic/search.js';
import {
  getDevice, getSpace, getLevel, getCableType, spaceArea, spaceCentroid,
  pathwayUtilisation, cablesOfDevice,
} from '../model/queries.js';
import { networkTopology, powerTopology, findPath, traceBoth } from '../logic/trace.js';
import { auditProject } from '../logic/validate.js';
import { renderPathSteps, highlightTrace, signalColor } from './chain.js';
import { fmtLen, fmtArea, sortBy } from '../core/util.js';
import {
  cableScheduleCSV, equipmentScheduleCSV, portScheduleCSV, roomScheduleCSV,
  toJSON, exportFilename,
} from '../persist/io.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
};

/* ================================================================== */
/* global search                                                       */
/* ================================================================== */

export function openSearch() {
  const p = state.project;
  const index = buildSearchIndex(p);
  let results = [];
  let cursor = 0;

  const input = h('input', { type: 'text', placeholder: 'Search devices, cables, rooms, racks, trays…  (try "TV", "SDI", "Hall 3", "Kiloview")' });
  const list = h('div', { class: 'pal-results' });

  const renderList = () => {
    clear(list);
    if (!input.value.trim()) {
      list.appendChild(h('div', { class: 'pal-empty' }, 'Type to search the whole twin.'));
      return;
    }
    if (!results.length) {
      list.appendChild(h('div', { class: 'pal-empty' }, 'No matches.'));
      return;
    }
    results.forEach((r, i) => {
      list.appendChild(h('div', {
        class: `pal-row${i === cursor ? ' on' : ''}`,
        onclick: () => choose(r),
      },
      h('span', { class: 'ic' }, r.icon),
      h('span', { class: 'nm' }, r.title),
      h('span', { class: 'sub' }, r.sub),
      badge(r.kind)));
    });
  };

  const choose = (r) => {
    dlg.close();
    if (r.kind === 'cableType') {
      const only = {};
      for (const t of p.cableTypes) only[t.id] = t.id === r.id;
      setView({ cableTypes: only });
      toast(`Showing only ${r.title} cables.`, 'ok');
      return;
    }
    if (r.kind === 'level') { setView({ activeLevelId: r.id }); focusOn('level', r.id); return; }
    select(r.kind, r.id);
    focusOn(r.kind, r.id);
  };

  const update = () => {
    results = search(index, input.value, { limit: 60 });
    cursor = 0;
    renderList();
  };

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { cursor = Math.min(cursor + 1, results.length - 1); renderList(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { cursor = Math.max(cursor - 1, 0); renderList(); e.preventDefault(); }
    if (e.key === 'Enter' && results[cursor]) choose(results[cursor]);
    if (e.key === 'Escape') dlg.close();
  });

  const dlg = openDialog({
    title: 'Search', size: 'md',
    body: [input, list],
  });
  dlg.dialog.classList.add('palette');
  renderList();
  setTimeout(() => input.focus(), 30);
}

/* ================================================================== */
/* inventories                                                         */
/* ================================================================== */

export function openInventory(kind = 'devices') {
  const p = state.project;
  let text = '';
  let levelId = '';
  let typeId = '';
  let statusFilter = '';
  let sortKey = 'id';
  let sortDir = 1;
  const bodyEl = h('div');

  const render = () => {
    clear(bodyEl);
    if (kind === 'devices') renderDevices();
    else if (kind === 'cables') renderCables();
    else if (kind === 'rooms') renderRooms();
    else renderPorts();
  };

  function toolbar(extra = []) {
    return h('div', { class: 'row wrap', style: { marginBottom: '9px' } },
      textInput(text, (v) => { text = v; render(); }, { placeholder: 'Filter…', live: true }),
      selectInput([{ value: '', label: 'All floors' }, ...p.levels.map((l) => ({ value: l.id, label: l.name }))],
        levelId, (v) => { levelId = v; render(); }),
      ...extra);
  }

  function renderDevices() {
    const rows = sortBy(filterDevices(p, {
      text, levelId: levelId || null, statuses: statusFilter ? [statusFilter] : null,
      typeIds: typeId ? [typeId] : null,
    }), (d) => d[sortKey] ?? '', sortDir);
    bodyEl.appendChild(toolbar([
      selectInput([{ value: '', label: 'All types' },
        ...Array.from(new Set(p.devices.map((d) => d.typeId))).map((t) => ({ value: t, label: t }))],
      typeId, (v) => { typeId = v; render(); }),
      selectInput([{ value: '', label: 'Any status' },
        ...Array.from(new Set(p.devices.map((d) => d.status))).map((s) => ({ value: s, label: s }))],
      statusFilter, (v) => { statusFilter = v; render(); }),
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, `${rows.length} of ${p.devices.length}`),
      btn('CSV', () => showText('Equipment schedule (CSV)', equipmentScheduleCSV(p), { filename: 'equipment-schedule.csv', mime: 'text/csv' }), { class: 'sm' }),
    ]));
    bodyEl.appendChild(table([
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Device' },
      { key: 'typeId', label: 'Type' },
      { key: 'space', label: 'Location', render: (d) => getSpace(p, d.spaceId)?.name || '—' },
      { key: 'rackId', label: 'Rack', render: (d) => (d.rackId ? `${d.rackId} · U${d.rackU}` : '—') },
      { key: 'ports', label: 'Ports', num: true, render: (d) => String(d.ports.length) },
      { key: 'conns', label: 'Cables', num: true, render: (d) => String(cablesOfDevice(p, d.id).length) },
      { key: 'ip', label: 'IP', render: (d) => d.attributes?.ip || '—' },
      { key: 'status', label: 'Status', render: (d) => badge(d.status, d.status === 'active' ? 'ok' : d.status === 'faulty' ? 'err' : d.status === 'planned' ? 'planned' : '') },
      { key: 'spec', label: 'Spec', render: (d) => (d.verifiedSpec ? badge('ok', 'ok') : badge('placeholder', 'ph')) },
    ], rows, {
      sortKey, sortDir,
      onSort: (k) => { if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; } render(); },
      onRow: (d) => { select('device', d.id); focusOn('device', d.id); },
      isSelected: (d) => state.selection.some((s) => s.kind === 'device' && s.id === d.id),
      style: { maxHeight: '64vh' },
    }));
  }

  function renderCables() {
    const rows = sortBy(filterCables(p, {
      text, levelId: levelId || null, typeIds: typeId ? [typeId] : null,
      statuses: statusFilter ? [statusFilter] : null,
    }), (c) => c[sortKey] ?? '', sortDir);
    const total = rows.reduce((s, c) => s + (c.length || 0), 0);
    bodyEl.appendChild(toolbar([
      selectInput([{ value: '', label: 'All cable types' }, ...p.cableTypes.map((t) => ({ value: t.id, label: t.name }))],
        typeId, (v) => { typeId = v; render(); }),
      selectInput([{ value: '', label: 'Any status' },
        ...Array.from(new Set(p.cables.map((c) => c.status))).map((s) => ({ value: s, label: s }))],
      statusFilter, (v) => { statusFilter = v; render(); }),
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, `${rows.length} cables · ${fmtLen(total)}`),
      btn('CSV', () => showText('Cable schedule (CSV)', cableScheduleCSV(p), { filename: 'cable-schedule.csv', mime: 'text/csv' }), { class: 'sm' }),
    ]));
    bodyEl.appendChild(table([
      { key: 'id', label: 'Cable' },
      { key: 'typeId', label: 'Type', render: (c) => {
        const t = getCableType(p, c.typeId);
        return h('span', null, h('i', { style: { display: 'inline-block', width: '10px', height: '3px', background: t?.color, marginRight: '5px' } }), t?.name || c.typeId);
      } },
      { key: 'from', label: 'From', render: (c) => getDevice(p, c.from?.deviceId)?.name || '—' },
      { key: 'fromPort', label: 'Out', render: (c) => getDevice(p, c.from?.deviceId)?.ports.find((x) => x.id === c.from?.portId)?.name || '—' },
      { key: 'to', label: 'To', render: (c) => getDevice(p, c.to?.deviceId)?.name || '—' },
      { key: 'toPort', label: 'In', render: (c) => getDevice(p, c.to?.deviceId)?.ports.find((x) => x.id === c.to?.portId)?.name || '—' },
      { key: 'length', label: 'Length', num: true, render: (c) => (c.length || 0).toFixed(2) },
      { key: 'route', label: 'Via', render: (c) => (c.pathwayIds || []).map((id) => p.pathways.find((x) => x.id === id)?.name || id).join(' + ') || 'free air' },
      { key: 'status', label: 'Status', render: (c) => badge(c.status, c.status === 'active' || c.status === 'installed' ? 'ok' : c.status === 'faulty' ? 'err' : 'planned') },
      { key: 'warn', label: '!', render: (c) => ((c.warnings || []).length ? badge(String(c.warnings.length), 'warn') : '') },
    ], rows, {
      sortKey, sortDir,
      onSort: (k) => { if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; } render(); },
      onRow: (c) => { select('cable', c.id); focusOn('cable', c.id); },
      isSelected: (c) => state.selection.some((s) => s.kind === 'cable' && s.id === c.id),
      style: { maxHeight: '64vh' },
    }));
  }

  function renderRooms() {
    const rows = p.spaces.filter((s) => (!levelId || s.levelId === levelId)
      && (!text || `${s.name} ${s.code} ${s.kind}`.toLowerCase().includes(text.toLowerCase())));
    bodyEl.appendChild(toolbar([
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, `${rows.length} spaces`),
      btn('CSV', () => showText('Room schedule (CSV)', roomScheduleCSV(p), { filename: 'room-schedule.csv', mime: 'text/csv' }), { class: 'sm' }),
    ]));
    bodyEl.appendChild(table([
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Room' },
      { key: 'kind', label: 'Kind' },
      { key: 'level', label: 'Level', render: (s) => getLevel(p, s.levelId)?.name || '—' },
      { key: 'area', label: 'Area', num: true, render: (s) => spaceArea(s).toFixed(1) },
      { key: 'devices', label: 'Equipment', num: true, render: (s) => String(p.devices.filter((d) => d.spaceId === s.id).length) },
      { key: 'detected', label: 'Boundary', render: (s) => (s.detected ? badge('from walls', 'info') : badge('assigned')) },
    ], rows, {
      onRow: (s) => { select('space', s.id); focusOn('space', s.id); },
      style: { maxHeight: '64vh' },
    }));
  }

  function renderPorts() {
    const rows = [];
    for (const d of p.devices) {
      for (const pt of d.ports) {
        if (text && !`${d.name} ${pt.name} ${pt.connector}`.toLowerCase().includes(text.toLowerCase())) continue;
        if (levelId && d.levelId !== levelId) continue;
        rows.push({ d, pt });
      }
    }
    bodyEl.appendChild(toolbar([
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, `${rows.length} ports`),
      btn('CSV', () => showText('Port schedule (CSV)', portScheduleCSV(p), { filename: 'port-schedule.csv', mime: 'text/csv' }), { class: 'sm' }),
    ]));
    bodyEl.appendChild(table([
      { key: 'device', label: 'Device', render: (r) => r.d.name },
      { key: 'port', label: 'Port', render: (r) => r.pt.name },
      { key: 'connector', label: 'Connector', render: (r) => r.pt.connector },
      { key: 'direction', label: 'Dir', render: (r) => r.pt.direction },
      { key: 'signals', label: 'Signals', render: (r) => (r.pt.signals || []).join(', ') },
      { key: 'cable', label: 'Cable', render: (r) => {
        const c = p.cables.find((x) => x.from?.portId === r.pt.id || x.to?.portId === r.pt.id);
        return c ? c.id : '—';
      } },
      { key: 'verified', label: 'Spec', render: (r) => (r.pt.verified ? badge('ok', 'ok') : badge('placeholder', 'ph')) },
    ], rows, {
      onRow: (r) => { select('device', r.d.id); focusOn('device', r.d.id); },
      style: { maxHeight: '64vh' },
    }));
  }

  const titles = { devices: 'Equipment inventory', cables: 'Cable schedule', rooms: 'Room schedule', ports: 'Port schedule' };
  const dlg = openDialog({
    title: titles[kind] || 'Inventory', size: 'lg',
    body: bodyEl,
    footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
  });
  render();
}

/* ================================================================== */
/* topology trees                                                      */
/* ================================================================== */

export function openTopology(which = 'network') {
  const p = state.project;
  const data = which === 'network' ? networkTopology(p) : powerTopology(p);
  const wrap = h('div');

  const renderNode = (node, depth) => {
    const row = h('div', {
      class: 'chain-node',
      style: { marginLeft: `${depth * 16}px`, marginBottom: '2px' },
      onclick: () => { select('device', node.device.id); focusOn('device', node.device.id); },
    },
    h('span', { class: 'nm' }, node.device?.name || '—'),
    node.device?.attributes?.ip ? h('span', { class: 'cd', style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)' } }, node.device.attributes.ip) : null,
    node.cable ? badge(getCableType(p, node.cable.typeId)?.name || node.cable.typeId) : null);
    wrap.appendChild(row);
    for (const c of node.children) renderNode(c, depth + 1);
  };

  if (!data.roots.length) wrap.appendChild(empty(`No ${which} connections recorded yet.`));
  for (const r of data.roots) renderNode(r, 0);

  if (which === 'network' && data.orphans?.length) {
    wrap.appendChild(h('div', { class: 'hint', style: { marginTop: '12px' } },
      `${data.orphans.length} device(s) have network ports but no cable: ${data.orphans.map((d) => d.name).join(', ')}`));
  }

  const dlg = openDialog({
    title: which === 'network' ? 'Network topology' : 'Power distribution',
    size: 'md',
    body: h('div', null,
      h('div', { class: 'hint', style: { marginBottom: '9px' } },
        which === 'network'
          ? 'Built from ethernet, fibre and KVM cables. Roots are routers and switches.'
          : 'Built from AC/DC cables. Roots are distribution boards and UPS units.'),
      wrap),
    footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
  });
}

/* ================================================================== */
/* 2D logical infrastructure map                                       */
/* ================================================================== */

export function openLogical() {
  const p = state.project;
  const levels = p.levels.slice().sort((a, b) => b.elevation - a.elevation);

  // Rooms that actually carry equipment become nodes.
  const nodes = [];
  const nodeIndex = new Map();
  levels.forEach((lvl, li) => {
    const spaces = p.spaces.filter((s) => s.levelId === lvl.id && p.devices.some((d) => d.spaceId === s.id));
    spaces.forEach((s, si) => {
      const n = { space: s, level: lvl, col: si, row: li, devices: p.devices.filter((d) => d.spaceId === s.id) };
      nodes.push(n);
      nodeIndex.set(s.id, n);
    });
  });

  // Aggregate cables room → room by cable type.
  const edges = new Map();
  for (const c of p.cables) {
    const a = c.from ? getDevice(p, c.from.deviceId) : null;
    const b = c.to ? getDevice(p, c.to.deviceId) : null;
    if (!a?.spaceId || !b?.spaceId || a.spaceId === b.spaceId) continue;
    const key = `${a.spaceId}>${b.spaceId}>${c.typeId}`;
    if (!edges.has(key)) edges.set(key, { from: a.spaceId, to: b.spaceId, typeId: c.typeId, count: 0, length: 0, cables: [] });
    const e = edges.get(key);
    e.count++; e.length += c.length || 0; e.cables.push(c.id);
  }

  const BW = 172, BH = 52, GX = 56, GY = 88;
  const cols = Math.max(1, ...levels.map((lvl) => nodes.filter((n) => n.level.id === lvl.id).length));
  const width = cols * (BW + GX) + GX;
  const height = levels.length * (BH + GY) + GY;
  const root = svg('svg', { class: 'diagram', viewBox: `0 0 ${width} ${height}`, style: `min-height:${Math.min(height, 560)}px` });
  root.appendChild(svg('defs', {},
    svg('marker', { id: 'lg-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
      svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }))));

  for (const n of nodes) {
    const rowNodes = nodes.filter((x) => x.level.id === n.level.id);
    const i = rowNodes.indexOf(n);
    n.x = GX / 2 + (width - GX - rowNodes.length * (BW + GX)) / 2 + i * (BW + GX);
    n.y = GY / 2 + n.row * (BH + GY);
  }

  for (const e of edges.values()) {
    const a = nodeIndex.get(e.from);
    const b = nodeIndex.get(e.to);
    if (!a || !b) continue;
    const t = getCableType(p, e.typeId);
    const color = t?.color || signalColor('data');
    const x1 = a.x + BW / 2, y1 = a.y + BH;
    const x2 = b.x + BW / 2, y2 = b.y;
    const my = (y1 + y2) / 2;
    const path = svg('path', {
      class: 'edge', stroke: color, 'stroke-width': Math.min(5, 1 + e.count * 0.5),
      d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
      'marker-end': 'url(#lg-arrow)',
    });
    path.style.color = color;
    root.appendChild(path);
    root.appendChild(svg('text', {
      class: 'lbl-dim', x: (x1 + x2) / 2, y: my - 4, 'text-anchor': 'middle', fill: color,
    }, `${e.count} × ${t?.name || e.typeId} · ${fmtLen(e.length)}`));
  }

  for (const lvl of levels) {
    const rowNodes = nodes.filter((n) => n.level.id === lvl.id);
    const y = rowNodes.length ? rowNodes[0].y : GY / 2 + levels.indexOf(lvl) * (BH + GY);
    root.appendChild(svg('text', { class: 'lbl-dim', x: 8, y: y - 14 }, lvl.name.toUpperCase()));
  }

  for (const n of nodes) {
    const g = svg('g', { class: 'node-g', transform: `translate(${n.x},${n.y})` });
    g.addEventListener('click', () => { select('space', n.space.id); focusOn('space', n.space.id); });
    g.appendChild(svg('rect', { class: 'box', width: BW, height: BH, rx: 3 }));
    g.appendChild(svg('text', { x: 9, y: 19 }, n.space.name.slice(0, 24)));
    g.appendChild(svg('text', { class: 'lbl-dim', x: 9, y: 34 }, `${n.devices.length} devices`));
    g.appendChild(svg('text', { class: 'lbl-dim', x: 9, y: 46 }, n.space.code || n.space.id));
    root.appendChild(g);
  }

  const dlg = openDialog({
    title: '2D logical infrastructure map', size: 'lg',
    body: h('div', null,
      h('div', { class: 'hint', style: { marginBottom: '9px' } },
        'Room-to-room view generated from the same data as the 3D model — how many cables of each type run between spaces. Click a room to select it.'),
      nodes.length ? root : empty('No equipment placed yet.')),
    footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
  });
}

/* ================================================================== */
/* trace path                                                          */
/* ================================================================== */

export function openTrace() {
  const p = state.project;
  const devices = sortBy(p.devices, (d) => d.name);
  if (devices.length < 2) { toast('Place at least two devices first.', 'warn'); return; }

  let srcId = state.selection.find((s) => s.kind === 'device')?.id || devices[0].id;
  let dstId = devices[devices.length - 1].id;
  const resultEl = h('div');

  const run = () => {
    clear(resultEl);
    const res = findPath(p, srcId, dstId);
    if (!res?.found) {
      const fwd = traceBoth(p, srcId, { maxDepth: 12 });
      resultEl.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '8px' } },
        badge('no path', 'warn'),
        h('span', { class: 'hint' }, 'No directional signal chain connects these devices. The source reaches:')));
      resultEl.appendChild(h('div', { class: 'hint' },
        Array.from(fwd.devices).map((id) => getDevice(p, id)?.name).filter(Boolean).join(', ') || '— nothing —'));
      return;
    }
    highlightTrace(res, `${getDevice(p, srcId)?.name} → ${getDevice(p, dstId)?.name}`);
    resultEl.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '8px' } },
      badge(`${res.steps.length} hops`, 'ok'),
      h('span', { class: 'hint' }, `${res.cables.size} cables highlighted in 3D · total ${fmtLen(res.steps.reduce((s, x) => s + (x.cable.length || 0), 0))}`)));
    resultEl.appendChild(renderPathSteps(p, res.steps));
  };

  const dlg = openDialog({
    title: 'Trace signal path', size: 'md',
    body: h('div', null,
      h('div', { class: 'hint', style: { marginBottom: '9px' } },
        'Follows cable direction and each device’s internal continuity — a converter is a legitimate hop.'),
      h('div', { class: 'field' }, h('label', null, 'Source'),
        selectInput(devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })), srcId, (v) => { srcId = v; run(); })),
      h('div', { class: 'field' }, h('label', null, 'Destination'),
        selectInput(devices.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })), dstId, (v) => { dstId = v; run(); })),
      h('div', { class: 'sp' }),
      resultEl),
    footer: [
      btn('Clear highlight', () => { clearHighlight(); }),
      btn('Close', () => dlg.close(), { class: 'primary' }),
    ],
  });
  run();
}

/* ================================================================== */
/* health check                                                        */
/* ================================================================== */

const AUDIT_MARK = { ok: '✓', warning: '⚠', error: '✕', info: 'i' };
const AUDIT_CLASS = { ok: 'ok', warning: 'warn', error: 'err', info: 'info' };

export function openAudit() {
  const p = state.project;
  const { categories, counts } = auditProject(p);

  const renderCheck = (check) => {
    const expandable = check.items.length > 0;
    const head = h('div', {
      class: 'row',
      style: { padding: '3px 0', cursor: expandable ? 'pointer' : 'default', alignItems: 'flex-start' },
    },
    h('span', {
      style: {
        width: '16px', flex: 'none', fontFamily: 'var(--mono)',
        color: `var(--${check.level === 'ok' ? 'ok' : check.level === 'error' ? 'err' : check.level === 'warning' ? 'warn' : 'info'})`,
      },
    }, AUDIT_MARK[check.level]),
    h('span', { class: 'grow', style: { fontSize: '11.5px' } }, check.message));

    if (!expandable) return head;

    const items = h('div', { class: 'ports', style: { margin: '2px 0 6px 16px' }, hidden: true },
      check.items.slice(0, 120).map((it) => h('div', {
        class: 'port',
        onclick: () => { select(it.kind, it.id); focusOn(it.kind, it.id); },
      },
      h('span', { class: 'dir' }, '→'),
      h('span', { class: 'pn' }, it.label || it.id),
      h('span', { class: 'conn' }, it.id))));

    head.appendChild(h('span', { class: 'hint' }, `${check.items.length} ▸`));
    head.addEventListener('click', () => { items.hidden = !items.hidden; });
    return h('div', null, head, items);
  };

  const body = h('div', null,
    h('div', { class: 'row wrap', style: { marginBottom: '12px' } },
      badge(`${counts.error || 0} errors`, counts.error ? 'err' : 'ok'),
      badge(`${counts.warning || 0} warnings`, counts.warning ? 'warn' : 'ok'),
      badge(`${counts.info || 0} notes`, 'info'),
      badge(`${counts.ok || 0} checks passed`, 'ok'),
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, 'Click any line to expand, then any item to jump to it in 3D.')),
    categories.map((c) => h('div', { style: { marginBottom: '14px' } },
      h('h3', {
        style: {
          fontSize: '10px', fontFamily: 'var(--mono)', letterSpacing: '.12em',
          textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 5px',
          borderBottom: '1px solid var(--line-soft)', paddingBottom: '4px',
        },
      }, c.label),
      c.checks.length ? c.checks.map(renderCheck) : h('div', { class: 'hint' }, 'Nothing to check yet.'))));

  const dlg = openDialog({
    title: 'Project audit', size: 'md',
    body,
    footer: [
      btn('Copy as text', async () => {
        const lines = [`PROJECT AUDIT — ${p.building.name}`, ''];
        for (const c of categories) {
          lines.push(c.label);
          for (const ch of c.checks) {
            lines.push(`  ${AUDIT_MARK[ch.level]} ${ch.message}`);
            for (const it of ch.items) lines.push(`      ${it.id}  ${it.label || ''}`);
          }
          lines.push('');
        }
        showText('Project audit', lines.join('\n'), { filename: 'project-audit.txt', mime: 'text/plain' });
      }),
      btn('Close', () => dlg.close(), { class: 'primary' }),
    ],
  });
  void AUDIT_CLASS;
}

/* ================================================================== */
/* floor plan summary (2D) — quick per-level overview                  */
/* ================================================================== */

export function openFloorPlan() {
  const p = state.project;
  const lvlId = state.view.activeLevelId || p.levels[0]?.id;
  const lvl = getLevel(p, lvlId);
  if (!lvl) return;
  const spaces = p.spaces.filter((s) => s.levelId === lvl.id && s.boundary?.length);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const s of spaces) for (const q of s.boundary) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
  }
  const pad = 2;
  const w = maxX - minX + pad * 2, hgt = maxZ - minZ + pad * 2;
  const scale = Math.min(900 / w, 560 / hgt);
  const root = svg('svg', { class: 'diagram', viewBox: `0 0 ${w * scale} ${hgt * scale}`, style: `min-height:${Math.min(hgt * scale, 560)}px` });
  const X = (x) => (x - minX + pad) * scale;
  const Z = (z) => (z - minZ + pad) * scale;

  for (const wall of p.walls.filter((x) => x.levelId === lvl.id)) {
    root.appendChild(svg('line', {
      x1: X(wall.start.x), y1: Z(wall.start.z), x2: X(wall.end.x), y2: Z(wall.end.z),
      stroke: wall.type === 'exterior' ? '#9fb4c8' : '#5a6675',
      'stroke-width': Math.max(1, wall.thickness * scale),
      'stroke-linecap': 'square',
    }));
  }
  for (const s of spaces) {
    const c = spaceCentroid(s);
    const g = svg('g', { class: 'node-g' });
    g.addEventListener('click', () => { select('space', s.id); focusOn('space', s.id); });
    g.appendChild(svg('text', { x: X(c.x), y: Z(c.z), 'text-anchor': 'middle', fill: '#c9d4e2' }, s.code || s.name));
    g.appendChild(svg('text', { class: 'lbl-dim', x: X(c.x), y: Z(c.z) + 12, 'text-anchor': 'middle' }, fmtArea(spaceArea(s))));
    root.appendChild(g);
  }
  for (const pw of p.pathways.filter((x) => x.levelId === lvl.id)) {
    const pts = pw.points.map((q) => `${X(q.x)},${Z(q.z)}`).join(' ');
    root.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: '#e8b339', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
  }
  for (const d of p.devices.filter((x) => x.levelId === lvl.id)) {
    root.appendChild(svg('circle', { cx: X(d.position.x), cy: Z(d.position.z), r: 3.5, fill: '#5b9dd9' }));
  }

  const dlg = openDialog({
    title: `Floor plan — ${lvl.name}`, size: 'lg',
    body: h('div', null,
      h('div', { class: 'hint', style: { marginBottom: '9px' } },
        'Plan generated from the wall geometry. Dashed amber = cable containment, blue dots = equipment.'),
      root),
    footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
  });
}

/* ================================================================== */
/* project JSON                                                        */
/* ================================================================== */

export function openExport() {
  const p = state.project;
  showText('Project JSON', toJSON(p), { filename: exportFilename(p), mime: 'application/json' });
}

export function openImport(onLoad) {
  const ta = h('textarea', { placeholder: 'Paste a previously exported project JSON here…', style: { width: '100%', minHeight: '40vh', fontFamily: 'var(--mono)', fontSize: '11px' } });
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    ta.value = await f.text();
  });
  const dlg = openDialog({
    title: 'Import project', size: 'md',
    body: h('div', null,
      h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Choose a file or paste the JSON. This replaces the current project — export first if you want to keep it.'),
      file, h('div', { class: 'sp' }), ta),
    footer: [
      btn('Cancel', () => dlg.close()),
      btn('Import', async () => {
        const text = ta.value.trim();
        if (!text) return;
        if (!(await confirmDialog('Replace the current project with this document?', { danger: true, confirmLabel: 'Replace' }))) return;
        dlg.close();
        onLoad(text);
      }, { class: 'primary' }),
    ],
  });
}

export { kv, checkbox, bar, pathwayUtilisation };
