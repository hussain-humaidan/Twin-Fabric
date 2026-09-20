/**
 * Layers, cable filters, scenarios and view settings.
 * This is the clutter-management panel: with thousands of cables the only way
 * to stay sane is to switch categories off.
 */
import { h, clear, checkbox, section, btn, colorInput, numberInput, selectInput, badge, bar } from './dom.js';
import { state, bus, EV, setView, toast } from '../core/store.js';
import { SIGNALS } from '../model/signals.js';
import { CABLE_STATUS, DEVICE_STATUS } from '../model/schema.js';
import * as A from '../model/actions.js';
import { pathwayUtilisation } from '../model/queries.js';
import { promptDialog } from './dialogs.js';

const LAYER_LABELS = {
  architecture: 'Architecture (walls)',
  structure: 'Structure (slabs, columns)',
  ceilings: 'Ceilings',
  roof: 'Roof',
  doors: 'Doors',
  windows: 'Windows',
  stairs: 'Stairs',
  spaces: 'Room plates',
  equipment: 'Equipment',
  racks: 'Racks',
  pathways: 'Cable trays / conduits',
  cables: 'Cables',
  labels: 'Labels',
};

export function createFilters(container) {
  function render() {
    const p = state.project;
    if (!p) return;
    clear(container);
    const v = state.view;

    /* ---------------- layers ---------------- */
    container.appendChild(section('Visual layers',
      Object.keys(LAYER_LABELS).map((k) => checkbox(LAYER_LABELS[k], v.layers[k] !== false,
        (val) => setView({ layers: { ...v.layers, [k]: val } }))),
      { count: Object.values(v.layers).filter(Boolean).length }));

    /* ---------------- cable types ---------------- */
    const byCategory = new Map();
    for (const t of p.cableTypes) {
      if (!byCategory.has(t.category)) byCategory.set(t.category, []);
      byCategory.get(t.category).push(t);
    }
    const counts = new Map();
    for (const c of p.cables) counts.set(c.typeId, (counts.get(c.typeId) || 0) + 1);

    const cableBody = [];
    cableBody.push(h('div', { class: 'row', style: { marginBottom: '6px' } },
      btn('All', () => setAllTypes(true), { class: 'sm' }),
      btn('None', () => setAllTypes(false), { class: 'sm' }),
      h('span', { class: 'grow' }),
      h('span', { class: 'hint' }, `${p.cables.length} cables`)));

    for (const [cat, list] of byCategory) {
      cableBody.push(h('div', { class: 'hint', style: { margin: '7px 0 2px' } }, cat));
      for (const t of list) {
        const swatch = colorInput(t.color, (col) => A.updateCableType(t.id, { color: col }));
        swatch.style.width = '22px';
        swatch.style.height = '15px';
        swatch.title = `${t.name} colour — editable`;
        cableBody.push(h('div', { class: 'row' },
          checkbox(t.name, v.cableTypes[t.id] !== false,
            (val) => setView({ cableTypes: { ...v.cableTypes, [t.id]: val } })),
          h('span', { class: 'grow' }),
          h('span', { class: 'cd', style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--dim)' } },
            String(counts.get(t.id) || 0)),
          swatch));
      }
    }
    cableBody.push(h('div', { class: 'sp' }));
    cableBody.push(btn('＋ New cable type', async () => {
      const t = A.addCableType({ name: 'New cable type' });
      if (t) toast(`${t.name} added — set its connector family and colour in Settings.`, 'ok');
    }, { class: 'sm' }));
    container.appendChild(section('Cable types', cableBody, { count: p.cableTypes.length }));

    /* ---------------- signal classes ---------------- */
    container.appendChild(section('Signal classes',
      Object.values(SIGNALS).map((s) => h('div', { class: 'row' },
        h('i', { style: { width: '10px', height: '3px', background: s.color, borderRadius: '2px', display: 'block' } }),
        checkbox(s.label, v.signalFilter[s.id] !== false,
          (val) => setView({ signalFilter: { ...v.signalFilter, [s.id]: val } })))),
      { open: false }));

    /* ---------------- status ---------------- */
    const statuses = Array.from(new Set([...CABLE_STATUS, ...DEVICE_STATUS]));
    container.appendChild(section('Status',
      statuses.map((s) => checkbox(s[0].toUpperCase() + s.slice(1), v.statusFilter[s] !== false,
        (val) => setView({ statusFilter: { ...v.statusFilter, [s]: val } }))),
      { open: false }));

    /* ---------------- scenarios ---------------- */
    const scenarioBody = [
      selectInput(p.scenarios.map((s) => ({ value: s.id, label: s.name })), v.scenarioId,
        (id) => setView({ scenarioId: id })),
      h('div', { class: 'hint', style: { margin: '6px 0' } },
        'A scenario layers on top of its base. Event or future equipment lives in its own scenario and never disturbs the permanent installation.'),
    ];
    const current = p.scenarios.find((s) => s.id === v.scenarioId);
    if (current) {
      const devCount = p.devices.filter((d) => d.scenarioId === current.id).length;
      const cabCount = p.cables.filter((c) => c.scenarioId === current.id).length;
      scenarioBody.push(h('div', { class: 'row wrap' },
        badge(current.kind), h('span', { class: 'hint' }, `${devCount} devices · ${cabCount} cables in this layer`)));
      if (current.notes) scenarioBody.push(h('div', { class: 'hint' }, current.notes));
    }
    scenarioBody.push(h('div', { class: 'sp' }));
    scenarioBody.push(h('div', { class: 'row' },
      btn('＋ Scenario', async () => {
        const name = await promptDialog('Scenario name', 'New scenario',
          { title: 'New scenario', placeholder: 'Muharram setup, Event 01, Future AV…' });
        if (!name) return;
        const s = A.addScenario({ name, kind: 'event' });
        if (s) { setView({ scenarioId: s.id }); toast(`Scenario "${name}" created and made active.`, 'ok'); }
      }, { class: 'sm' }),
      current && current.id !== 'SCENARIO-PERMANENT'
        ? btn('Delete', () => A.deleteScenario(current.id), { class: 'sm danger' }) : null));
    container.appendChild(section('Scenarios / layers', scenarioBody, { count: p.scenarios.length }));

    /* ---------------- tray utilisation ---------------- */
    if (p.pathways.length) {
      container.appendChild(section('Containment utilisation',
        p.pathways.map((pw) => {
          const u = pathwayUtilisation(p, pw);
          return h('div', { style: { marginBottom: '7px' } },
            h('div', { class: 'row' },
              h('span', { class: 'grow', style: { fontSize: '11px' } }, pw.name),
              h('span', { class: 'hint' }, `${u.used}/${u.capacity}`)),
            bar(Math.max(u.ratio, u.fillRatio), { title: `${u.used} cables · ${(u.fillRatio * 100).toFixed(0)}% cross-section fill` }));
        }), { open: false, count: p.pathways.length }));
    }

    /* ---------------- view settings ---------------- */
    container.appendChild(section('View settings', [
      checkbox('Show grid', v.grid.show, (val) => setView({ grid: { ...v.grid, show: val } })),
      checkbox('Snap to grid', v.grid.snap, (val) => setView({ grid: { ...v.grid, snap: val } })),
      checkbox('Snap to wall corners', v.grid.snapVertex, (val) => setView({ grid: { ...v.grid, snapVertex: val } })),
      h('div', { class: 'field' }, h('label', null, 'Grid size (m)'),
        numberInput(v.grid.size, (val) => setView({ grid: { ...v.grid, size: Math.max(0.01, val) } }), { step: 0.05 })),
      h('div', { class: 'sp' }),
      checkbox('Show labels', v.labels.show, (val) => setView({ labels: { ...v.labels, show: val } })),
      checkbox('Device labels', v.labels.devices, (val) => setView({ labels: { ...v.labels, devices: val } })),
      checkbox('Room labels', v.labels.spaces, (val) => setView({ labels: { ...v.labels, spaces: val } })),
      h('div', { class: 'field' }, h('label', null, 'Label range (m)'),
        numberInput(v.labels.maxDistance, (val) => setView({ labels: { ...v.labels, maxDistance: val } }), { step: 5 })),
      h('div', { class: 'sp' }),
      checkbox('Cutaway plane', v.cutaway.on, (val) => setView({ cutaway: { ...v.cutaway, on: val } })),
      h('div', { class: 'field' }, h('label', null, 'Cut height (m)'),
        numberInput(v.cutaway.height, (val) => setView({ cutaway: { ...v.cutaway, height: val } }), { step: 0.25 })),
    ], { open: false }));

    /* ---------------- routing preferences ---------------- */
    const r = p.settings.routing;
    container.appendChild(section('Routing preferences', [
      h('div', { class: 'hint', style: { marginBottom: '6px' } },
        'Costs the router balances. Lower means "prefer this".'),
      checkbox('Cables may pass through doors', r.allowDoorRouting,
        (val) => A.updateSettings({ routing: { allowDoorRouting: val } })),
      checkbox('Allow free-air runs', r.allowFreeAir,
        (val) => A.updateSettings({ routing: { allowFreeAir: val } })),
      h('div', { class: 'field' }, h('label', null, 'Free-air cost'),
        numberInput(r.freeAirCost, (val) => A.updateSettings({ routing: { freeAirCost: val } }), { step: 0.1 })),
      h('div', { class: 'field' }, h('label', null, 'Opening cost'),
        numberInput(r.openingCost, (val) => A.updateSettings({ routing: { openingCost: val } }), { step: 0.05 })),
      h('div', { class: 'field' }, h('label', null, 'Drop / riser cost'),
        numberInput(r.dropCost, (val) => A.updateSettings({ routing: { dropCost: val } }), { step: 0.05 })),
      h('div', { class: 'field' }, h('label', null, 'Service loop (m)'),
        numberInput(r.serviceLoop, (val) => A.updateSettings({ routing: { serviceLoop: val } }), { step: 0.1 })),
      h('div', { class: 'sp' }),
      btn('Re-route all auto cables', () => A.rerouteAll(), { class: 'sm primary' }),
    ], { open: false }));

    function setAllTypes(on) {
      const next = {};
      for (const t of p.cableTypes) next[t.id] = on;
      setView({ cableTypes: next });
    }
  }

  bus.on(EV.PROJECT, render);
  bus.on(EV.VIEW, render);
  render();
  return { render };
}
