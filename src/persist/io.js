/**
 * Persistence.
 *
 * The project is one plain JSON document, so "save" is literally
 * JSON.stringify. Local storage is the first-version backing store; swapping
 * in a REST/GraphQL backend means replacing the four functions at the top of
 * this file and nothing else.
 */
import { SCHEMA_VERSION, createEmptyProject, DEFAULT_MATERIALS } from '../model/schema.js';
import { DEFAULT_CABLE_TYPES } from '../model/signals.js';
import { makeIdFactory, todayISO } from '../core/util.js';
import { PRODUCT } from '../app.config.js';
import { toContainer, fromContainer, summarise } from './format.js';
import { putProject, getProject, listProjects, deleteProject, backend, estimateUsage } from './db.js';

const KEY = 'matam-twin/project';          // legacy store, read once then migrated
const KEY_SLOTS = 'matam-twin/slots';      // legacy named copies
const KEY_VIEW = 'twinfabric/view';
const CURRENT = 'current';                 // IndexedDB key for the open project

/* ------------------------------------------------------------------ */
/* primary store: IndexedDB, container format                          */
/* ------------------------------------------------------------------ */

/** Save the open project. Async: large documents must not block the frame. */
export async function saveProject(project) {
  try {
    return await putProject(CURRENT, toContainer(stamp(project)));
  } catch (e) {
    console.warn('[persist] save failed', e);
    return false;
  }
}

/**
 * Load the open project, migrating a legacy localStorage document on first run.
 * @returns {Promise<{project:object|null, migrated:boolean, warnings:string[]}>}
 */
export async function loadProject() {
  const warnings = [];
  const container = await getProject(CURRENT);
  if (container) {
    const res = fromContainer(container);
    if (res.ok) return { project: migrate(res.project, warnings), migrated: false, warnings: [...warnings, ...res.warnings] };
    warnings.push(res.error);
  }
  // Nothing in IndexedDB — look for a pre-container localStorage document.
  const legacy = loadLocal();
  if (legacy) {
    warnings.push('Migrated your project from browser local storage to IndexedDB.');
    await saveProject(legacy);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    return { project: legacy, migrated: true, warnings };
  }
  return { project: null, migrated: false, warnings };
}

/** Named copies, kept alongside the open project. */
export async function saveNamed(name, project) {
  return putProject(`slot:${name}`, toContainer(stamp(project)));
}

export async function loadNamed(name) {
  const container = await getProject(`slot:${name}`);
  if (!container) return null;
  const res = fromContainer(container);
  return res.ok ? migrate(res.project) : null;
}

export async function listSaved() {
  const all = await listProjects();
  return all
    .filter((r) => r.key.startsWith('slot:'))
    .map((r) => ({ ...r, name: r.key.slice(5) || r.name }));
}

export async function deleteSaved(name) {
  return deleteProject(`slot:${name}`);
}

export { backend as storageBackend, estimateUsage };

/* ---------------- store adapter (swap this for a backend) ---------------- */

/** Stamp provenance on every write so a file always says what wrote it. */
function stamp(project) {
  project.modifiedAt = todayISO();
  project.projectVersion = (project.projectVersion || 0) + 1;
  project.application = { name: PRODUCT.name, version: PRODUCT.version };
  project.schema = { version: SCHEMA_VERSION };
  project.schemaVersion = SCHEMA_VERSION;
  return project;
}

export function saveLocal(project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stamp(project)));
    return true;
  } catch (e) {
    console.warn('[persist] save failed', e);
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('[persist] load failed', e);
    return null;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function saveViewPrefs(view) {
  try {
    localStorage.setItem(KEY_VIEW, JSON.stringify({
      mode: view.mode, viewMode: view.viewMode, layers: view.layers,
      cableTypes: view.cableTypes, signalFilter: view.signalFilter,
      labels: view.labels, grid: view.grid,
    }));
  } catch { /* ignore */ }
}

export function loadViewPrefs() {
  try {
    const raw = localStorage.getItem(KEY_VIEW);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ---------------- named slots ---------------- */

export function listSlots() {
  try { return JSON.parse(localStorage.getItem(KEY_SLOTS) || '[]'); } catch { return []; }
}

export function saveSlot(name, project) {
  const slots = listSlots().filter((s) => s.name !== name);
  const entry = { name, savedAt: new Date().toISOString(), size: 0 };
  try {
    const json = JSON.stringify(project);
    entry.size = json.length;
    localStorage.setItem(`${KEY_SLOTS}/${name}`, json);
    slots.push(entry);
    localStorage.setItem(KEY_SLOTS, JSON.stringify(slots));
    return true;
  } catch (e) {
    console.warn('[persist] slot save failed', e);
    return false;
  }
}

export function loadSlot(name) {
  try {
    const raw = localStorage.getItem(`${KEY_SLOTS}/${name}`);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function deleteSlot(name) {
  try {
    localStorage.removeItem(`${KEY_SLOTS}/${name}`);
    localStorage.setItem(KEY_SLOTS, JSON.stringify(listSlots().filter((s) => s.name !== name)));
  } catch { /* ignore */ }
}

/* ---------------- import / export ---------------- */

/** Export as a .twinfabric container. */
export function toJSON(project, pretty = true) {
  return JSON.stringify(toContainer(stamp(project)), null, pretty ? 2 : 0);
}

/** Suggested filename for an exported project. */
export function exportFilename(project) {
  const base = (project?.name || 'project').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return `${base}${PRODUCT.fileExtension}.json`;
}

/**
 * Parse and validate an imported document.
 * @returns {{ok:boolean, project?:object, error?:string, warnings:string[]}}
 */
export function fromJSON(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: `Not valid JSON: ${e.message}`, warnings: [] }; }
  const res = fromContainer(raw);
  if (!res.ok) return res;
  const warnings = [...res.warnings];
  return { ok: true, project: migrate(res.project, warnings), warnings, header: res.header };
}

/** Forward-compatible migration hook. */
export function migrate(doc, warnings = []) {
  const v = doc.schemaVersion || 1;
  if (v > SCHEMA_VERSION) warnings.push(`Document is schema v${v}, this build understands v${SCHEMA_VERSION}. Some fields may be ignored.`);

  const ids = makeIdFactory(doc.idCounters || {});
  const base = createEmptyProject(ids, { name: doc.name || 'Imported building' });
  const project = { ...base, ...doc };

  // Guarantee every collection exists.
  for (const k of ['levels', 'walls', 'slabs', 'openings', 'stairs', 'columns', 'spaces', 'pathways', 'racks', 'devices', 'cables', 'scenarios', 'materials', 'cableTypes', 'placeholders']) {
    if (!Array.isArray(project[k])) project[k] = base[k] ? [...base[k]] : [];
  }
  if (!project.settings) project.settings = base.settings;
  else project.settings = deepDefaults(project.settings, base.settings);
  if (!project.building) project.building = base.building;

  if (!project.cableTypes.length) project.cableTypes = DEFAULT_CABLE_TYPES.map((t) => ({ ...t }));
  if (!project.materials.length) project.materials = DEFAULT_MATERIALS.map((m) => ({ ...m }));
  if (!project.scenarios.length) project.scenarios = base.scenarios;

  // v1/v2 → v3: cables gained pathwayIds/openingIds/warnings; devices gained links.
  for (const c of project.cables) {
    if (!Array.isArray(c.pathwayIds)) c.pathwayIds = [];
    if (!Array.isArray(c.openingIds)) c.openingIds = [];
    if (!Array.isArray(c.warnings)) c.warnings = [];
    if (!Array.isArray(c.route)) c.route = [];
  }
  for (const d of project.devices) {
    if (!Array.isArray(d.ports)) d.ports = [];
    if (!Array.isArray(d.links)) d.links = [];
    if (!d.passthrough) d.passthrough = 'auto';
    if (!d.attributes) d.attributes = {};
  }
  for (const o of project.openings) {
    if (o.cablePassable === undefined) o.cablePassable = o.kind !== 'window';
    if (o.peoplePassable === undefined) o.peoplePassable = o.kind === 'door' || o.kind === 'archway';
  }

  // Re-seed ID counters from what's actually in the document.
  const idf = makeIdFactory(project.idCounters || {});
  for (const k of ['levels', 'walls', 'slabs', 'openings', 'stairs', 'columns', 'spaces', 'pathways', 'racks', 'devices', 'cables', 'scenarios']) {
    for (const e of project[k]) {
      idf.observe(e.id);
      if (k === 'devices') for (const pt of e.ports) idf.observe(pt.id);
    }
  }
  project.idCounters = idf.counters;
  project.schemaVersion = SCHEMA_VERSION;
  return project;
}

function deepDefaults(target, defaults) {
  const out = { ...defaults, ...target };
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepDefaults(target?.[k] || {}, v);
  }
  return out;
}

/* ---------------- CSV schedules ---------------- */

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows) => rows.map((r) => r.map(esc).join(',')).join('\r\n');

export function cableScheduleCSV(project) {
  const dev = new Map(project.devices.map((d) => [d.id, d]));
  const type = new Map(project.cableTypes.map((t) => [t.id, t]));
  const space = new Map(project.spaces.map((s) => [s.id, s]));
  const level = new Map(project.levels.map((l) => [l.id, l]));
  const rows = [[
    'Cable ID', 'Label', 'Type', 'Signal', 'Source device', 'Source ID', 'Source port',
    'Destination device', 'Destination ID', 'Destination port', 'Length (m)',
    'From room', 'To room', 'From level', 'To level', 'Pathways', 'Openings',
    'Status', 'Scenario', 'Installed', 'Warnings', 'Notes',
  ]];
  for (const c of project.cables) {
    const a = c.from ? dev.get(c.from.deviceId) : null;
    const b = c.to ? dev.get(c.to.deviceId) : null;
    const ap = a?.ports.find((x) => x.id === c.from.portId);
    const bp = b?.ports.find((x) => x.id === c.to.portId);
    rows.push([
      c.id, c.label, type.get(c.typeId)?.name || c.typeId, c.signal,
      a?.name || '', a?.id || '', ap?.name || '',
      b?.name || '', b?.id || '', bp?.name || '',
      (c.length || 0).toFixed(2),
      space.get(a?.spaceId)?.name || '', space.get(b?.spaceId)?.name || '',
      level.get(a?.levelId)?.name || '', level.get(b?.levelId)?.name || '',
      (c.pathwayIds || []).join(' + '), (c.openingIds || []).join(' + '),
      c.status, c.scenarioId, c.installDate, (c.warnings || []).join(' | '), c.notes,
    ]);
  }
  return toCSV(rows);
}

export function equipmentScheduleCSV(project) {
  const space = new Map(project.spaces.map((s) => [s.id, s]));
  const level = new Map(project.levels.map((l) => [l.id, l]));
  const rows = [[
    'Device ID', 'Name', 'Type', 'Category', 'Manufacturer', 'Model', 'Serial',
    'Level', 'Room', 'Rack', 'Rack U', 'Mounting', 'Status', 'Scenario',
    'X', 'Y', 'Z', 'Ports', 'Connected', 'IP', 'Hostname', 'MAC',
    'Spec verified', 'Notes',
  ]];
  const connCount = new Map();
  for (const c of project.cables) {
    for (const e of [c.from, c.to]) if (e) connCount.set(e.deviceId, (connCount.get(e.deviceId) || 0) + 1);
  }
  for (const d of project.devices) {
    rows.push([
      d.id, d.name, d.typeId, d.category, d.manufacturer, d.model, d.serial,
      level.get(d.levelId)?.name || '', space.get(d.spaceId)?.name || '',
      d.rackId || '', d.rackU ?? '', d.mounting, d.status, d.scenarioId,
      d.position.x.toFixed(2), d.position.y.toFixed(2), d.position.z.toFixed(2),
      d.ports.length, connCount.get(d.id) || 0,
      d.attributes?.ip || '', d.attributes?.hostname || '', d.attributes?.mac || '',
      d.verifiedSpec ? 'yes' : 'PLACEHOLDER', d.notes,
    ]);
  }
  return toCSV(rows);
}

export function portScheduleCSV(project) {
  const rows = [['Device ID', 'Device', 'Port ID', 'Port', 'Connector', 'Direction', 'Signals', 'Group', 'Connected cable', 'Verified']];
  const byPort = new Map();
  for (const c of project.cables) {
    for (const e of [c.from, c.to]) if (e) byPort.set(e.portId, c.id);
  }
  for (const d of project.devices) {
    for (const p of d.ports) {
      rows.push([d.id, d.name, p.id, p.name, p.connector, p.direction, (p.signals || []).join('+'), p.group || '', byPort.get(p.id) || '', p.verified ? 'yes' : 'PLACEHOLDER']);
    }
  }
  return toCSV(rows);
}

export function roomScheduleCSV(project) {
  const level = new Map(project.levels.map((l) => [l.id, l]));
  const rows = [['Space ID', 'Code', 'Name', 'Level', 'Kind', 'Group', 'Area (m²)', 'Ceiling (m)', 'Devices', 'Notes']];
  const devCount = new Map();
  for (const d of project.devices) devCount.set(d.spaceId, (devCount.get(d.spaceId) || 0) + 1);
  for (const s of project.spaces) {
    let area = 0;
    const b = s.boundary || [];
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) area += b[j].x * b[i].z - b[i].x * b[j].z;
    rows.push([
      s.id, s.code, s.name, level.get(s.levelId)?.name || '', s.kind, s.group || '',
      Math.abs(area / 2).toFixed(1),
      (s.ceilingHeight ?? level.get(s.levelId)?.ceilingHeight ?? 0).toFixed(2),
      devCount.get(s.id) || 0, s.notes,
    ]);
  }
  return toCSV(rows);
}

/**
 * Offer a file to the user. Browser sandboxes may block programmatic
 * downloads, so the caller always gets the text back for copy/paste too.
 */
export function offerDownload(filename, text, mime = 'application/json') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    return true;
  } catch (e) {
    console.warn('[persist] download blocked', e);
    return false;
  }
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
