/**
 * Inspector — the properties panel for whatever is selected.
 * One renderer per entity kind; all edits go through model/actions.js.
 */
import {
  h, clear, section, field, textInput, numberInput, selectInput, checkbox,
  colorInput, textarea, badge, btn, kv, bar, empty, table,
} from './dom.js';
import {
  state, bus, EV, select, focusOn, setView, setTool, toast, clearHighlight,
} from '../core/store.js';
import * as A from '../model/actions.js';
import {
  getDevice, getSpace, getLevel, getRack, getCableType, getWall, getOpening,
  devicesInSpace, cablesOfDevice, cablesOfPort, openingsOfWall, spaceArea,
  spaceHeights, rackOccupancy, pathwayUtilisation, cablesInPathway, devicesInRack,
  cableEndpoints, indexRev,
} from '../model/queries.js';
import { CONNECTORS, CONNECTOR_IDS, SIGNALS, SIGNAL_IDS, cableTypesForFamily } from '../model/signals.js';
import {
  DEVICE_STATUS, CABLE_STATUS, MOUNTING, WALL_TYPES, OPENING_KINDS,
  SPACE_KINDS, PATHWAY_KINDS, ROUTE_MODES,
} from '../model/schema.js';
import { traceBoth, trace, neighbours, flattenChain } from '../logic/trace.js';
import { validateLength } from '../logic/validate.js';
import { validateRoute } from '../logic/router.js';
import { renderChain, renderConnectionDiagram, highlightTrace } from './chain.js';
import { openDialog, confirmDialog, pickPort, promptDialog } from './dialogs.js';
import { fmtLen, fmtArea } from '../core/util.js';
import { wallFrame } from '../logic/geometry.js';
import { dist2 } from '../core/math.js';
import { catalogItem } from '../model/catalog.js';

export function createInspector(container, ctx) {
  function render() {
    const p = state.project;
    clear(container);
    if (!p) return;
    const sel = state.selection[state.selection.length - 1];
    if (!sel) { container.appendChild(renderNothing(p)); return; }

    const renderers = {
      device: renderDevice, cable: renderCable, space: renderSpace, wall: renderWall,
      opening: renderOpening, level: renderLevel, pathway: renderPathway, rack: renderRack,
      column: renderColumn, stair: renderStair, slab: renderSlab,
    };
    const fn = renderers[sel.kind];
    if (!fn) { container.appendChild(empty(`No inspector for ${sel.kind}.`)); return; }
    fn(p, sel.id);
  }

  function head(kind, title, idText, badges = [], actions = []) {
    const el = h('div', { class: 'insp-head' },
      h('div', { class: 'insp-kind' }, kind),
      h('div', { class: 'insp-title' }, title),
      h('div', { class: 'row wrap' }, h('span', { class: 'idtag' }, idText), ...badges),
      actions.length ? h('div', { class: 'insp-actions' }, actions) : null);
    container.appendChild(el);
    return el;
  }

  function renderNothing(p) {
    const stats = [
      ['Levels', p.levels.length], ['Rooms / spaces', p.spaces.length],
      ['Walls', p.walls.length], ['Openings', p.openings.length],
      ['Equipment', p.devices.length], ['Cables', p.cables.length],
      ['Racks', p.racks.length], ['Pathways', p.pathways.length],
    ];
    const totalLen = p.cables.reduce((s, c) => s + (c.length || 0), 0);
    return h('div', null,
      h('div', { class: 'insp-head' },
        h('div', { class: 'insp-kind' }, 'Project'),
        h('div', { class: 'insp-title' }, p.building.name),
        h('div', { class: 'hint' }, p.coordinateSystem)),
      section('Contents', kv(stats.map(([k, v]) => [k, String(v)])), { open: true }),
      section('Cable totals', kv([
        ['Total length', fmtLen(totalLen)],
        ...Array.from(new Set(p.cables.map((c) => c.typeId))).map((tid) => {
          const t = getCableType(p, tid);
          const list = p.cables.filter((c) => c.typeId === tid);
          return [t?.name || tid, `${list.length} · ${fmtLen(list.reduce((s, c) => s + (c.length || 0), 0))}`];
        }),
      ]), { open: true }),
      p.placeholders?.length ? section('Placeholder values',
        h('div', null,
          h('div', { class: 'hint', style: { marginBottom: '6px' } },
            'These are assumptions, not survey data. Replace them as the real figures arrive.'),
          h('ul', { style: { margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)' } },
            p.placeholders.map((t) => h('li', null, t)))),
        { open: false, count: p.placeholders.length }) : null,
      h('div', { class: 'empty' }, 'Select anything in the 3D view or the tree to edit it.'));
  }

  /* ================================================================ */
  /* DEVICE                                                            */
  /* ================================================================ */

  function renderDevice(p, id) {
    const d = getDevice(p, id);
    if (!d) return;
    const item = catalogItem(d.typeId);
    const space = d.spaceId ? getSpace(p, d.spaceId) : null;
    const level = d.levelId ? getLevel(p, d.levelId) : null;
    const cables = cablesOfDevice(p, d.id);

    head('Device', d.name, d.id, [
      badge(d.status, d.status === 'active' ? 'ok' : d.status === 'faulty' ? 'err' : d.status === 'planned' ? 'planned' : ''),
      d.verifiedSpec === false ? badge('placeholder spec', 'ph') : null,
      badge(item.category),
    ].filter(Boolean), [
      btn('Focus', () => focusOn('device', d.id), { class: 'sm' }),
      btn('Signal path', () => showSignalPath(p, d), { class: 'sm primary' }),
      btn('Diagram', () => showDiagram(p, d), { class: 'sm' }),
      btn('Add cable', () => { setTool('cable'); ctx.tools?.beginCableFrom?.(d.id); }, { class: 'sm' }),
    ]);

    container.appendChild(section('Identity', [
      field('Name', textInput(d.name, (v) => A.updateEntity('device', d.id, { name: v }))),
      field('Manufacturer', textInput(d.manufacturer, (v) => A.updateEntity('device', d.id, { manufacturer: v }))),
      field('Model', textInput(d.model, (v) => A.updateEntity('device', d.id, { model: v }))),
      field('Serial', textInput(d.serial, (v) => A.updateEntity('device', d.id, { serial: v }))),
      field('Type', h('span', { class: 'hint' }, `${item.name} (${d.typeId})`)),
      field('Status', selectInput(DEVICE_STATUS.map((s) => ({ value: s, label: s })), d.status,
        (v) => A.updateEntity('device', d.id, { status: v }))),
      field('Scenario', selectInput(p.scenarios.map((s) => ({ value: s.id, label: s.name })), d.scenarioId,
        (v) => A.updateEntity('device', d.id, { scenarioId: v }))),
      field('Mounting', selectInput(MOUNTING.map((m) => ({ value: m, label: m })), d.mounting,
        (v) => A.updateEntity('device', d.id, { mounting: v }))),
      field('Spec verified', checkbox('Port list confirmed against the real hardware', d.verifiedSpec,
        (v) => A.updateEntity('device', d.id, { verifiedSpec: v }))),
      d.verifiedSpec === false ? h('div', { class: 'hint' },
        'Ports below are a configurable placeholder. Edit them to match the actual unit, then tick the box.') : null,
    ]));

    container.appendChild(section('Location', [
      field('Level', h('span', { class: 'hint' }, level?.name || '—')),
      field('Room', space
        ? h('a', { href: '#', class: 'hint', onclick: (e) => { e.preventDefault(); select('space', space.id); } }, `${space.name} (${space.code || space.id})`)
        : h('span', { class: 'badge warn' }, 'outside any room')),
      d.rackId ? field('Rack', h('div', { class: 'row' },
        h('a', { href: '#', class: 'hint', onclick: (e) => { e.preventDefault(); select('rack', d.rackId); } }, d.rackId),
        btn('Unmount', () => A.unmountFromRack(d.id), { class: 'sm' }))) : null,
      d.rackId ? field('Rack U', numberInput(d.rackU, (v) => A.updateEntity('device', d.id, { rackU: Math.round(v) }), { step: 1 })) : null,
      d.rackId ? field('Height (U)', numberInput(d.rackUnits, (v) => A.updateEntity('device', d.id, { rackUnits: Math.max(1, Math.round(v)) }), { step: 1 })) : null,
      !d.rackId ? field('X (east)', numberInput(d.position.x, (v) => A.moveDevice(d.id, { ...d.position, x: v }))) : null,
      !d.rackId ? field('Y (up)', numberInput(d.position.y, (v) => A.moveDevice(d.id, { ...d.position, y: v }))) : null,
      !d.rackId ? field('Z (south)', numberInput(d.position.z, (v) => A.moveDevice(d.id, { ...d.position, z: v }))) : null,
      field('Rotation °', numberInput(+(d.rotation * 180 / Math.PI).toFixed(1),
        (v) => A.updateEntity('device', d.id, { rotation: v * Math.PI / 180 }), { step: 15 })),
      field('Size W×H×D', h('div', { class: 'row' },
        numberInput(d.size.w, (v) => A.updateEntity('device', d.id, { size: { ...d.size, w: v } })),
        numberInput(d.size.h, (v) => A.updateEntity('device', d.id, { size: { ...d.size, h: v } })),
        numberInput(d.size.d, (v) => A.updateEntity('device', d.id, { size: { ...d.size, d: v } })))),
      !d.rackId && p.racks.length ? field('Mount in rack', selectInput(
        [{ value: '', label: '— choose rack —' }, ...p.racks.map((r) => ({ value: r.id, label: r.name }))], '',
        (v) => { if (v) A.mountInRack(d.id, v); })) : null,
    ].filter(Boolean)));

    /* attributes */
    const attrKeys = Object.keys(d.attributes || {});
    container.appendChild(section('Attributes', [
      ...attrKeys.map((k) => field(k, textInput(d.attributes[k],
        (v) => A.updateEntity('device', d.id, { attributes: { ...d.attributes, [k]: v } })))),
      h('div', { class: 'sp' }),
      btn('＋ Add attribute', async () => {
        const key = await promptDialog('Attribute name', '', { title: 'Add attribute', placeholder: 'vlan, firmware, warranty…' });
        if (!key) return;
        A.updateEntity('device', d.id, { attributes: { ...d.attributes, [key]: '' } });
      }, { class: 'sm' }),
    ], { count: attrKeys.length, open: attrKeys.length > 0 }));

    /* ports */
    container.appendChild(section('Ports', renderPorts(p, d), {
      count: d.ports.length,
      open: true,
    }));

    /* connections */
    container.appendChild(section('Connections', cables.length ? h('div', null,
      cables.map((c) => {
        const t = getCableType(p, c.typeId);
        const other = c.from?.deviceId === d.id ? getDevice(p, c.to?.deviceId) : getDevice(p, c.from?.deviceId);
        const outgoing = c.from?.deviceId === d.id;
        return h('div', {
          class: 'port',
          onclick: () => { select('cable', c.id); focusOn('cable', c.id); },
        },
        h('span', { class: 'dir', style: { color: t?.color } }, outgoing ? '▶' : '◀'),
        h('span', { class: 'pn' }, other?.name || '—'),
        h('span', { class: 'conn' }, `${t?.name || c.typeId} · ${fmtLen(c.length)}`),
        badge(c.status, c.status === 'active' || c.status === 'installed' ? 'ok' : c.status === 'faulty' ? 'err' : 'planned'));
      })) : h('div', { class: 'hint' }, 'No cables connected yet.'), { count: cables.length }));

    /* signal path preview */
    const tb = traceBoth(p, d.id, { maxDepth: 6 });
    container.appendChild(section('Signal path', [
      h('div', { class: 'hint', style: { marginBottom: '5px' } }, 'Upstream (sources)'),
      renderChain(p, tb.up?.root, 'upstream'),
      h('div', { class: 'sp' }),
      h('div', { class: 'hint', style: { marginBottom: '5px' } }, 'Downstream (destinations)'),
      renderChain(p, tb.down?.root, 'downstream'),
      h('div', { class: 'sp' }),
      h('div', { class: 'row wrap' },
        btn('Highlight in 3D', () => {
          highlightTrace(tb, `${d.name} signal path`);
          toast(`${tb.cables.size} cables and ${tb.devices.size} devices highlighted.`, 'ok');
        }, { class: 'sm primary' }),
        btn('Clear', () => clearHighlight(), { class: 'sm' })),
    ], { open: true }));

    container.appendChild(section('Notes',
      textarea(d.notes, (v) => A.updateEntity('device', d.id, { notes: v }), { placeholder: 'Commissioning notes, faults, history…' }),
      { open: !!d.notes }));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Duplicate', () => { const c = A.duplicateDevice(d.id); if (c) select('device', c.id); }, { class: 'sm' }),
      btn('Delete', async () => {
        if (await confirmDialog(`Delete ${d.name} and its ${cables.length} cable(s)?`, { danger: true, confirmLabel: 'Delete' })) {
          A.deleteDevice(d.id);
        }
      }, { class: 'sm danger' })));
  }

  function renderPorts(p, d) {
    const wrap = h('div');
    const groups = new Map();
    for (const pt of d.ports) {
      const g = pt.group || 'Ports';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(pt);
    }
    for (const [g, list] of groups) {
      wrap.appendChild(h('div', { class: 'hint', style: { margin: '7px 0 3px' } }, g));
      for (const pt of list) {
        const used = cablesOfPort(p, pt.id).filter((c) => c.status !== 'removed');
        wrap.appendChild(h('div', {
          class: `port ${pt.direction}${used.length ? ' linked' : ''}`,
          onclick: () => editPort(p, d, pt),
        },
        h('span', { class: 'dir' }, pt.direction === 'out' ? '▶' : pt.direction === 'in' ? '◀' : '⇄'),
        h('span', { class: 'pn' }, pt.name, pt.verified === false ? h('span', { class: 'badge ph', style: { marginLeft: '5px' } }, 'PH') : null),
        h('span', { class: 'conn' }, CONNECTORS[pt.connector]?.label || pt.connector),
        used.length
          ? h('span', { class: 'cd', title: used.map((c) => c.id).join(', '), style: { color: 'var(--ok)', fontSize: '9px' } }, `${used.length}`)
          : h('button', {
            class: 'btn sm ghost', title: 'Start a cable from this port',
            onclick: (e) => { e.stopPropagation(); ctx.tools?.beginCableFromPort?.(d.id, pt.id); },
          }, 'connect')));
      }
    }
    wrap.appendChild(h('div', { class: 'sp' }));
    wrap.appendChild(h('div', { class: 'row wrap' },
      btn('＋ Add port', () => {
        const pt = A.addPort(d.id, { name: `Port ${d.ports.length + 1}` });
        if (pt) editPort(state.project, getDevice(state.project, d.id), pt);
      }, { class: 'sm' }),
      btn('Signal continuity', () => editContinuity(p, d), { class: 'sm', title: 'How signals pass through this device' })));
    return wrap;
  }

  function editPort(p, d, pt) {
    const draftPort = { ...pt };
    const body = h('div', null,
      field('Name', textInput(draftPort.name, (v) => { draftPort.name = v; })),
      field('Connector', selectInput(CONNECTOR_IDS.map((c) => ({ value: c, label: CONNECTORS[c].label })), draftPort.connector,
        (v) => { draftPort.connector = v; })),
      field('Direction', selectInput([
        { value: 'in', label: 'Input' }, { value: 'out', label: 'Output' }, { value: 'bidir', label: 'Bidirectional' },
      ], draftPort.direction, (v) => { draftPort.direction = v; })),
      field('Group', textInput(draftPort.group || '', (v) => { draftPort.group = v; })),
      h('div', { class: 'field wide' }, h('label', null, 'Signals carried'),
        h('div', { class: 'row wrap' }, SIGNAL_IDS.map((s) => checkbox(SIGNALS[s].label,
          (draftPort.signals || []).includes(s),
          (v) => {
            const set = new Set(draftPort.signals || []);
            if (v) set.add(s); else set.delete(s);
            draftPort.signals = Array.from(set);
          })))),
      checkbox('Exclusive (only one cable)', draftPort.exclusive !== false, (v) => { draftPort.exclusive = v; }),
      h('div', { class: 'sp' }),
      h('div', { class: 'hint' }, 'Editing a port marks it as confirmed, clearing its PLACEHOLDER flag.'));

    const dlg = openDialog({
      title: `Port — ${pt.name}`, size: 'sm', body,
      footer: [
        btn('Delete port', async () => {
          if (await confirmDialog(`Delete port "${pt.name}"? Cables on it will be removed.`, { danger: true, confirmLabel: 'Delete' })) {
            A.deletePort(d.id, pt.id);
            dlg.close();
          }
        }, { class: 'danger sm' }),
        btn('Cancel', () => dlg.close()),
        btn('Save', () => { A.updatePort(d.id, pt.id, draftPort); dlg.close(); }, { class: 'primary' }),
      ],
    });
  }

  function editContinuity(p, d) {
    let mode = d.passthrough;
    const links = (d.links || []).map((l) => ({ ...l }));
    const listEl = h('div', { class: 'ports' });
    const redraw = () => {
      clear(listEl);
      if (mode !== 'declared') {
        listEl.appendChild(h('div', { class: 'hint' }, mode === 'auto'
          ? 'Automatic: every input feeds every output that shares a signal class.'
          : 'None: signals stop at this device (patch panels, endpoints).'));
        return;
      }
      for (const l of links) {
        const from = d.ports.find((x) => x.id === l.from);
        const to = d.ports.find((x) => x.id === l.to);
        listEl.appendChild(h('div', { class: 'port' },
          h('span', { class: 'dir' }, '→'),
          h('span', { class: 'pn' }, `${from?.name || '?'} → ${to?.name || '?'}`),
          h('button', { class: 'btn sm ghost', onclick: () => { links.splice(links.indexOf(l), 1); redraw(); } }, '✕')));
      }
      const ins = d.ports.filter((x) => x.direction === 'in' || x.direction === 'bidir');
      const outs = d.ports.filter((x) => x.direction === 'out' || x.direction === 'bidir');
      let a = ins[0]?.id, b = outs[0]?.id;
      listEl.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
        selectInput(ins.map((x) => ({ value: x.id, label: x.name })), a, (v) => { a = v; }),
        h('span', null, '→'),
        selectInput(outs.map((x) => ({ value: x.id, label: x.name })), b, (v) => { b = v; }),
        btn('Add', () => { if (a && b) { links.push({ from: a, to: b }); redraw(); } }, { class: 'sm' })));
    };

    const dlg = openDialog({
      title: `Signal continuity — ${d.name}`, size: 'sm',
      body: h('div', null,
        h('div', { class: 'hint', style: { marginBottom: '8px' } },
          'Determines how a signal arriving on an input leaves this device. Converters declare it explicitly so path tracing knows SDI IN becomes HDMI OUT.'),
        field('Mode', selectInput([
          { value: 'auto', label: 'Automatic (by signal class)' },
          { value: 'declared', label: 'Declared links' },
          { value: 'none', label: 'None (endpoint)' },
        ], mode, (v) => { mode = v; redraw(); })),
        listEl),
      footer: [
        btn('Cancel', () => dlg.close()),
        btn('Save', () => { A.setDeviceLinks(d.id, links, mode); dlg.close(); }, { class: 'primary' }),
      ],
    });
    redraw();
  }

  function showSignalPath(p, d) {
    const tb = traceBoth(p, d.id, { maxDepth: 12 });
    highlightTrace(tb, `${d.name} signal path`);
    const dlg = openDialog({
      title: `Signal path — ${d.name}`, size: 'md',
      body: h('div', null,
        h('div', { class: 'hint', style: { marginBottom: '8px' } },
          `${tb.devices.size} devices · ${tb.cables.size} cables highlighted in the 3D view.`),
        h('h3', { style: { fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px' } }, 'UPSTREAM'),
        renderChain(p, tb.up?.root, 'upstream'),
        h('div', { class: 'sp' }),
        h('h3', { style: { fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px' } }, 'DOWNSTREAM'),
        renderChain(p, tb.down?.root, 'downstream')),
      footer: [btn('Clear highlight', () => { clearHighlight(); dlg.close(); }), btn('Close', () => dlg.close(), { class: 'primary' })],
    });
  }

  function showDiagram(p, d) {
    const up = trace(p, d.id, { direction: 'upstream', maxDepth: 4 });
    const down = trace(p, d.id, { direction: 'downstream', maxDepth: 4 });
    const dlg = openDialog({
      title: `Connection diagram — ${d.name}`, size: 'lg',
      body: h('div', null,
        h('div', { class: 'hint', style: { marginBottom: '8px' } },
          'Generated from the 3D data. Click any box to select that device.'),
        renderConnectionDiagram(p, up, down, d)),
      footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
    });
  }

  /* ================================================================ */
  /* CABLE                                                             */
  /* ================================================================ */

  function renderCable(p, id) {
    const c = p.cables.find((x) => x.id === id);
    if (!c) return;
    const t = getCableType(p, c.typeId);
    const ends = cableEndpoints(p, c);
    const lenIssue = validateLength(p, c);
    const routeProblems = c.route?.length >= 2 ? validateRoute(p, indexRev(), c.route) : [];

    head('Cable', c.name || c.id, c.id, [
      badge(t?.name || c.typeId), badge(c.signal),
      badge(c.status, c.status === 'active' || c.status === 'installed' ? 'ok' : c.status === 'faulty' ? 'err' : 'planned'),
      c.routeMode === 'manual' ? badge('manual route') : null,
    ].filter(Boolean), [
      btn('Focus', () => focusOn('cable', c.id), { class: 'sm' }),
      btn('Show full path', () => {
        const src = ends.sourceDevice;
        if (!src) return;
        const tb = traceBoth(p, src.id, { maxDepth: 12 });
        highlightTrace(tb, `${c.id} path`);
        toast('Full signal path highlighted.', 'ok');
      }, { class: 'sm primary' }),
      btn('Re-route', () => { A.rerouteCable(c.id); toast('Re-routed through the building.', 'ok'); }, { class: 'sm' }),
    ]);

    container.appendChild(section('Endpoints', [
      field('Source', ends.sourceDevice
        ? h('a', { href: '#', class: 'hint', onclick: (e) => { e.preventDefault(); select('device', ends.sourceDevice.id); } }, ends.sourceDevice.name)
        : badge('missing', 'err')),
      field('Source port', h('span', { class: 'hint' }, ends.sourcePort?.name || '—')),
      field('Destination', ends.destDevice
        ? h('a', { href: '#', class: 'hint', onclick: (e) => { e.preventDefault(); select('device', ends.destDevice.id); } }, ends.destDevice.name)
        : badge('missing', 'err')),
      field('Dest. port', h('span', { class: 'hint' }, ends.destPort?.name || '—')),
      h('div', { class: 'hint', style: { marginTop: '6px' } },
        'Direction is part of the record: source port → cable → destination port.'),
    ]));

    container.appendChild(section('Identity', [
      field('Name', textInput(c.name, (v) => A.updateEntity('cable', c.id, { name: v }))),
      field('Label', textInput(c.label, (v) => A.updateEntity('cable', c.id, { label: v }), { placeholder: 'Physical cable label' })),
      field('Type', selectInput(
        cableTypesForFamily(p, null).map((x) => ({ value: x.id, label: x.name })), c.typeId,
        (v) => {
          const nt = getCableType(p, v);
          A.updateEntity('cable', c.id, { typeId: v, signal: nt?.signal || c.signal });
        })),
      field('Signal', selectInput(SIGNAL_IDS.map((s) => ({ value: s, label: SIGNALS[s].label })), c.signal,
        (v) => A.updateEntity('cable', c.id, { signal: v }))),
      field('Status', selectInput(CABLE_STATUS.map((s) => ({ value: s, label: s })), c.status,
        (v) => A.updateEntity('cable', c.id, { status: v }))),
      field('Scenario', selectInput(p.scenarios.map((s) => ({ value: s.id, label: s.name })), c.scenarioId,
        (v) => A.updateEntity('cable', c.id, { scenarioId: v }))),
      field('Installed', textInput(c.installDate, (v) => A.updateEntity('cable', c.id, { installDate: v }), { type: 'date' })),
      field('Colour', h('div', { class: 'row' },
        colorInput(c.color || t?.color || '#888', (v) => A.updateEntity('cable', c.id, { color: v })),
        btn('Use type colour', () => A.updateEntity('cable', c.id, { color: null }), { class: 'sm ghost' }))),
    ]));

    container.appendChild(section('Physical route', [
      kv([
        ['Length', h('b', null, fmtLen(c.length))],
        ['Raw run', fmtLen((c.route || []).reduce((s, q, i, arr) => i ? s + Math.hypot(q.x - arr[i - 1].x, q.y - arr[i - 1].y, q.z - arr[i - 1].z) : 0, 0))],
        ['Slack', `× ${(c.slack ?? t?.slack ?? 1).toFixed(2)}`],
        ['Waypoints', String((c.route || []).length)],
        ['Mode', c.routeMode],
        ['Containment', (c.pathwayIds || []).length
          ? h('div', null, c.pathwayIds.map((pid) => {
            const pw = p.pathways.find((x) => x.id === pid);
            return h('div', null, h('a', {
              href: '#', class: 'hint',
              onclick: (e) => { e.preventDefault(); select('pathway', pid); },
            }, pw?.name || pid));
          }))
          : 'free air'],
        ['Through openings', (c.openingIds || []).length
          ? (c.openingIds || []).map((oid) => getOpening(p, oid)?.kind || oid).join(', ')
          : 'none'],
      ]),
      lenIssue ? h('div', { class: 'row wrap', style: { marginTop: '6px' } }, badge('length', 'warn'), h('span', { class: 'hint' }, lenIssue)) : null,
      ...(c.warnings || []).map((w) => h('div', { class: 'row wrap', style: { marginTop: '4px' } }, badge('route', 'warn'), h('span', { class: 'hint' }, w))),
      routeProblems.length ? h('div', { class: 'row wrap', style: { marginTop: '4px' } },
        badge('collision', 'err'),
        h('span', { class: 'hint' }, `Route passes through building fabric at ${routeProblems.length} segment(s): ${routeProblems.map((r) => r.reason).join(', ')}. Re-route or add a penetration.`)) : null,
      h('div', { class: 'sp' }),
      field('Route authority', selectInput(
        ROUTE_MODES.map((m) => ({ value: m.id, label: m.label })), c.routeMode || 'auto',
        (v) => A.setRouteMode(c.id, v))),
      h('div', { class: 'hint' }, ROUTE_MODES.find((m) => m.id === (c.routeMode || 'auto'))?.hint || ''),
      h('div', { class: 'sp' }),
      h('div', { class: 'row wrap' },
        btn('Auto re-route', () => A.rerouteCable(c.id), { class: 'sm', disabled: c.routeMode === 'locked' }),
        btn('Straighten', () => {
          const e2 = cableEndpoints(p, c);
          if (e2.sourcePos && e2.destPos) A.setCableRoute(c.id, [e2.sourcePos, e2.destPos], { mode: 'manual' });
        }, { class: 'sm ghost', disabled: c.routeMode === 'locked' }),
        btn(c.routeMode === 'locked' ? 'Unlock route' : 'Lock route',
          () => A.setRouteMode(c.id, c.routeMode === 'locked' ? 'manual' : 'locked'), { class: 'sm' })),
    ], { open: true }));

    /* waypoint editor */
    container.appendChild(section('Waypoints', [
      h('div', { class: 'hint', style: { marginBottom: '7px' } },
        c.routeMode === 'locked'
          ? 'Route is locked. Unlock it above to edit waypoints.'
          : 'Drag the amber handles in 3D (Shift drags height), click a small blue handle to insert one, right-click a handle to delete. Length, containment and collisions recalculate on drop.'),
      h('div', { class: 'ports' }, (c.route || []).map((pt, i) => {
        const isEnd = i === 0 || i === (c.route.length - 1);
        return h('div', { class: `port${isEnd ? '' : ' out'}` },
          h('span', { class: 'dir' }, isEnd ? (i === 0 ? 'S' : 'D') : String(i)),
          h('span', { class: 'pn', style: { display: 'flex', gap: '3px' } },
            numberInput(+pt.x.toFixed(3), (v) => A.moveCableWaypoint(c.id, i, { ...pt, x: v }), { step: 0.1 }),
            numberInput(+pt.y.toFixed(3), (v) => A.moveCableWaypoint(c.id, i, { ...pt, y: v }), { step: 0.1 }),
            numberInput(+pt.z.toFixed(3), (v) => A.moveCableWaypoint(c.id, i, { ...pt, z: v }), { step: 0.1 })),
          isEnd
            ? badge('anchor')
            : h('button', {
              class: 'btn sm ghost',
              title: 'Delete this waypoint',
              onclick: () => A.deleteCableWaypoint(c.id, i),
            }, '✕'));
      })),
    ], { count: (c.route || []).length, open: false }));

    container.appendChild(section('Notes',
      textarea(c.notes, (v) => A.updateEntity('cable', c.id, { notes: v })), { open: !!c.notes }));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Duplicate', () => { const n = A.duplicateCable(c.id); if (n) select('cable', n.id); }, { class: 'sm' }),
      btn('Delete', async () => {
        if (await confirmDialog(`Delete cable ${c.id}?`, { danger: true, confirmLabel: 'Delete' })) A.deleteCable(c.id);
      }, { class: 'sm danger' })));
  }

  /* ================================================================ */
  /* SPACE                                                             */
  /* ================================================================ */

  function renderSpace(p, id) {
    const s = getSpace(p, id);
    if (!s) return;
    const level = getLevel(p, s.levelId);
    const hts = spaceHeights(p, s);
    const devices = devicesInSpace(p, s.id);
    const cables = p.cables.filter((c) => {
      const a = c.from ? getDevice(p, c.from.deviceId) : null;
      const b = c.to ? getDevice(p, c.to.deviceId) : null;
      return a?.spaceId === s.id || b?.spaceId === s.id;
    });
    const openings = (s.openingIds || []).map((oid) => getOpening(p, oid)).filter(Boolean);

    head('Room', s.name, s.code || s.id, [
      badge(s.kind), s.detected ? badge('detected from walls', 'info') : null,
      s.placeholder ? badge('placeholder dims', 'ph') : null,
    ].filter(Boolean), [
      btn('Focus', () => focusOn('space', s.id), { class: 'sm' }),
      btn('Isolate floor', () => setView({ activeLevelId: s.levelId, isolateLevel: true }), { class: 'sm' }),
    ]);

    container.appendChild(section('Identity', [
      field('Name', textInput(s.name, (v) => A.updateEntity('space', s.id, { name: v }))),
      field('Code', textInput(s.code, (v) => A.updateEntity('space', s.id, { code: v }), { placeholder: 'H1, U05, CR-07' })),
      field('Kind', selectInput(SPACE_KINDS.map((k) => ({ value: k, label: k })), s.kind,
        (v) => A.updateEntity('space', s.id, { kind: v }))),
      field('Group', textInput(s.group || '', (v) => A.updateEntity('space', s.id, { group: v || null }), { placeholder: 'clerks' })),
      field('Level', h('span', { class: 'hint' }, level?.name || '—')),
    ]));

    container.appendChild(section('Dimensions', [
      kv([
        ['Floor area', fmtArea(spaceArea(s))],
        ['Floor level', `${hts.floorY.toFixed(2)} m`],
        ['Ceiling', `${(hts.ceilingY - hts.floorY).toFixed(2)} m`],
        ['Ceiling void', `${(hts.plenumTop - hts.ceilingY).toFixed(2)} m`],
        ['Boundary', `${s.boundary.length} vertices`],
      ]),
      h('div', { class: 'sp' }),
      field('Ceiling height', numberInput(s.ceilingHeight ?? level?.ceilingHeight ?? 3,
        (v) => A.updateEntity('space', s.id, { ceilingHeight: v }))),
      field('Floor offset', numberInput(s.floorOffset || 0, (v) => A.updateEntity('space', s.id, { floorOffset: v }))),
      h('div', { class: 'sp' }),
      // Numeric resize for rectangular rooms — moves the actual walls.
      ...(A.isRectSpace(s) ? rectResizeFields(s) : [
        h('div', { class: 'hint' },
          'This room is not a plain rectangle, so it cannot be resized numerically. Move its walls in Building mode, then run “Detect rooms”.'),
      ]),
    ]));

    function rectResizeFields(space) {
      const b = A.boundsOfPolygon(space.boundary);
      const cur = { x: b.minX, z: b.minZ, w: b.maxX - b.minX, d: b.maxZ - b.minZ };
      const apply = (patch) => A.resizeSpaceRect(space.id, { ...cur, ...patch });
      return [
        h('div', { class: 'hint', style: { marginBottom: '5px' } },
          'Resizing moves the actual walls. A wall shared with a neighbouring room moves for both — which is what a shared partition does.'),
        field('Origin X', numberInput(+cur.x.toFixed(3), (v) => apply({ x: v }))),
        field('Origin Z', numberInput(+cur.z.toFixed(3), (v) => apply({ z: v }))),
        field('Width (X)', numberInput(+cur.w.toFixed(3), (v) => apply({ w: v }))),
        field('Depth (Z)', numberInput(+cur.d.toFixed(3), (v) => apply({ d: v }))),
      ];
    }

    container.appendChild(section('Equipment', devices.length
      ? h('div', null, devices.map((d) => h('div', {
        class: 'port', onclick: () => { select('device', d.id); focusOn('device', d.id); },
      },
      h('span', { class: 'dir' }, '▢'),
      h('span', { class: 'pn' }, d.name),
      h('span', { class: 'conn' }, d.id),
      badge(d.status, d.status === 'active' ? 'ok' : d.status === 'planned' ? 'planned' : ''))))
      : h('div', { class: 'hint' }, 'No equipment in this room.'), { count: devices.length }));

    container.appendChild(section('Cables', cables.length
      ? h('div', null, cables.slice(0, 40).map((c) => {
        const t = getCableType(p, c.typeId);
        return h('div', { class: 'port', onclick: () => { select('cable', c.id); focusOn('cable', c.id); } },
          h('span', { class: 'dir', style: { color: t?.color } }, '∿'),
          h('span', { class: 'pn' }, c.id),
          h('span', { class: 'conn' }, `${t?.name || ''} · ${fmtLen(c.length)}`));
      }))
      : h('div', { class: 'hint' }, 'No cables terminate in this room.'), { count: cables.length, open: false }));

    container.appendChild(section('Openings', openings.length
      ? h('div', null, openings.map((o) => h('div', { class: 'port', onclick: () => select('opening', o.id) },
        h('span', { class: 'dir' }, o.kind === 'door' ? '⌷' : o.kind === 'window' ? '▭' : '◦'),
        h('span', { class: 'pn' }, o.name || o.kind),
        h('span', { class: 'conn' }, `${o.width.toFixed(2)} × ${o.height.toFixed(2)} m`),
        o.cablePassable ? badge('cables', 'ok') : badge('sealed'))))
      : h('div', { class: 'hint' }, 'No doors or penetrations recorded.'), { count: openings.length, open: false }));

    container.appendChild(section('Notes',
      textarea(s.notes, (v) => A.updateEntity('space', s.id, { notes: v })), { open: !!s.notes }));
  }

  /* ================================================================ */
  /* WALL / OPENING / STRUCTURE                                        */
  /* ================================================================ */

  function renderWall(p, id) {
    const w = getWall(p, id);
    if (!w) return;
    const level = getLevel(p, w.levelId);
    const ops = openingsOfWall(p, w.id);
    const len = dist2(w.start, w.end);
    const f = wallFrame(w);

    head('Wall', w.name || `Wall ${w.id}`, w.id, [
      badge(w.type), w.structural ? badge('structural', 'info') : null,
    ].filter(Boolean), [
      btn('Focus', () => focusOn('wall', w.id), { class: 'sm' }),
      btn('Add door', () => setTool('door'), { class: 'sm' }),
      btn('Add cable hole', () => setTool('penetration'), { class: 'sm' }),
    ]);

    container.appendChild(section('Geometry', [
      kv([['Level', level?.name || '—'], ['Openings', String(ops.length)]]),
      h('div', { class: 'sp' }),
      // Length and bearing are editable: they move the end point along /
      // around the wall's own axis, which is how you actually draw a plan.
      field('Length', numberInput(+len.toFixed(3), (v) => {
        if (v <= 0.05) return;
        A.updateWall(w.id, { end: { x: w.start.x + f.dir.x * v, z: w.start.z + f.dir.z * v } });
      })),
      field('Bearing °', numberInput(+(f.angle * 180 / Math.PI).toFixed(2), (v) => {
        const a = (v * Math.PI) / 180;
        A.updateWall(w.id, { end: { x: w.start.x + Math.cos(a) * len, z: w.start.z + Math.sin(a) * len } });
      }, { step: 5 })),
      h('div', { class: 'sp' }),
      field('Start X', numberInput(w.start.x, (v) => A.updateWall(w.id, { start: { ...w.start, x: v } }))),
      field('Start Z', numberInput(w.start.z, (v) => A.updateWall(w.id, { start: { ...w.start, z: v } }))),
      field('End X', numberInput(w.end.x, (v) => A.updateWall(w.id, { end: { ...w.end, x: v } }))),
      field('End Z', numberInput(w.end.z, (v) => A.updateWall(w.id, { end: { ...w.end, z: v } }))),
      field('Height', numberInput(w.height, (v) => A.updateWall(w.id, { height: v }))),
      field('Thickness', numberInput(w.thickness, (v) => A.updateWall(w.id, { thickness: v }), { step: 0.01 })),
      field('Base offset', numberInput(w.baseOffset, (v) => A.updateWall(w.id, { baseOffset: v }))),
      field('Type', selectInput(WALL_TYPES.map((t) => ({ value: t, label: t })), w.type,
        (v) => A.updateWall(w.id, { type: v }))),
      field('Material', selectInput(p.materials.map((m) => ({ value: m.id, label: m.name })), w.materialId,
        (v) => A.updateWall(w.id, { materialId: v }))),
      field('Structural', checkbox('Blocks cable routing', w.structural, (v) => A.updateWall(w.id, { structural: v }))),
    ]));

    container.appendChild(section('Openings', ops.length
      ? h('div', null, ops.map((o) => h('div', { class: 'port', onclick: () => select('opening', o.id) },
        h('span', { class: 'dir' }, o.kind === 'door' ? '⌷' : o.kind === 'window' ? '▭' : '◦'),
        h('span', { class: 'pn' }, `${o.kind} @ ${o.offset.toFixed(2)} m`),
        h('span', { class: 'conn' }, `${o.width.toFixed(2)}×${o.height.toFixed(2)}`),
        o.cablePassable ? badge('cables', 'ok') : null)))
      : h('div', { class: 'hint' }, 'Solid wall — no openings.'), { count: ops.length, open: true }));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Delete wall', async () => {
        if (await confirmDialog(`Delete this wall and its ${ops.length} opening(s)?`, { danger: true, confirmLabel: 'Delete' })) {
          A.deleteWall(w.id);
        }
      }, { class: 'sm danger' })));
  }

  function renderOpening(p, id) {
    const o = getOpening(p, id);
    if (!o) return;
    const w = getWall(p, o.wallId);
    const a = o.spaceA ? getSpace(p, o.spaceA) : null;
    const b = o.spaceB ? getSpace(p, o.spaceB) : null;

    head('Opening', o.name || o.kind, o.id, [badge(o.kind), o.cablePassable ? badge('cable route', 'ok') : badge('sealed')], [
      btn('Focus', () => focusOn('opening', o.id), { class: 'sm' }),
    ]);

    container.appendChild(section('Geometry', [
      field('Kind', selectInput(OPENING_KINDS.map((k) => ({ value: k, label: k })), o.kind,
        (v) => A.updateOpening(o.id, { kind: v }))),
      field('Offset along wall', numberInput(o.offset, (v) => A.updateOpening(o.id, { offset: v }))),
      field('Width', numberInput(o.width, (v) => A.updateOpening(o.id, { width: v }))),
      field('Height', numberInput(o.height, (v) => A.updateOpening(o.id, { height: v }))),
      field('Sill height', numberInput(o.sill, (v) => A.updateOpening(o.id, { sill: v }))),
      field('Wall', w ? h('a', { href: '#', class: 'hint', onclick: (e) => { e.preventDefault(); select('wall', w.id); } }, w.id) : '—'),
    ]));

    container.appendChild(section('Connectivity', [
      kv([['Side A', a ? a.name : '—'], ['Side B', b ? b.name : '—']]),
      h('div', { class: 'sp' }),
      checkbox('Cables may route through', o.cablePassable, (v) => A.updateOpening(o.id, { cablePassable: v })),
      checkbox('People may pass through', o.peoplePassable, (v) => A.updateOpening(o.id, { peoplePassable: v })),
      h('div', { class: 'hint', style: { marginTop: '6px' } },
        'The router only crosses a wall where an opening admits cables — this switch is what makes a run legal or illegal.'),
    ]));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Delete', () => A.deleteOpening(o.id), { class: 'sm danger' })));
  }

  function renderLevel(p, id) {
    const l = getLevel(p, id);
    if (!l) return;
    const spaces = p.spaces.filter((s) => s.levelId === l.id);
    const walls = p.walls.filter((w) => w.levelId === l.id);
    head('Level', l.name, l.id, [badge(l.kind), l.placeholder ? badge('placeholder', 'ph') : null].filter(Boolean), [
      btn('Focus', () => focusOn('level', l.id), { class: 'sm' }),
      btn(state.view.isolateLevel && state.view.activeLevelId === l.id ? 'Show all floors' : 'Isolate',
        () => setView({ activeLevelId: l.id, isolateLevel: !(state.view.isolateLevel && state.view.activeLevelId === l.id) }),
        { class: 'sm primary' }),
      btn('Detect rooms', () => A.detectRooms(l.id), { class: 'sm', title: 'Re-derive room boundaries from the wall geometry' }),
    ]);

    container.appendChild(section('Parameters', [
      field('Name', textInput(l.name, (v) => A.updateLevel(l.id, { name: v }))),
      field('Short name', textInput(l.shortName, (v) => A.updateLevel(l.id, { shortName: v }))),
      field('Elevation', numberInput(l.elevation, (v) => A.updateLevel(l.id, { elevation: v }))),
      field('Floor-to-floor', numberInput(l.height, (v) => A.updateLevel(l.id, { height: v }))),
      field('Ceiling height', numberInput(l.ceilingHeight, (v) => A.updateLevel(l.id, { ceilingHeight: v }))),
      field('Slab thickness', numberInput(l.slabThickness, (v) => A.updateLevel(l.id, { slabThickness: v }), { step: 0.01 })),
      field('Has ceiling', checkbox('Suspended ceiling', l.hasCeiling, (v) => A.updateLevel(l.id, { hasCeiling: v }))),
      h('div', { class: 'hint' }, 'Changing floor-to-floor or slab thickness updates every wall on this level.'),
    ]));

    container.appendChild(section('Contents', kv([
      ['Spaces', String(spaces.length)],
      ['Walls', String(walls.length)],
      ['Openings', String(p.openings.filter((o) => walls.some((w) => w.id === o.wallId)).length)],
      ['Equipment', String(p.devices.filter((d) => d.levelId === l.id).length)],
      ['Total area', fmtArea(spaces.reduce((s, sp) => s + spaceArea(sp), 0))],
    ])));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Delete level', async () => {
        if (await confirmDialog(`Delete ${l.name} with all its walls, rooms and equipment?`, { danger: true, confirmLabel: 'Delete level' })) {
          A.deleteLevel(l.id);
        }
      }, { class: 'sm danger' })));
  }

  function renderPathway(p, id) {
    const pw = p.pathways.find((x) => x.id === id);
    if (!pw) return;
    const u = pathwayUtilisation(p, pw);
    head('Pathway', pw.name, pw.id, [badge(pw.kind), pw.placeholder ? badge('placeholder', 'ph') : null].filter(Boolean), [
      btn('Focus', () => focusOn('pathway', pw.id), { class: 'sm' }),
    ]);

    container.appendChild(section('Parameters', [
      field('Name', textInput(pw.name, (v) => A.updateEntity('pathway', pw.id, { name: v }))),
      field('Kind', selectInput(PATHWAY_KINDS.map((k) => ({ value: k, label: k })), pw.kind,
        (v) => A.updateEntity('pathway', pw.id, { kind: v }))),
      field('Width', numberInput(pw.width, (v) => A.updateEntity('pathway', pw.id, { width: v }), { step: 0.05 })),
      field('Height', numberInput(pw.height, (v) => A.updateEntity('pathway', pw.id, { height: v }), { step: 0.05 })),
      field('Capacity', numberInput(pw.capacity, (v) => A.updateEntity('pathway', pw.id, { capacity: Math.round(v) }), { step: 1 })),
      field('Cost factor', numberInput(pw.costFactor ?? 0, (v) => A.updateEntity('pathway', pw.id, { costFactor: v || null }), { step: 0.05 })),
      h('div', { class: 'hint' }, 'Lower cost makes the router prefer this containment.'),
    ]));

    container.appendChild(section('Utilisation', [
      kv([['Cables', `${u.used} of ${u.capacity}`], ['Spare ways', String(u.free)],
        ['Cross-section fill', `${(u.fillRatio * 100).toFixed(0)}%`], ['Vertices', String(pw.points.length)]]),
      bar(Math.max(u.ratio, u.fillRatio)),
      h('div', { class: 'sp' }),
      ...cablesInPathway(p, pw.id).slice(0, 30).map((c) => {
        const t = getCableType(p, c.typeId);
        return h('div', { class: 'port', onclick: () => { select('cable', c.id); focusOn('cable', c.id); } },
          h('span', { class: 'dir', style: { color: t?.color } }, '∿'),
          h('span', { class: 'pn' }, c.id),
          h('span', { class: 'conn' }, fmtLen(c.length)));
      }),
    ], { open: true }));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Delete', () => A.deleteEntity('pathway', pw.id), { class: 'sm danger' })));
  }

  function renderRack(p, id) {
    const r = getRack(p, id);
    if (!r) return;
    const occ = rackOccupancy(p, r);
    head('Rack', r.name, r.id, [badge(`${r.rackUnits}U`), badge(`${occ.used} used`)], [
      btn('Focus', () => focusOn('rack', r.id), { class: 'sm' }),
    ]);

    container.appendChild(section('Parameters', [
      field('Name', textInput(r.name, (v) => A.updateEntity('rack', r.id, { name: v }))),
      field('Rack units', numberInput(r.rackUnits, (v) => A.updateEntity('rack', r.id, { rackUnits: Math.round(v) }), { step: 1 })),
      field('X', numberInput(r.position.x, (v) => A.updateEntity('rack', r.id, { position: { ...r.position, x: v } }))),
      field('Z', numberInput(r.position.z, (v) => A.updateEntity('rack', r.id, { position: { ...r.position, z: v } }))),
      field('Rotation °', numberInput(+(r.rotation * 180 / Math.PI).toFixed(0),
        (v) => A.updateEntity('rack', r.id, { rotation: v * Math.PI / 180 }), { step: 15 })),
    ]));

    const rows = [];
    for (let u = r.rackUnits; u >= 1; u--) {
      const d = occ.map[u];
      const isTop = d && (occ.map[u + 1] !== d);
      rows.push(h('div', {
        class: 'port',
        style: { opacity: d ? 1 : 0.45, cursor: d ? 'pointer' : 'default' },
        onclick: () => { if (d) { select('device', d.id); focusOn('device', d.id); } },
      },
      h('span', { class: 'dir' }, String(u)),
      h('span', { class: 'pn' }, d ? (isTop ? d.name : '↑') : '—'),
      h('span', { class: 'conn' }, d ? d.id : 'free')));
    }
    container.appendChild(section('Rack elevation', h('div', { class: 'ports' }, rows),
      { count: devicesInRack(p, r.id).length, open: true }));

    container.appendChild(h('div', { class: 'section-body row wrap' },
      btn('Delete rack', () => A.deleteEntity('rack', r.id), { class: 'sm danger' })));
  }

  function renderColumn(p, id) {
    const c = p.columns.find((x) => x.id === id);
    if (!c) return;
    head('Column', c.name || 'Structural column', c.id, [badge(c.shape)], [
      btn('Focus', () => focusOn('column', c.id), { class: 'sm' }),
    ]);
    container.appendChild(section('Parameters', [
      field('X', numberInput(c.position.x, (v) => A.updateEntity('column', c.id, { position: { ...c.position, x: v } }))),
      field('Z', numberInput(c.position.z, (v) => A.updateEntity('column', c.id, { position: { ...c.position, z: v } }))),
      field('Shape', selectInput([{ value: 'rect', label: 'Rectangular' }, { value: 'round', label: 'Round' }], c.shape,
        (v) => A.updateEntity('column', c.id, { shape: v }))),
      c.shape === 'round'
        ? field('Radius', numberInput(c.radius, (v) => A.updateEntity('column', c.id, { radius: v }), { step: 0.05 }))
        : field('Width', numberInput(c.width, (v) => A.updateEntity('column', c.id, { width: v }), { step: 0.05 })),
      c.shape === 'rect' ? field('Depth', numberInput(c.depth, (v) => A.updateEntity('column', c.id, { depth: v }), { step: 0.05 })) : null,
      field('Structural', checkbox('Blocks cable routing', c.structural, (v) => A.updateEntity('column', c.id, { structural: v }))),
    ].filter(Boolean)));
    container.appendChild(h('div', { class: 'section-body' },
      btn('Delete', () => A.deleteEntity('column', c.id), { class: 'sm danger' })));
  }

  function renderStair(p, id) {
    const s = p.stairs.find((x) => x.id === id);
    if (!s) return;
    const from = getLevel(p, s.fromLevelId), to = getLevel(p, s.toLevelId);
    head('Stair', s.name, s.id, [badge(`${from?.shortName || '?'} → ${to?.shortName || '?'}`), s.placeholder ? badge('placeholder', 'ph') : null].filter(Boolean), [
      btn('Focus', () => focusOn('stair', s.id), { class: 'sm' }),
    ]);
    container.appendChild(section('Parameters', [
      field('Name', textInput(s.name, (v) => A.updateEntity('stair', s.id, { name: v }))),
      field('Origin X', numberInput(s.origin.x, (v) => A.updateEntity('stair', s.id, { origin: { ...s.origin, x: v } }))),
      field('Origin Z', numberInput(s.origin.z, (v) => A.updateEntity('stair', s.id, { origin: { ...s.origin, z: v } }))),
      field('Rotation °', numberInput(+(s.rotation * 180 / Math.PI).toFixed(0),
        (v) => A.updateEntity('stair', s.id, { rotation: v * Math.PI / 180 }), { step: 15 })),
      field('Width', numberInput(s.width, (v) => A.updateEntity('stair', s.id, { width: v }), { step: 0.05 })),
      field('Tread depth', numberInput(s.treadDepth, (v) => A.updateEntity('stair', s.id, { treadDepth: v }), { step: 0.01 })),
      field('Riser height', numberInput(s.riserHeight, (v) => A.updateEntity('stair', s.id, { riserHeight: v }), { step: 0.005 })),
      field('Landing depth', numberInput(s.landingDepth, (v) => A.updateEntity('stair', s.id, { landingDepth: v }), { step: 0.05 })),
      field('Flights', selectInput([{ value: '1', label: 'Straight' }, { value: '2', label: 'Half-landing' }], String(s.flights),
        (v) => A.updateEntity('stair', s.id, { flights: parseInt(v, 10) }))),
      h('div', { class: 'hint' }, 'Stairs are walkable in first-person mode and give cables a vertical route between levels.'),
    ]));
    container.appendChild(h('div', { class: 'section-body' },
      btn('Delete', () => A.deleteEntity('stair', s.id), { class: 'sm danger' })));
  }

  function renderSlab(p, id) {
    const s = p.slabs.find((x) => x.id === id);
    if (!s) return;
    head('Slab', s.name || s.kind, s.id, [badge(s.kind)], [btn('Focus', () => focusOn('slab', s.id), { class: 'sm' })]);
    container.appendChild(section('Parameters', [
      field('Name', textInput(s.name, (v) => A.updateEntity('slab', s.id, { name: v }))),
      field('Top elevation', numberInput(s.topElevation, (v) => A.updateEntity('slab', s.id, { topElevation: v }))),
      field('Thickness', numberInput(s.thickness, (v) => A.updateEntity('slab', s.id, { thickness: v }), { step: 0.01 })),
      field('Material', selectInput(p.materials.map((m) => ({ value: m.id, label: m.name })), s.materialId,
        (v) => A.updateEntity('slab', s.id, { materialId: v }))),
      kv([['Outline', `${s.polygon.length} vertices`], ['Holes', String((s.holes || []).length)]]),
      h('div', { class: 'hint' }, 'Holes are real voids — stairwells and riser shafts. Cables may pass through them between levels.'),
    ]));
    container.appendChild(h('div', { class: 'section-body' },
      btn('Delete', () => A.deleteEntity('slab', s.id), { class: 'sm danger' })));
  }

  bus.on(EV.SELECTION, render);
  bus.on(EV.PROJECT, render);
  render();
  return { render, neighbours, flattenChain, table };
}
