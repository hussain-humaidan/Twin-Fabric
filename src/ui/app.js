/**
 * Application shell — wires the 3D viewport, the tools and every panel
 * together, and owns cross-cutting concerns (menus, autosave, hints).
 */
import { h, clear, btn, badge } from './dom.js';
import {
  state, bus, EV, setProject, setTool, setView, select, clearSelection, clearHighlight,
  toast, markClean, focusOn, setMode,
} from '../core/store.js';
import * as A from '../model/actions.js';
import { invalidateIndex, getDevice, getSpace, getLevel, indexRev } from '../model/queries.js';
import { invalidateRouteGraph } from '../logic/router.js';
import { createViewport } from '../three/viewport.js';
import { createScene } from '../three/scene.js';
import { createTools } from '../three/tools.js';
import { createTopbar } from './topbar.js';
import { createStatusbar } from './statusbar.js';
import { createExplorer } from './explorer.js';
import { createLibrary } from './library.js';
import { createFilters } from './filters.js';
import { createInspector } from './inspector.js';
import { showToast, contextMenu, pickPort, openDialog, confirmDialog, promptDialog } from './dialogs.js';
import * as V from './views.js';
import { installShortcuts, SHORTCUTS } from './shortcuts.js';
import {
  saveProject, saveViewPrefs, fromJSON,
  saveNamed, loadNamed, listSaved, deleteSaved, storageBackend,
} from '../persist/io.js';
import { BUILDING_TEMPLATES, createFromTemplate } from '../model/templates/index.js';
import { makeIdFactory, debounce } from '../core/util.js';
import { catalogItem } from '../model/catalog.js';
import { PRODUCT } from '../app.config.js';

export function createApp() {
  /* ---------------- derived-cache invalidation ---------------- */
  bus.on(EV.PROJECT, () => { invalidateIndex(); invalidateRouteGraph(); });
  invalidateIndex();

  /* ---------------- 3D ---------------- */
  const viewportEl = document.getElementById('viewport');
  const viewport = createViewport(viewportEl, {
    onClipChange: () => { /* materials pick the planes up via MaterialLib */ },
  });
  const scene = createScene(viewport);
  const tools = createTools(viewport, scene);
  tools.setPortPicker((device, role, otherPort) => pickPort(device, role, otherPort));

  viewport.setWalkContext(state.project, indexRev());
  viewport.frameBox(scene.buildingBounds(), { instant: true, padding: 1.25 });

  /* ---------------- panels ---------------- */
  const leftTabs = document.getElementById('left-tabs');
  const leftBody = document.getElementById('left-body');
  const rightTabs = document.getElementById('right-tabs');
  const rightBody = document.getElementById('right-body');

  const leftPanes = {
    explorer: h('div'), library: h('div'), layers: h('div'),
  };
  let leftTab = 'explorer';
  function renderLeftTabs() {
    clear(leftTabs);
    for (const [key, label] of [['explorer', 'Building'], ['library', 'Library'], ['layers', 'Layers']]) {
      leftTabs.appendChild(h('button', {
        class: leftTab === key ? 'on' : '',
        onclick: () => { leftTab = key; renderLeftTabs(); showLeft(); },
      }, label));
    }
  }
  function showLeft() {
    clear(leftBody);
    leftBody.appendChild(leftPanes[leftTab]);
  }
  renderLeftTabs();
  showLeft();

  clear(rightTabs);
  rightTabs.appendChild(h('button', { class: 'on' }, 'Inspector'));
  rightTabs.appendChild(h('button', { onclick: () => openHelp() }, 'Help'));

  createExplorer(leftPanes.explorer);
  createLibrary(leftPanes.library);
  createFilters(leftPanes.layers);

  const ctx = {
    viewport,
    scene,
    tools: {
      beginCableFromPort: (deviceId, portId) => tools.beginCableFromPort(deviceId, portId),
      beginCableFrom: (deviceId) => { setTool('cable'); void deviceId; },
    },
    save, openSearch: V.openSearch, openInventory: V.openInventory, openTopology: V.openTopology,
    openLogical: V.openLogical, openTrace: V.openTrace, openAudit: V.openAudit,
    openFloorPlan: V.openFloorPlan,
    projectMenu, toggleWalk, clearHighlight,
    focusLibrary: () => { leftTab = 'library'; renderLeftTabs(); showLeft(); },
    refreshTopbar: () => topbar.render(),
  };

  createInspector(rightBody, ctx);
  const topbar = createTopbar(document.getElementById('topbar'), ctx);
  createStatusbar(document.getElementById('statusbar'), ctx);
  installShortcuts(ctx);

  /* ---------------- viewport overlay ---------------- */
  const overlayEl = document.getElementById('viewport-overlay');
  const hintEl = document.getElementById('tool-hint');

  function renderOverlay() {
    clear(overlayEl);
    const p = state.project;
    const v = state.view;

    const lvl = v.activeLevelId ? getLevel(p, v.activeLevelId) : null;
    overlayEl.appendChild(h('div', { class: 'vp-badge vp-tl' },
      `${lvl ? lvl.name : 'All floors'} · ${v.viewMode}${v.isolateLevel ? ' · isolated' : ''}${v.cutaway.on ? ` · cut @ ${v.cutaway.height.toFixed(2)} m` : ''}`));

    const active = p.cableTypes.filter((t) => v.cableTypes[t.id] !== false && p.cables.some((c) => c.typeId === t.id));
    if (active.length && v.layers.cables) {
      overlayEl.appendChild(h('div', { class: 'vp-badge vp-tr' },
        h('div', { class: 'legend' }, active.slice(0, 12).map((t) => h('div', { class: 'legend-row' },
          h('i', { style: { background: t.color } }),
          h('span', null, t.name),
          h('span', { style: { color: 'var(--dim)' } }, String(p.cables.filter((c) => c.typeId === t.id).length)))))));
    }

    if (viewport.isWalking) {
      overlayEl.appendChild(h('div', { class: 'vp-badge vp-bl' }, 'WALK · W A S D · Shift run · Esc exit'));
    } else {
      overlayEl.appendChild(h('div', { class: 'vp-badge vp-bl' }, 'Drag rotate · right-drag pan · wheel zoom'));
    }
  }

  bus.on('tool:hint', (text) => {
    if (!text) { hintEl.hidden = true; return; }
    hintEl.hidden = false;
    hintEl.innerHTML = `${text}`;
  });
  bus.on(EV.VIEW, renderOverlay);
  bus.on(EV.PROJECT, renderOverlay);
  renderOverlay();

  /* ---------------- drag & drop from the library ---------------- */
  viewportEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  viewportEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const templateId = e.dataTransfer.getData('text/plain');
    if (!templateId) return;
    setTool('device', { templateId });
    // Re-use the placement path by synthesising a click at the drop point.
    const evt = new PointerEvent('pointerup', { clientX: e.clientX, clientY: e.clientY, button: 0, bubbles: true });
    viewport.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { clientX: e.clientX, clientY: e.clientY, button: 0, bubbles: true }));
    viewport.renderer.domElement.dispatchEvent(evt);
  });

  /* ---------------- context menus ---------------- */
  tools.setContextMenuHandler(({ x, y, target }) => {
    if (!target) {
      contextMenu(x, y, [
        { label: 'Add cable', key: 'C', onClick: () => setTool('cable') },
        { label: 'Measure', key: 'M', onClick: () => setTool('measure') },
        '-',
        { label: 'Frame whole building', onClick: () => viewport.frameBox(scene.buildingBounds()) },
        { label: 'Clear selection', onClick: () => clearSelection() },
      ]);
      return;
    }
    if (target.kind === 'device') return deviceMenu(x, y, target.id);
    if (target.kind === 'cable') return cableMenu(x, y, target.id);
    if (target.kind === 'wall') return wallMenu(x, y, target.id);
    if (target.kind === 'space') return spaceMenu(x, y, target.id);
    contextMenu(x, y, [
      { label: 'Focus', onClick: () => focusOn(target.kind, target.id) },
      { label: 'Delete', danger: true, onClick: () => A.deleteEntity(target.kind, target.id) },
    ], { title: target.kind });
  });

  bus.on('ctx:device', ({ x, y, deviceId }) => deviceMenu(x, y, deviceId));
  bus.on('ctx:space', ({ x, y, spaceId }) => spaceMenu(x, y, spaceId));
  bus.on('ctx:level', ({ x, y, levelId }) => contextMenu(x, y, [
    { label: 'Isolate this floor', onClick: () => setView({ activeLevelId: levelId, isolateLevel: true }) },
    { label: 'Show all floors', onClick: () => setView({ isolateLevel: false }) },
    { label: 'Ghost', onClick: () => setView({ levelState: { ...state.view.levelState, [levelId]: 'ghost' } }) },
    { label: 'Hide', onClick: () => setView({ levelState: { ...state.view.levelState, [levelId]: 'hidden' } }) },
    '-',
    { label: 'Detect rooms from walls', onClick: () => A.detectRooms(levelId) },
    { label: 'Floor plan (2D)', onClick: () => { setView({ activeLevelId: levelId }); V.openFloorPlan(); } },
  ], { title: getLevel(state.project, levelId)?.name }));

  function deviceMenu(x, y, id) {
    const d = getDevice(state.project, id);
    if (!d) return;
    contextMenu(x, y, [
      { label: 'Select & focus', key: 'F', onClick: () => { select('device', id); focusOn('device', id); } },
      { label: 'Add cable from here', key: 'C', onClick: () => { select('device', id); setTool('cable'); } },
      { label: 'Show signal path', onClick: () => { select('device', id); bus.emit('device:signalPath', id); } },
      { label: 'Connection diagram', onClick: () => { select('device', id); bus.emit('device:diagram', id); } },
      '-',
      { label: 'Rotate 15°', key: 'R', onClick: () => A.updateEntity('device', id, { rotation: (d.rotation || 0) + Math.PI / 12 }) },
      { label: d.rackId ? 'Remove from rack' : 'Mount in rack…', onClick: () => {
        if (d.rackId) A.unmountFromRack(id);
        else if (state.project.racks.length) A.mountInRack(id, state.project.racks[0].id);
        else toast('No racks in the project yet — place one from the Library.', 'warn');
      } },
      { label: 'Duplicate', onClick: () => { const c = A.duplicateDevice(id); if (c) select('device', c.id); } },
      '-',
      { label: 'Delete', key: 'Del', danger: true, onClick: async () => {
        if (await confirmDialog(`Delete ${d.name}?`, { danger: true, confirmLabel: 'Delete' })) A.deleteDevice(id);
      } },
    ], { title: d.name });
  }

  function cableMenu(x, y, id) {
    const c = state.project.cables.find((z) => z.id === id);
    if (!c) return;
    contextMenu(x, y, [
      { label: 'Select & focus', onClick: () => { select('cable', id); focusOn('cable', id); } },
      { label: 'Show endpoints', onClick: () => {
        const a = getDevice(state.project, c.from?.deviceId);
        if (a) { select('device', a.id); focusOn('device', a.id); }
      } },
      { label: 'Highlight full path', onClick: () => { select('cable', id); bus.emit('cable:path', id); } },
      '-',
      { label: 'Auto re-route', onClick: () => A.rerouteCable(id) },
      { label: 'Duplicate', onClick: () => { const n = A.duplicateCable(id); if (n) select('cable', n.id); } },
      '-',
      { label: 'Delete', danger: true, onClick: () => A.deleteCable(id) },
    ], { title: c.id });
  }

  function wallMenu(x, y, id) {
    contextMenu(x, y, [
      { label: 'Select', onClick: () => select('wall', id) },
      { label: 'Add door', onClick: () => { setMode('building'); setTool('door'); } },
      { label: 'Add window', onClick: () => { setMode('building'); setTool('window'); } },
      { label: 'Add cable penetration', onClick: () => { setMode('building'); setTool('penetration'); } },
      '-',
      { label: 'Delete wall', danger: true, onClick: () => A.deleteWall(id) },
    ], { title: 'Wall' });
  }

  function spaceMenu(x, y, id) {
    const s = getSpace(state.project, id);
    if (!s) return;
    contextMenu(x, y, [
      { label: 'Select & focus', onClick: () => { select('space', id); focusOn('space', id); } },
      { label: 'Rename…', onClick: async () => {
        const name = await promptDialog('Room name', s.name, { title: `Rename ${s.code || s.id}` });
        if (name) A.updateEntity('space', id, { name });
      } },
      { label: 'Change code…', onClick: async () => {
        const code = await promptDialog('Room code', s.code, { title: 'Room code' });
        if (code != null) A.updateEntity('space', id, { code });
      } },
      '-',
      { label: 'Isolate this floor', onClick: () => setView({ activeLevelId: s.levelId, isolateLevel: true }) },
      { label: 'Add equipment here', onClick: () => { leftTab = 'library'; renderLeftTabs(); showLeft(); } },
    ], { title: s.name });
  }

  bus.on('device:signalPath', () => { /* inspector renders it; keep hook for future */ });

  /* ---------------- project menu ---------------- */
  function projectMenu(e) {
    contextMenu(e.clientX, e.clientY + 6, [
      { label: 'Save', key: 'Ctrl S', onClick: save },
      { label: 'Save as named copy…', onClick: saveAs },
      { label: 'Open saved copy…', onClick: openSaved },
      '-',
      { label: 'Export project JSON', onClick: V.openExport },
      { label: 'Import project JSON…', onClick: () => V.openImport(importJSON) },
      '-',
      { label: 'Cable schedule (CSV)', onClick: () => V.openInventory('cables') },
      { label: 'Equipment schedule (CSV)', onClick: () => V.openInventory('devices') },
      '-',
      { label: 'New project from template…', onClick: newFromTemplate },
      { label: 'Clear all equipment & cables', danger: true, onClick: async () => {
        if (await confirmDialog('Remove every device, rack and cable? The building geometry is kept.', { danger: true, confirmLabel: 'Clear' })) {
          A.clearInfrastructure();
        }
      } },
      '-',
      { label: 'Keyboard shortcuts', onClick: openHelp },
    ], { title: 'Project' });
  }

  async function save() {
    if (await saveProject(state.project)) {
      markClean();
      toast(`Project saved (${storageBackend() === 'indexeddb' ? 'IndexedDB' : 'local storage'}).`, 'ok');
    } else {
      toast('Could not save — browser storage is unavailable. Export the project instead.', 'err', 7000);
    }
  }

  async function saveAs() {
    const name = await promptDialog('Copy name', `${state.project.name} copy`, { title: 'Save a named copy' });
    if (!name) return;
    if (await saveNamed(name, state.project)) toast(`Saved as "${name}".`, 'ok');
    else toast('Save failed — storage may be full.', 'err');
  }

  async function openSaved() {
    const slots = await listSaved();
    if (!slots.length) { toast('No saved copies yet.', 'warn'); return; }
    const dlg = openDialog({
      title: 'Open a saved copy', size: 'sm',
      body: h('div', { class: 'ports' }, slots.map((s) => h('div', {
        class: 'port',
        onclick: async () => {
          const p = await loadNamed(s.name);
          if (!p) { toast('Could not read that copy.', 'err'); return; }
          dlg.close();
          setProject(p, { label: `Open ${s.name}` });
          viewport.frameBox(scene.buildingBounds(), { instant: true });
          toast(`Opened "${s.name}".`, 'ok');
        },
      },
      h('span', { class: 'dir' }, '▤'),
      h('span', { class: 'pn' }, s.name),
      h('span', { class: 'conn' },
        `${s.counts ? `${s.counts.devices} devices · ${s.counts.cables} cables · ` : ''}${s.modifiedAt ? new Date(s.modifiedAt).toLocaleString() : ''}`),
      h('button', {
        class: 'btn sm ghost',
        title: 'Delete this copy',
        onclick: async (ev) => {
          ev.stopPropagation();
          await deleteSaved(s.name);
          dlg.close();
          toast(`Deleted "${s.name}".`, 'ok');
        },
      }, '✕')))),
      footer: [btn('Close', () => dlg.close())],
    });
  }

  function importJSON(text) {
    const res = fromJSON(text);
    if (!res.ok) { toast(res.error, 'err', 8000); return; }
    setProject(res.project, { label: 'Import project' });
    viewport.frameBox(scene.buildingBounds(), { instant: true });
    for (const w of res.warnings) toast(w, 'warn', 7000);
    toast('Project imported.', 'ok');
  }

  async function newFromTemplate() {
    let tid = BUILDING_TEMPLATES[0].id;
    const nameInput = h('input', { type: 'text', value: '', placeholder: 'e.g. Matam Infrastructure Project' });
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());

    const list = h('div', { class: 'ports' }, BUILDING_TEMPLATES.map((t) => h('div', {
      class: `port${tid === t.id ? ' sel' : ''}`,
      style: { alignItems: 'flex-start' },
      onclick: (ev) => {
        tid = t.id;
        ev.currentTarget.parentElement.querySelectorAll('.port').forEach((n) => n.classList.remove('sel'));
        ev.currentTarget.classList.add('sel');
      },
    },
    h('span', { class: 'dir' }, '▤'),
    h('span', { class: 'pn', style: { whiteSpace: 'normal' } },
      h('div', null, t.name),
      h('div', { class: 'hint', style: { marginTop: '2px' } }, t.summary)),
    badge(t.category))));

    const dlg = openDialog({
      title: 'New project', size: 'sm',
      body: h('div', null,
        h('div', { class: 'hint', style: { marginBottom: '9px' } },
          `${PRODUCT.name} is generic. A template just fills a project with geometry — everything is editable afterwards.`),
        h('div', { class: 'field wide' }, h('label', null, 'Project name'), nameInput),
        h('div', { class: 'sp' }),
        h('div', { class: 'hint', style: { marginBottom: '4px' } }, 'Start from'),
        list),
      footer: [
        btn('Cancel', () => dlg.close()),
        btn('Create', async () => {
          dlg.close();
          if (!(await confirmDialog('Replace the current project? Export it first if you need it.', { danger: true, confirmLabel: 'Replace' }))) return;
          const ids = makeIdFactory({});
          const tpl = BUILDING_TEMPLATES.find((t) => t.id === tid);
          const p = createFromTemplate(tid, ids);
          const chosen = nameInput.value.trim();
          if (chosen) { p.name = chosen; }
          else if (!p.name) { p.name = `${tpl.name} project`; }
          setProject(p, { label: 'New project' });
          viewport.frameBox(scene.buildingBounds(), { instant: true });
          toast(`Project "${p.name}" created from the ${tpl.name} template.`, 'ok');
        }, { class: 'primary' }),
      ],
    });
  }

  function openHelp() {
    const dlg = openDialog({
      title: 'Matam Digital Twin — help', size: 'md',
      body: h('div', null,
        h('div', { class: 'hint', style: { marginBottom: '10px' } },
          'Coordinate system: Y up, +X east, +Z south, 1 unit = 1 metre. Every dimension in the seeded building is a PLACEHOLDER — edit it in the Inspector.'),
        h('h3', { style: { fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px' } }, 'WORKFLOW'),
        h('ol', { style: { margin: '0 0 12px', paddingLeft: '18px', fontSize: '11.5px', lineHeight: 1.6 } },
          h('li', null, 'Building mode: draw walls, rooms and halls, cut doors, windows and cable penetrations, place columns and stairs.'),
          h('li', null, 'Run “Detect rooms” on a level to re-derive room outlines from the wall geometry.'),
          h('li', null, 'Draw cable trays and risers — the router prefers them over free air.'),
          h('li', null, 'Place equipment from the Library, then press ADD CABLE and click source → destination.'),
          h('li', null, 'Use X-Ray, Cut and floor isolation to trace cables between floors.')),
        h('h3', { style: { fontSize: '11px', color: 'var(--muted)', margin: '0 0 6px' } }, 'SHORTCUTS'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '3px 10px', fontSize: '11.5px' } },
          SHORTCUTS.flatMap(([k, v]) => [
            h('span', { style: { fontFamily: 'var(--mono)', color: 'var(--select)' } }, k),
            h('span', { style: { color: 'var(--muted)' } }, v),
          ])),
        // AGPL section 13: anyone using this over a network must be able to
        // reach the corresponding source. This link is that offer.
        h('div', { style: { marginTop: '16px', paddingTop: '10px', borderTop: '1px solid var(--line)' } },
          h('div', { class: 'hint' },
            `${PRODUCT.name} ${PRODUCT.version} — ${PRODUCT.copyright}.`),
          h('div', { class: 'hint', style: { marginTop: '3px' } },
            'Free software under the ',
            h('a', {
              href: 'https://www.gnu.org/licenses/agpl-3.0.html',
              target: '_blank', rel: 'noopener noreferrer',
              style: { color: 'var(--accent)' },
            }, 'GNU AGPL v3.0'),
            '. Source: ',
            h('a', {
              href: PRODUCT.sourceUrl, target: '_blank', rel: 'noopener noreferrer',
              style: { color: 'var(--accent)' },
            }, PRODUCT.sourceUrl),
            '. If you run a modified version for other people, you must offer them its source.'))),
      footer: [btn('Close', () => dlg.close(), { class: 'primary' })],
    });
  }

  function toggleWalk() {
    const walking = viewport.isWalking;
    if (walking) {
      viewport.setNavMode('orbit');
    } else {
      const lvl = state.view.activeLevelId ? getLevel(state.project, state.view.activeLevelId) : state.project.levels[0];
      const sel = state.selection[state.selection.length - 1];
      let start = null;
      if (sel) {
        const box = scene.boundsFor(sel.kind, sel.id);
        if (box && !box.isEmpty()) {
          start = {
            x: (box.min.x + box.max.x) / 2,
            y: (lvl?.elevation ?? 0) + 1.7,
            z: (box.min.z + box.max.z) / 2 + 3,
          };
        }
      }
      viewport.setNavMode('walk', { project: state.project, rev: indexRev(), start });
      toast('Walkthrough: W A S D to move, mouse to look, Shift to run, Esc to exit.', 'info', 6000);
    }
    topbar.render();
    renderOverlay();
  }

  /* ---------------- autosave ---------------- */
  const autosave = debounce(async () => {
    if (await saveProject(state.project)) markClean();
    saveViewPrefs(state.view);
  }, 2500);
  bus.on(EV.PROJECT, autosave);
  bus.on(EV.VIEW, () => saveViewPrefs(state.view));
  // IndexedDB writes cannot complete during unload, so flush on the last
  // moment the page is reliably still alive instead.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autosave.flush();
  });
  window.addEventListener('pagehide', () => { autosave.flush(); });
  // Boot emits its project event before this listener exists, so a freshly
  // generated project would never be written until the first edit. Persist it
  // once on startup so a reload picks up what is already on screen.
  autosave();

  /* ---------------- toasts ---------------- */
  bus.on(EV.TOAST, showToast);

  /* ---------------- ready ---------------- */
  const boot = document.getElementById('boot');
  if (boot) boot.hidden = true;

  return { viewport, scene, tools, ctx, catalogItem, badge };
}
