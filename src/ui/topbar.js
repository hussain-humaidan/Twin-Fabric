/** Top command bar: project, mode, view, camera, floors and the primary tools. */
import { h, clear, btn, seg } from './dom.js';
import {
  state, bus, EV, setView, setMode, setTool, undo, redo, canUndo, canRedo, toast, focusOn,
} from '../core/store.js';
import { levelOrder } from '../model/queries.js';
import { VIEW_MODES } from '../three/materials.js';
import { contextMenu, promptDialog } from './dialogs.js';
import { PRODUCT } from '../app.config.js';
import * as A from '../model/actions.js';

export function createTopbar(container, ctx) {
  function render() {
    const p = state.project;
    if (!p) return;
    clear(container);
    const v = state.view;

    /* brand: the product, then the project (not the building) */
    container.appendChild(h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', title: PRODUCT.tagline }, PRODUCT.mark),
      h('span', { class: 'brand-name' }, PRODUCT.name),
      h('span', {
        class: 'brand-proj',
        title: `Project: ${p.name}\nBuilding: ${p.building.name}\nClick to rename the project`,
        style: { cursor: 'pointer' },
        onclick: async () => {
          const n = await promptDialog('Project name', p.name, { title: 'Rename project' });
          if (n) A.updateProjectMeta({ name: n });
        },
      }, p.name)));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* project menu */
    container.appendChild(btn('Project ▾', (e) => ctx.projectMenu(e), { class: 'sm' }));
    container.appendChild(btn('⤺', () => undo(), { class: 'sm icon', title: 'Undo (Ctrl+Z)', disabled: !canUndo() }));
    container.appendChild(btn('⤻', () => redo(), { class: 'sm icon', title: 'Redo (Ctrl+Shift+Z)', disabled: !canRedo() }));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* mode */
    container.appendChild(h('span', { class: 'tb-label' }, 'Mode'));
    container.appendChild(seg([
      { value: 'building', label: 'Building', title: 'Edit walls, rooms, doors, stairs' },
      { value: 'infrastructure', label: 'Infra', title: 'Everything' },
      { value: 'av', label: 'AV', title: 'Video, audio and control only' },
      { value: 'network', label: 'Net', title: 'Network, fibre and KVM only' },
      { value: 'power', label: 'Power', title: 'AC/DC distribution only' },
      { value: 'routing', label: 'Routing', title: 'Trays, shafts and cable paths' },
    ], v.mode, (m) => setMode(m)));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* view mode */
    container.appendChild(h('span', { class: 'tb-label' }, 'View'));
    container.appendChild(seg(
      Object.entries(VIEW_MODES).map(([k, m]) => ({ value: k, label: m.label, title: m.hint })),
      v.viewMode, (m) => setView({ viewMode: m })));

    container.appendChild(btn(v.cutaway.on ? 'Cut ✓' : 'Cut', () => setView({ cutaway: { ...v.cutaway, on: !v.cutaway.on } }),
      { class: `sm${v.cutaway.on ? ' on' : ''}`, title: 'Cutaway plane — slice the building horizontally' }));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* camera */
    container.appendChild(h('span', { class: 'tb-label' }, 'Camera'));
    container.appendChild(seg([
      { value: 'persp', label: '3D' }, { value: 'top', label: 'Plan' },
      { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'iso', label: 'Iso' },
    ], ctx.viewport.preset, (c) => { ctx.viewport.setPreset(c); render(); }));
    container.appendChild(btn(ctx.viewport.isWalking ? 'Exit walk' : 'Walk', () => ctx.toggleWalk(),
      { class: `sm${ctx.viewport.isWalking ? ' on' : ''}`, title: 'First-person walkthrough (W A S D, Shift to run, Esc to exit)' }));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* floors */
    container.appendChild(h('span', { class: 'tb-label' }, 'Floor'));
    const levels = levelOrder(p);
    container.appendChild(seg([
      { value: '', label: 'All' },
      ...levels.map((l) => ({ value: l.id, label: l.shortName, title: l.name })),
    ], v.activeLevelId || '', (id) => {
      setView({ activeLevelId: id || null, isolateLevel: id ? v.isolateLevel : false });
      if (id) focusOn('level', id);
    }));
    container.appendChild(btn(v.isolateLevel ? 'Isolate ✓' : 'Isolate', () => {
      if (!v.activeLevelId) { toast('Pick a floor first.', 'warn'); return; }
      setView({ isolateLevel: !v.isolateLevel });
    }, { class: `sm${v.isolateLevel ? ' on' : ''}`, title: 'Show only the selected floor' }));

    container.appendChild(h('div', { class: 'tb-sep' }));

    /* primary tools */
    container.appendChild(btn('ADD CABLE', () => {
      setTool(v.tool === 'cable' ? 'select' : 'cable', { manualRoute: false });
    }, { class: `primary${v.tool === 'cable' ? ' on' : ''}`, kbd: 'C', title: 'Click a source device, choose its port, then click the destination' }));
    container.appendChild(btn('Route by hand', () => setTool('cable', { manualRoute: true }),
      { class: 'sm', title: 'Draw the physical path point by point' }));
    container.appendChild(btn('Measure', () => setTool(v.tool === 'measure' ? 'select' : 'measure'),
      { class: `sm${v.tool === 'measure' ? ' on' : ''}`, kbd: 'M' }));
    container.appendChild(btn('Trace path', () => ctx.openTrace(), { class: 'sm', title: 'Trace the signal chain between two devices' }));

    container.appendChild(h('div', { class: 'tb-sep' }));

    container.appendChild(btn('Search', () => ctx.openSearch(), { class: 'sm', kbd: 'Ctrl K' }));
    container.appendChild(btn('Inventory', (e) => {
      contextMenu(e.clientX, e.clientY - 10, [
        { label: 'Equipment inventory', onClick: () => ctx.openInventory('devices') },
        { label: 'Cable schedule', onClick: () => ctx.openInventory('cables') },
        { label: 'Room schedule', onClick: () => ctx.openInventory('rooms') },
        { label: 'Port schedule', onClick: () => ctx.openInventory('ports') },
        '-',
        { label: 'Network topology', onClick: () => ctx.openTopology('network') },
        { label: 'Power distribution', onClick: () => ctx.openTopology('power') },
        { label: '2D logical infrastructure map', onClick: () => ctx.openLogical() },
        '-',
        { label: 'Project audit', onClick: () => ctx.openAudit() },
      ], { title: 'Views' });
    }, { class: 'sm' }));

    container.appendChild(h('div', { class: 'grow' }));
  }

  bus.on(EV.VIEW, render);
  bus.on(EV.TOOL, render);
  bus.on(EV.PROJECT, render);
  render();
  return { render };
}
