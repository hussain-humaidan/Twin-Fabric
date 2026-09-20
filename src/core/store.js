/**
 * Application state container.
 *
 * Holds two very different things and keeps them apart on purpose:
 *   state.project — the persisted digital-twin document (plain JSON, portable)
 *   state.view    — ephemeral view/editor state (never saved with the project)
 *
 * All project mutations go through commit(), which snapshots for undo and
 * emits a scoped change event so only affected render layers rebuild.
 */
import { createBus, deepClone, makeIdFactory } from './util.js';

export const bus = createBus();

export const EV = {
  PROJECT: 'project',        // { label, scope:Set<string> }
  SELECTION: 'selection',
  HOVER: 'hover',
  VIEW: 'view',
  TOOL: 'tool',
  STATUS: 'status',
  TOAST: 'toast',
  FOCUS: 'focus',            // request camera focus { kind, id }
  DIRTY: 'dirty',
};

/** Render scopes — commit() declares which caches a change invalidates. */
export const SCOPE = {
  ARCH: 'arch',          // walls, slabs, stairs, columns, openings
  SPACES: 'spaces',
  DEVICES: 'devices',
  CABLES: 'cables',
  PATHWAYS: 'pathways',
  RACKS: 'racks',
  META: 'meta',          // names, scenarios, settings, cable types
  ROUTEGRAPH: 'routegraph',
  ALL: 'all',
};

const MAX_HISTORY = 60;

export const state = {
  project: null,
  ids: makeIdFactory({}),

  past: [],
  future: [],
  dirty: false,
  savedAt: null,

  selection: [],          // [{ kind, id }]
  hover: null,            // { kind, id }
  highlight: {            // derived emphasis (signal path trace etc.)
    cables: new Set(),
    devices: new Set(),
    label: null,
  },

  view: {
    mode: 'building',           // building | infrastructure | av | network | power | routing
    tool: 'select',
    viewMode: 'normal',         // normal | xray | infrastructure | wireframe
    camera: 'persp',            // persp | top | front | side | plan
    navMode: 'orbit',           // orbit | walk
    activeLevelId: null,        // null = whole building
    isolateLevel: false,
    levelState: {},             // levelId -> 'visible' | 'ghost' | 'hidden'
    cutaway: { on: false, height: 3.0 },
    grid: { show: true, size: 0.25, snap: true, snapVertex: true, snapSurface: true },
    labels: { show: true, devices: true, spaces: true, cables: false, maxDistance: 45 },
    layers: {
      architecture: true, structure: true, ceilings: false, roof: true,
      doors: true, windows: true, stairs: true, spaces: true,
      equipment: true, racks: true, pathways: true, cables: true, labels: true,
    },
    cableTypes: {},             // cableTypeId -> bool (built from project on load)
    signalFilter: { video: true, audio: true, network: true, power: true, control: true, kvm: true, data: true },
    statusFilter: { active: true, installed: true, planned: true, faulty: true, disconnected: true, reserved: true, removed: false, maintenance: true, inactive: true },
    scenarioId: 'SCENARIO-PERMANENT',
    scenarioCompare: null,
    measure: null,              // { a, b, distance }
  },

  /** Transient tool state (draw-wall chain, pending cable, etc.). */
  toolState: {},

  /** Last cursor readout for the status bar. */
  cursor: { x: 0, y: 0, z: 0, spaceId: null, levelId: null },
};

/* ------------------------------------------------------------------ */
/* project lifecycle                                                   */
/* ------------------------------------------------------------------ */

export function setProject(project, { resetHistory = true, label = 'Load project' } = {}) {
  state.project = project;
  state.ids = makeIdFactory(project.idCounters || {});
  project.idCounters = state.ids.counters;
  if (resetHistory) { state.past.length = 0; state.future.length = 0; }
  state.selection = [];
  state.hover = null;
  clearHighlight();
  syncViewToProject();
  bus.emit(EV.PROJECT, { label, scope: new Set([SCOPE.ALL]) });
  bus.emit(EV.SELECTION, state.selection);
}

/** Rebuild view-state maps that depend on the loaded document. */
export function syncViewToProject() {
  const p = state.project;
  if (!p) return;
  const ct = {};
  for (const t of p.cableTypes) ct[t.id] = state.view.cableTypes[t.id] !== false;
  state.view.cableTypes = ct;
  const ls = {};
  for (const l of p.levels) ls[l.id] = state.view.levelState[l.id] || 'visible';
  state.view.levelState = ls;
  if (state.view.activeLevelId && !ls[state.view.activeLevelId]) state.view.activeLevelId = null;
  if (!p.scenarios.some((s) => s.id === state.view.scenarioId)) {
    state.view.scenarioId = p.scenarios[0]?.id || null;
  }
}

/* ------------------------------------------------------------------ */
/* mutation + history                                                  */
/* ------------------------------------------------------------------ */

let txDepth = 0;
let txScope = null;
let txLabel = '';

/**
 * Apply a change to the project document.
 * @param {string} label  undo label shown in the UI
 * @param {(project, ids) => (void|string[])} fn  mutator; may return extra scopes
 * @param {string[]} scope  render scopes invalidated by this change
 */
export function commit(label, fn, scope = [SCOPE.ALL]) {
  if (!state.project) return;
  if (txDepth > 0) {
    // Nested commit inside a transaction: apply without its own snapshot.
    const extra = fn(state.project, state.ids) || [];
    for (const s of [...scope, ...extra]) txScope.add(s);
    return;
  }
  pushHistory();
  const extra = fn(state.project, state.ids) || [];
  const s = new Set([...scope, ...extra]);
  markDirty();
  bus.emit(EV.PROJECT, { label, scope: s });
}

/** Group several commits into one undo step. */
export function transaction(label, fn, scope = [SCOPE.ALL]) {
  if (txDepth === 0) {
    pushHistory();
    txScope = new Set(scope);
    txLabel = label;
  }
  txDepth++;
  try {
    fn(state.project, state.ids);
  } finally {
    txDepth--;
    if (txDepth === 0) {
      const s = txScope; txScope = null;
      markDirty();
      bus.emit(EV.PROJECT, { label: txLabel, scope: s });
    }
  }
}

/**
 * Mutate without creating an undo entry — for live drags.
 * Call pushHistory() once before the drag begins.
 */
export function mutateLive(fn, scope = [SCOPE.ALL]) {
  if (!state.project) return;
  fn(state.project, state.ids);
  markDirty();
  bus.emit(EV.PROJECT, { label: null, scope: new Set(scope), live: true });
}

export function pushHistory() {
  if (!state.project) return;
  state.past.push(deepClone(state.project));
  if (state.past.length > MAX_HISTORY) state.past.shift();
  state.future.length = 0;
}

export function undo() {
  if (!state.past.length) return false;
  state.future.push(deepClone(state.project));
  const prev = state.past.pop();
  state.project = prev;
  state.ids = makeIdFactory(prev.idCounters || {});
  prev.idCounters = state.ids.counters;
  pruneSelection();
  syncViewToProject();
  markDirty();
  bus.emit(EV.PROJECT, { label: 'Undo', scope: new Set([SCOPE.ALL]) });
  return true;
}

export function redo() {
  if (!state.future.length) return false;
  state.past.push(deepClone(state.project));
  const nxt = state.future.pop();
  state.project = nxt;
  state.ids = makeIdFactory(nxt.idCounters || {});
  nxt.idCounters = state.ids.counters;
  pruneSelection();
  syncViewToProject();
  markDirty();
  bus.emit(EV.PROJECT, { label: 'Redo', scope: new Set([SCOPE.ALL]) });
  return true;
}

export function canUndo() { return state.past.length > 0; }
export function canRedo() { return state.future.length > 0; }

function markDirty() {
  if (!state.dirty) { state.dirty = true; bus.emit(EV.DIRTY, true); }
  else bus.emit(EV.DIRTY, true);
}
export function markClean() { state.dirty = false; state.savedAt = Date.now(); bus.emit(EV.DIRTY, false); }

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */

export function select(kind, id, { additive = false } = {}) {
  if (!kind || !id) return clearSelection();
  const exists = state.selection.some((s) => s.kind === kind && s.id === id);
  if (additive) {
    state.selection = exists
      ? state.selection.filter((s) => !(s.kind === kind && s.id === id))
      : [...state.selection, { kind, id }];
  } else {
    if (exists && state.selection.length === 1) return;
    state.selection = [{ kind, id }];
  }
  bus.emit(EV.SELECTION, state.selection);
}

export function selectMany(items) {
  state.selection = items.slice();
  bus.emit(EV.SELECTION, state.selection);
}

export function clearSelection() {
  if (!state.selection.length) return;
  state.selection = [];
  bus.emit(EV.SELECTION, state.selection);
}

export function primary() { return state.selection[state.selection.length - 1] || null; }
export function isSelected(kind, id) { return state.selection.some((s) => s.kind === kind && s.id === id); }

function pruneSelection() {
  const p = state.project;
  if (!p) return;
  const has = (kind, id) => {
    const list = COLLECTION_OF[kind];
    if (!list) return true;
    return (p[list] || []).some((e) => e.id === id);
  };
  const next = state.selection.filter((s) => has(s.kind, s.id));
  if (next.length !== state.selection.length) {
    state.selection = next;
    bus.emit(EV.SELECTION, state.selection);
  }
}

export const COLLECTION_OF = {
  wall: 'walls', slab: 'slabs', opening: 'openings', stair: 'stairs',
  column: 'columns', space: 'spaces', level: 'levels',
  device: 'devices', cable: 'cables', pathway: 'pathways', rack: 'racks',
};

export function setHover(kind, id) {
  const same = (!kind && !state.hover) || (state.hover && state.hover.kind === kind && state.hover.id === id);
  if (same) return;
  state.hover = kind ? { kind, id } : null;
  bus.emit(EV.HOVER, state.hover);
}

/* ------------------------------------------------------------------ */
/* highlight (trace results)                                           */
/* ------------------------------------------------------------------ */

export function setHighlight({ cables = [], devices = [], label = null }) {
  state.highlight.cables = new Set(cables);
  state.highlight.devices = new Set(devices);
  state.highlight.label = label;
  bus.emit(EV.PROJECT, { label: null, scope: new Set([SCOPE.CABLES, SCOPE.DEVICES]), live: true });
}

export function clearHighlight() {
  if (!state.highlight.cables.size && !state.highlight.devices.size && !state.highlight.label) return;
  state.highlight.cables = new Set();
  state.highlight.devices = new Set();
  state.highlight.label = null;
  bus.emit(EV.PROJECT, { label: null, scope: new Set([SCOPE.CABLES, SCOPE.DEVICES]), live: true });
}

/* ------------------------------------------------------------------ */
/* view state                                                          */
/* ------------------------------------------------------------------ */

export function setView(patch, { silent = false } = {}) {
  deepAssign(state.view, patch);
  if (!silent) bus.emit(EV.VIEW, state.view);
}

export function setTool(tool, toolState = {}) {
  state.view.tool = tool;
  state.toolState = toolState;
  bus.emit(EV.TOOL, { tool, toolState });
  bus.emit(EV.VIEW, state.view);
}

export function setMode(mode) {
  state.view.mode = mode;
  // Modes are presets over the layer/filter system, not separate code paths.
  const L = state.view.layers;
  const S = state.view.signalFilter;
  const all = (v) => { S.video = S.audio = S.network = S.power = S.control = S.kvm = S.data = v; };
  switch (mode) {
    case 'building':
      Object.assign(L, { architecture: true, structure: true, roof: true, doors: true, windows: true, stairs: true, spaces: true });
      break;
    case 'infrastructure':
      all(true); L.equipment = true; L.cables = true; L.pathways = true; L.racks = true;
      break;
    case 'av':
      all(false); S.video = true; S.audio = true; S.control = true;
      L.equipment = true; L.cables = true;
      break;
    case 'network':
      all(false); S.network = true; S.data = true; S.kvm = true;
      L.equipment = true; L.cables = true;
      break;
    case 'power':
      all(false); S.power = true;
      L.equipment = true; L.cables = true;
      break;
    case 'routing':
      all(true); L.pathways = true; L.cables = true; L.ceilings = false;
      break;
    default: break;
  }
  if (state.view.tool !== 'select' && !toolAllowedInMode(state.view.tool, mode)) setTool('select');
  bus.emit(EV.VIEW, state.view);
}

const BUILDING_TOOLS = new Set(['wall', 'room', 'slab', 'door', 'window', 'penetration', 'column', 'stair']);
export function toolAllowedInMode(tool, mode) {
  if (BUILDING_TOOLS.has(tool)) return mode === 'building';
  return true;
}

export function toast(message, kind = 'info', ms = 3400) {
  bus.emit(EV.TOAST, { message, kind, ms });
}
export function status(text) { bus.emit(EV.STATUS, text); }
export function focusOn(kind, id) { bus.emit(EV.FOCUS, { kind, id }); }

function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepAssign(target[k], v);
    } else target[k] = v;
  }
  return target;
}
