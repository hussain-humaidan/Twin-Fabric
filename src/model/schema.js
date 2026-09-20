/**
 * The project document schema and entity factories.
 *
 * Everything is plain JSON so the whole twin serialises with JSON.stringify
 * and can move to a backend later without touching the rest of the app.
 *
 * Hierarchy:
 *   Building > Level > (Wall | Slab | Stair | Column) > Space
 *   Space > Rack > Device > Port > Cable > Port > Device
 *   Pathway (tray/conduit/shaft) carries Cables; Opening lets them cross Walls.
 */
import { DEFAULT_CABLE_TYPES, SIGNAL_IDS } from './signals.js';
import { todayISO } from '../core/util.js';
import { PRODUCT } from '../app.config.js';

export const SCHEMA_VERSION = 3;

export const DEVICE_STATUS = ['active', 'inactive', 'planned', 'faulty', 'maintenance', 'removed'];
export const CABLE_STATUS = ['planned', 'installed', 'active', 'faulty', 'disconnected', 'reserved', 'removed'];
export const STATUS_COLOR = {
  active: '#4ec9a0', installed: '#4ec9a0', inactive: '#7d8b9d', planned: '#9a86e8',
  faulty: '#e0605c', disconnected: '#e8b339', reserved: '#58c6e8', removed: '#55616f',
  maintenance: '#e8b339',
};

export const MOUNTING = ['floor', 'wall', 'ceiling', 'rack', 'desk', 'pole', 'outdoor', 'custom'];

/**
 * How much authority the router has over a cable's physical route.
 * The router proposes; the engineer disposes.
 */
export const ROUTE_MODES = [
  { id: 'auto', label: 'Automatic', hint: 'Regenerated whenever either device moves.' },
  { id: 'semi', label: 'Semi-automatic', hint: 'Your waypoints are kept; only the port anchors follow the devices.' },
  { id: 'manual', label: 'Manual', hint: 'Never regenerated. Bulk re-route skips it unless forced.' },
  { id: 'locked', label: 'Locked', hint: 'Frozen. Waypoints cannot be dragged and nothing regenerates it.' },
];

export const WALL_TYPES = ['exterior', 'interior', 'partition', 'structural'];
export const OPENING_KINDS = ['door', 'window', 'penetration', 'vent', 'service', 'archway'];
export const SPACE_KINDS = ['hall', 'room', 'clerk-room', 'corridor', 'lobby', 'stair', 'shaft', 'plant', 'roof-zone', 'external'];
export const PATHWAY_KINDS = ['tray', 'basket', 'conduit', 'duct', 'shaft', 'ceiling', 'floor', 'wall', 'external'];

/** Routing cost multipliers — lower means the router prefers that pathway. */
export const PATHWAY_COST = {
  tray: 0.35, basket: 0.40, conduit: 0.45, duct: 0.5, shaft: 0.4,
  ceiling: 0.7, floor: 0.8, wall: 0.9, external: 1.0,
};

export const DEFAULT_MATERIALS = [
  { id: 'MAT-CONCRETE', name: 'Concrete',      color: '#8a8f96', roughness: 0.92, metalness: 0.0, opacity: 1 },
  { id: 'MAT-BLOCK',    name: 'Block / render', color: '#b9b2a4', roughness: 0.95, metalness: 0.0, opacity: 1 },
  { id: 'MAT-PLASTER',  name: 'Plaster',       color: '#d8d3c8', roughness: 0.95, metalness: 0.0, opacity: 1 },
  { id: 'MAT-PARTITION',name: 'Partition',     color: '#c3c8cf', roughness: 0.9,  metalness: 0.0, opacity: 1 },
  { id: 'MAT-GLASS',    name: 'Glazing',       color: '#8fd0e8', roughness: 0.08, metalness: 0.0, opacity: 0.22 },
  { id: 'MAT-TILE',     name: 'Floor tile',    color: '#9aa2ad', roughness: 0.6,  metalness: 0.0, opacity: 1 },
  { id: 'MAT-CARPET',   name: 'Carpet',        color: '#6e6a63', roughness: 1.0,  metalness: 0.0, opacity: 1 },
  { id: 'MAT-CEILING',  name: 'Suspended ceiling', color: '#e2e5e8', roughness: 0.95, metalness: 0.0, opacity: 1 },
  { id: 'MAT-ROOF',     name: 'Roof deck',     color: '#6d7480', roughness: 0.95, metalness: 0.0, opacity: 1 },
  { id: 'MAT-METAL',    name: 'Metal',         color: '#9fa8b4', roughness: 0.35, metalness: 0.85, opacity: 1 },
  { id: 'MAT-WOOD',     name: 'Timber',        color: '#9c7549', roughness: 0.8,  metalness: 0.0, opacity: 1 },
];

/** Anything derived from an unverified assumption is tagged here. */
export const PLACEHOLDER = 'PLACEHOLDER';

/* ------------------------------------------------------------------ */
/* factories                                                           */
/* ------------------------------------------------------------------ */

export function makeLevel(ids, o = {}) {
  return {
    id: o.id || ids.next('LEVEL', 2),
    name: o.name || 'Level',
    shortName: o.shortName || o.name || 'L',
    index: o.index ?? 0,
    kind: o.kind || 'floor',          // floor | roof | basement
    elevation: o.elevation ?? 0,       // finished floor level, metres
    height: o.height ?? 4.0,           // floor-to-floor
    ceilingHeight: o.ceilingHeight ?? 3.2, // FFL to underside of suspended ceiling
    slabThickness: o.slabThickness ?? 0.25,
    ceilingThickness: o.ceilingThickness ?? 0.02,
    hasCeiling: o.hasCeiling ?? true,
    placeholder: o.placeholder ?? true,
    notes: o.notes || '',
  };
}

export function makeWall(ids, o = {}) {
  return {
    id: o.id || ids.next('WALL'),
    name: o.name || '',
    levelId: o.levelId,
    start: { x: o.start?.x ?? 0, z: o.start?.z ?? 0 },
    end: { x: o.end?.x ?? 1, z: o.end?.z ?? 0 },
    baseOffset: o.baseOffset ?? 0,     // relative to level elevation
    height: o.height ?? 3.2,
    thickness: o.thickness ?? 0.15,
    type: o.type || 'interior',
    materialId: o.materialId || 'MAT-PARTITION',
    structural: o.structural ?? false,
    locked: o.locked ?? false,
    spaceIds: o.spaceIds || [],
    notes: o.notes || '',
    placeholder: o.placeholder ?? false,
  };
}

export function makeOpening(ids, o = {}) {
  const kind = o.kind || 'door';
  const defaults = OPENING_DEFAULTS[kind] || OPENING_DEFAULTS.door;
  return {
    id: o.id || ids.next(kind === 'door' ? 'DOOR' : kind === 'window' ? 'WIN' : 'OPN'),
    name: o.name || '',
    wallId: o.wallId,
    kind,
    offset: o.offset ?? 1.0,           // metres from wall start to opening centre
    width: o.width ?? defaults.width,
    height: o.height ?? defaults.height,
    sill: o.sill ?? defaults.sill,     // metres above wall base
    swing: o.swing || 'in-left',
    cablePassable: o.cablePassable ?? defaults.cablePassable,
    peoplePassable: o.peoplePassable ?? defaults.peoplePassable,
    spaceA: o.spaceA || null,
    spaceB: o.spaceB || null,
    notes: o.notes || '',
  };
}

export const OPENING_DEFAULTS = {
  door:        { width: 0.95, height: 2.1,  sill: 0,    cablePassable: true,  peoplePassable: true },
  archway:     { width: 2.4,  height: 2.4,  sill: 0,    cablePassable: true,  peoplePassable: true },
  window:      { width: 1.4,  height: 1.5,  sill: 0.95, cablePassable: false, peoplePassable: false },
  penetration: { width: 0.2,  height: 0.2,  sill: 2.6,  cablePassable: true,  peoplePassable: false },
  vent:        { width: 0.6,  height: 0.4,  sill: 2.4,  cablePassable: false, peoplePassable: false },
  service:     { width: 0.6,  height: 0.6,  sill: 2.2,  cablePassable: true,  peoplePassable: false },
};

export function makeSlab(ids, o = {}) {
  return {
    id: o.id || ids.next('SLAB'),
    name: o.name || '',
    levelId: o.levelId,
    kind: o.kind || 'floor',           // floor | ceiling | roof
    polygon: o.polygon || [],
    holes: o.holes || [],              // array of polygons (stair voids, risers)
    thickness: o.thickness ?? 0.25,
    topElevation: o.topElevation ?? 0, // world Y of the slab's top face
    materialId: o.materialId || 'MAT-CONCRETE',
    spaceId: o.spaceId || null,
    locked: o.locked ?? false,
    notes: o.notes || '',
  };
}

export function makeStair(ids, o = {}) {
  return {
    id: o.id || ids.next('STAIR', 2),
    name: o.name || 'Stair',
    fromLevelId: o.fromLevelId,
    toLevelId: o.toLevelId,
    origin: { x: o.origin?.x ?? 0, z: o.origin?.z ?? 0 }, // start of the first flight
    rotation: o.rotation ?? 0,         // radians, direction of travel in XZ
    width: o.width ?? 1.4,
    treadDepth: o.treadDepth ?? 0.28,
    riserHeight: o.riserHeight ?? 0.175,
    landingDepth: o.landingDepth ?? 1.4,
    flights: o.flights ?? 2,           // 2 = half-landing switchback
    materialId: o.materialId || 'MAT-CONCRETE',
    placeholder: o.placeholder ?? true,
    notes: o.notes || '',
  };
}

export function makeColumn(ids, o = {}) {
  return {
    id: o.id || ids.next('COL'),
    name: o.name || '',
    levelId: o.levelId,
    position: { x: o.position?.x ?? 0, z: o.position?.z ?? 0 },
    shape: o.shape || 'rect',          // rect | round
    width: o.width ?? 0.4,
    depth: o.depth ?? 0.4,
    radius: o.radius ?? 0.25,
    height: o.height ?? null,          // null = full level height
    rotation: o.rotation ?? 0,
    materialId: o.materialId || 'MAT-CONCRETE',
    structural: o.structural ?? true,
    notes: o.notes || '',
  };
}

export function makeSpace(ids, o = {}) {
  return {
    id: o.id || ids.next('SPACE'),
    code: o.code || '',                // editable short code, e.g. H1, U05, CR-07
    name: o.name || 'Space',
    levelId: o.levelId,
    kind: o.kind || 'room',
    group: o.group || null,            // e.g. 'clerks' — drives tree grouping
    boundary: o.boundary || [],        // XZ polygon (detected from walls or drawn)
    detected: o.detected ?? false,     // true when derived by space detection
    ceilingHeight: o.ceilingHeight ?? null, // null = inherit level
    floorOffset: o.floorOffset ?? 0,
    color: o.color || null,
    wallIds: o.wallIds || [],
    openingIds: o.openingIds || [],
    placeholder: o.placeholder ?? false,
    notes: o.notes || '',
  };
}

export function makePathway(ids, o = {}) {
  return {
    id: o.id || ids.next('PATH'),
    name: o.name || 'Pathway',
    kind: o.kind || 'tray',
    points: o.points || [],            // [{x,y,z}] — 3D polyline, world coords
    levelId: o.levelId || null,        // null for risers spanning levels
    width: o.width ?? 0.3,
    height: o.height ?? 0.1,
    capacity: o.capacity ?? 40,        // max cables (documentation + utilisation)
    costFactor: o.costFactor ?? null,  // null = use PATHWAY_COST[kind]
    status: o.status || 'installed',
    locked: o.locked ?? false,
    notes: o.notes || '',
    placeholder: o.placeholder ?? false,
  };
}

export function makeRack(ids, o = {}) {
  return {
    id: o.id || ids.next('RACK', 2),
    name: o.name || 'Rack',
    spaceId: o.spaceId || null,
    levelId: o.levelId || null,
    position: { x: o.position?.x ?? 0, y: o.position?.y ?? 0, z: o.position?.z ?? 0 },
    rotation: o.rotation ?? 0,
    rackUnits: o.rackUnits ?? 42,
    width: o.width ?? 0.6,
    depth: o.depth ?? 1.0,
    baseHeight: o.baseHeight ?? 0.1,
    status: o.status || 'active',
    scenarioId: o.scenarioId || 'SCENARIO-PERMANENT',
    notes: o.notes || '',
  };
}

export function makePort(ids, o = {}) {
  return {
    id: o.id || ids.next('PORT'),
    name: o.name || 'Port',
    connector: o.connector || 'CUSTOM',
    direction: o.direction || 'in',    // in | out | bidir
    signals: o.signals || [],          // subset of SIGNAL_IDS
    group: o.group || null,            // e.g. 'SDI', 'Power', 'Rear'
    exclusive: o.exclusive ?? true,    // false for loop-through / bus ports
    verified: o.verified ?? false,     // false = PLACEHOLDER spec, user must confirm
    notes: o.notes || '',
  };
}

export function makeDevice(ids, o = {}) {
  return {
    id: o.id || ids.next('DEV'),
    name: o.name || 'Device',
    typeId: o.typeId || 'generic',
    category: o.category || 'other',
    manufacturer: o.manufacturer || '',
    model: o.model || '',
    serial: o.serial || '',
    levelId: o.levelId || null,
    spaceId: o.spaceId || null,
    rackId: o.rackId || null,
    rackU: o.rackU ?? null,            // lowest occupied U (1-based from bottom)
    rackUnits: o.rackUnits ?? 1,
    position: { x: o.position?.x ?? 0, y: o.position?.y ?? 0, z: o.position?.z ?? 0 },
    rotation: o.rotation ?? 0,
    size: { w: o.size?.w ?? 0.4, h: o.size?.h ?? 0.3, d: o.size?.d ?? 0.2 },
    shape: o.shape || 'box',           // box | cylinder | panel
    color: o.color || '#8d9aab',
    mounting: o.mounting || 'floor',
    status: o.status || 'active',
    scenarioId: o.scenarioId || 'SCENARIO-PERMANENT',
    verifiedSpec: o.verifiedSpec ?? false,
    ports: o.ports || [],
    /** Internal signal continuity for path tracing through this device. */
    passthrough: o.passthrough || 'auto', // auto | declared | none
    links: o.links || [],              // [{ from: portId, to: portId }] when passthrough==='declared'
    attributes: o.attributes || {},    // ip, mac, hostname, os, vlan, resolution…
    tags: o.tags || [],
    notes: o.notes || '',
  };
}

export function makeCable(ids, o = {}) {
  return {
    id: o.id || ids.next('CABLE'),
    name: o.name || '',
    typeId: o.typeId || 'CT-CUSTOM',
    signal: o.signal || 'data',
    from: o.from || null,              // { deviceId, portId }
    to: o.to || null,
    route: o.route || [],              // [{x,y,z}] world polyline, source → destination
    routeMode: o.routeMode || 'auto',  // auto | manual
    pathwayIds: o.pathwayIds || [],
    openingIds: o.openingIds || [],
    length: o.length ?? 0,             // metres, derived from route × slack
    slack: o.slack ?? null,            // null = use cable type default
    status: o.status || 'planned',
    scenarioId: o.scenarioId || 'SCENARIO-PERMANENT',
    color: o.color || null,            // null = inherit cable type colour
    label: o.label || '',              // physical cable label text
    installDate: o.installDate || '',
    warnings: o.warnings || [],
    notes: o.notes || '',
  };
}

export function makeScenario(ids, o = {}) {
  return {
    id: o.id || ids.next('SCENARIO', 2),
    name: o.name || 'Scenario',
    kind: o.kind || 'permanent',       // permanent | future | event | test
    base: o.base || null,              // scenario this one layers on top of
    color: o.color || '#5b9dd9',
    active: o.active ?? true,
    notes: o.notes || '',
  };
}

/* ------------------------------------------------------------------ */
/* document                                                            */
/* ------------------------------------------------------------------ */

/**
 * A project document.
 *
 * Three names live at three levels and must not be conflated:
 *   application  the software            (Twinfabric 0.2.0)
 *   project      this body of work       ("Mall Infrastructure Project")
 *   building     the physical thing      ("Riverside Mall", an address)
 *
 * A project currently holds one building; `buildings` is reserved so a site
 * with several structures does not need a schema break.
 */
export function createEmptyProject(ids, { name = 'Untitled project', buildingType = 'custom', buildingName = null } = {}) {
  return {
    /* ---- provenance ---- */
    application: { name: PRODUCT.name, version: PRODUCT.version },
    schema: { version: SCHEMA_VERSION },
    schemaVersion: SCHEMA_VERSION,       // mirrored for older readers
    projectVersion: 1,                   // bumped on every save

    /* ---- project ---- */
    id: 'PROJ-001',
    name,
    client: '',
    reference: '',
    buildingType,
    units: 'm',
    coordinateSystem: 'Y-up, +X East, +Z South, 1 unit = 1 metre',
    createdAt: todayISO(),
    modifiedAt: todayISO(),
    idCounters: ids.counters,

    /* ---- building ---- */
    building: {
      id: 'BLDG-001',
      name: buildingName || name,
      address: '',
      northAngle: 0,                   // radians; rotation of true north from -Z
      notes: '',
    },

    levels: [],
    walls: [],
    slabs: [],
    openings: [],
    stairs: [],
    columns: [],
    spaces: [],
    pathways: [],
    racks: [],
    devices: [],
    cables: [],

    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    cableTypes: DEFAULT_CABLE_TYPES.map((t) => ({ ...t })),
    scenarios: [
      { id: 'SCENARIO-PERMANENT', name: 'Permanent', kind: 'permanent', base: null, color: '#5b9dd9', active: true, notes: 'Installed, permanent infrastructure.' },
      { id: 'SCENARIO-FUTURE', name: 'Future infrastructure', kind: 'future', base: 'SCENARIO-PERMANENT', color: '#9a86e8', active: true, notes: 'Planned but not installed.' },
    ],

    settings: {
      routing: {
        preferPathways: true,
        allowDoorRouting: true,
        allowFreeAir: true,
        freeAirCost: 2.4,
        openingCost: 1.15,
        dropCost: 1.3,
        defaultSlack: 1.08,
        serviceLoop: 0.5,              // metres added per termination
      },
      display: { labelScale: 1.0, cableThickness: 1.0 },
      defaults: {
        wallThicknessInterior: 0.15,
        wallThicknessExterior: 0.3,
        wallHeight: 3.2,
        ceilingHeight: 3.2,
      },
    },

    placeholders: [],                  // human-readable list of unverified values
  };
}

export function signalIsValid(s) { return SIGNAL_IDS.includes(s); }
