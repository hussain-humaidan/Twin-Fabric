/**
 * Twinfabric domain model.
 *
 * These declarations are the contract the whole application agrees on. They
 * are the first step of the TypeScript migration: the shapes are declared
 * here, JSDoc in the .js files refers to them, and modules convert to .ts
 * one at a time without the types having to be rewritten.
 *
 * Units are metres throughout. Coordinates are Y-up, +X east, +Z south.
 */

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

export type SignalClass =
  | 'video' | 'audio' | 'network' | 'power' | 'control' | 'kvm' | 'data';

export type PortDirection = 'in' | 'out' | 'bidir';

export type DeviceStatus =
  | 'active' | 'inactive' | 'planned' | 'faulty' | 'maintenance' | 'removed';

export type CableStatus =
  | 'planned' | 'installed' | 'active' | 'faulty' | 'disconnected' | 'reserved' | 'removed';

/** How much authority the router has over a cable's physical route. */
export type RouteMode = 'auto' | 'semi' | 'manual' | 'locked';

export type MountingType =
  | 'floor' | 'wall' | 'ceiling' | 'rack' | 'desk' | 'pole' | 'outdoor' | 'custom';

export type WallType = 'exterior' | 'interior' | 'partition' | 'structural';

export type OpeningKind =
  | 'door' | 'window' | 'penetration' | 'vent' | 'service' | 'archway';

export type SpaceKind =
  | 'hall' | 'room' | 'clerk-room' | 'corridor' | 'lobby' | 'stair'
  | 'shaft' | 'plant' | 'roof-zone' | 'external';

export type PathwayKind =
  | 'tray' | 'basket' | 'conduit' | 'duct' | 'shaft'
  | 'ceiling' | 'floor' | 'wall' | 'external';

/* ------------------------------------------------------------------ */
/* building                                                            */
/* ------------------------------------------------------------------ */

export interface Level {
  id: string;
  name: string;
  shortName: string;
  index: number;
  kind: 'floor' | 'roof' | 'basement';
  /** Finished floor level, world Y. */
  elevation: number;
  /** Floor-to-floor. */
  height: number;
  /** FFL to underside of the suspended ceiling. */
  ceilingHeight: number;
  slabThickness: number;
  ceilingThickness: number;
  hasCeiling: boolean;
  placeholder: boolean;
  notes: string;
}

/**
 * A wall is parametric, never a raw box. The mesh is generated from these
 * fields and split into piers, sills and lintels around its openings.
 */
export interface Wall {
  id: string;
  name: string;
  levelId: string;
  start: Vec2;
  end: Vec2;
  /** Relative to the level's elevation. */
  baseOffset: number;
  height: number;
  thickness: number;
  type: WallType;
  materialId: string;
  structural: boolean;
  locked: boolean;
  spaceIds: string[];
  notes: string;
  placeholder: boolean;
}

export interface Opening {
  id: string;
  name: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance along the wall from its start to the opening's centre. */
  offset: number;
  width: number;
  height: number;
  /** Height above the wall base. */
  sill: number;
  swing: string;
  /** The router may only cross a wall where this is true. */
  cablePassable: boolean;
  peoplePassable: boolean;
  spaceA: string | null;
  spaceB: string | null;
  notes: string;
}

export interface Slab {
  id: string;
  name: string;
  levelId: string;
  kind: 'floor' | 'ceiling' | 'roof';
  polygon: Vec2[];
  /** Real voids: stairwells and riser shafts. */
  holes: Vec2[][];
  thickness: number;
  /** World Y of the slab's top face. */
  topElevation: number;
  materialId: string;
  spaceId: string | null;
  locked: boolean;
  notes: string;
}

export interface Stair {
  id: string;
  name: string;
  fromLevelId: string;
  toLevelId: string;
  origin: Vec2;
  rotation: number;
  width: number;
  treadDepth: number;
  riserHeight: number;
  landingDepth: number;
  /** 2 = half-landing switchback. */
  flights: number;
  materialId: string;
  placeholder: boolean;
  notes: string;
}

export interface Column {
  id: string;
  name: string;
  levelId: string;
  position: Vec2;
  shape: 'rect' | 'round';
  width: number;
  depth: number;
  radius: number;
  height: number | null;
  rotation: number;
  materialId: string;
  structural: boolean;
  notes: string;
}

/** Logical room metadata over a boundary detected from the wall geometry. */
export interface Space {
  id: string;
  code: string;
  name: string;
  levelId: string;
  kind: SpaceKind;
  group: string | null;
  boundary: Vec2[];
  /** True when the boundary was derived by planar face detection. */
  detected: boolean;
  ceilingHeight: number | null;
  floorOffset: number;
  color: string | null;
  wallIds: string[];
  openingIds: string[];
  placeholder: boolean;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* infrastructure                                                      */
/* ------------------------------------------------------------------ */

export interface Pathway {
  id: string;
  name: string;
  kind: PathwayKind;
  points: Vec3[];
  /** null for risers that span levels. */
  levelId: string | null;
  width: number;
  height: number;
  capacity: number;
  /** Lower means the router prefers it. null uses the kind's default. */
  costFactor: number | null;
  status: string;
  locked: boolean;
  notes: string;
  placeholder: boolean;
}

export interface Rack {
  id: string;
  name: string;
  spaceId: string | null;
  levelId: string | null;
  position: Vec3;
  rotation: number;
  rackUnits: number;
  width: number;
  depth: number;
  baseHeight: number;
  status: string;
  scenarioId: string;
  notes: string;
}

export interface Port {
  id: string;
  name: string;
  /** Key into CONNECTORS; its family decides what may mate with what. */
  connector: string;
  direction: PortDirection;
  signals: SignalClass[];
  group: string | null;
  /** false for loop-through and bus ports. */
  exclusive: boolean;
  /** false means a PLACEHOLDER spec the user must confirm. */
  verified: boolean;
  notes: string;
}

/** Internal continuity: how a signal arriving on an input leaves the device. */
export type Passthrough = 'auto' | 'declared' | 'none';

export interface Device {
  id: string;
  name: string;
  typeId: string;
  category: string;
  manufacturer: string;
  model: string;
  serial: string;
  levelId: string | null;
  spaceId: string | null;
  rackId: string | null;
  /** Lowest occupied U, 1-based from the bottom. */
  rackU: number | null;
  rackUnits: number;
  position: Vec3;
  rotation: number;
  size: { w: number; h: number; d: number };
  shape: 'box' | 'cylinder' | 'panel';
  color: string;
  mounting: MountingType;
  status: DeviceStatus;
  scenarioId: string;
  /** false means the port list is a placeholder. */
  verifiedSpec: boolean;
  ports: Port[];
  passthrough: Passthrough;
  /** Used when passthrough === 'declared'; how a converter maps in to out. */
  links: Array<{ from: string; to: string }>;
  attributes: Record<string, string>;
  tags: string[];
  notes: string;
}

/** Directional: source port -> cable -> destination port. Never undirected. */
export interface Cable {
  id: string;
  name: string;
  typeId: string;
  signal: SignalClass;
  from: { deviceId: string; portId: string } | null;
  to: { deviceId: string; portId: string } | null;
  /** The physical run, source to destination. */
  route: Vec3[];
  routeMode: RouteMode;
  pathwayIds: string[];
  openingIds: string[];
  /** Derived from route x slack + service loops. Never typed in. */
  length: number;
  slack: number | null;
  status: CableStatus;
  scenarioId: string;
  color: string | null;
  label: string;
  installDate: string;
  warnings: string[];
  notes: string;
}

export interface CableType {
  id: string;
  name: string;
  signal: SignalClass;
  /** Connector family this cable terminates in. */
  family: string;
  color: string;
  category: string;
  /** Metres, for tray fill calculations. */
  diameter: number;
  /** Soft limit; exceeding it is a warning, not an error. */
  maxLength: number | null;
  slack: number;
}

export interface Scenario {
  id: string;
  name: string;
  kind: 'permanent' | 'future' | 'event' | 'test';
  /** Scenario this one layers on top of. */
  base: string | null;
  color: string;
  active: boolean;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* document                                                            */
/* ------------------------------------------------------------------ */

export interface Building {
  id: string;
  name: string;
  address: string;
  /** Radians; rotation of true north from -Z. */
  northAngle: number;
  notes: string;
}

export interface RoutingSettings {
  preferPathways: boolean;
  allowDoorRouting: boolean;
  allowFreeAir: boolean;
  freeAirCost: number;
  openingCost: number;
  dropCost: number;
  defaultSlack: number;
  serviceLoop: number;
}

export interface Project {
  application: { name: string; version: string };
  schema: { version: number };
  schemaVersion: number;
  /** Increments on every save. */
  projectVersion: number;

  id: string;
  /** The body of work, NOT the building and NOT the application. */
  name: string;
  client: string;
  reference: string;
  buildingType: string;
  units: 'm';
  coordinateSystem: string;
  createdAt: string;
  modifiedAt: string;
  idCounters: Record<string, number>;

  building: Building;

  levels: Level[];
  walls: Wall[];
  slabs: Slab[];
  openings: Opening[];
  stairs: Stair[];
  columns: Column[];
  spaces: Space[];
  pathways: Pathway[];
  racks: Rack[];
  devices: Device[];
  cables: Cable[];

  materials: Array<{ id: string; name: string; color: string; roughness: number; metalness: number; opacity: number }>;
  cableTypes: CableType[];
  scenarios: Scenario[];

  settings: {
    routing: RoutingSettings;
    display: { labelScale: number; cableThickness: number };
    defaults: Record<string, number>;
  };

  /** Human-readable list of values still awaiting real survey data. */
  placeholders: string[];
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */

export interface RouteResult {
  route: Vec3[];
  pathwayIds: string[];
  openingIds: string[];
  warnings: string[];
  cost: number;
  viaGraph: boolean;
}

export interface CollisionResult {
  blocked: boolean;
  reason?: 'wall' | 'column' | 'slab';
  wallId?: string;
  columnId?: string;
  slabId?: string;
  openingIds: string[];
}

export interface ValidationResult {
  ok: boolean;
  severity: 'ok' | 'warning' | 'error';
  errors: string[];
  warnings: string[];
}

export interface AuditCheck {
  level: 'ok' | 'warning' | 'error' | 'info';
  message: string;
  items: Array<{ kind: string; id: string; label?: string }>;
}

export interface AuditReport {
  categories: Array<{ id: string; label: string; checks: AuditCheck[] }>;
  counts: Record<string, number>;
}
