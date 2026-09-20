/**
 * Derived lookups over the project document.
 * Pure functions + a rebuild-on-demand index. No Three.js, no DOM.
 */
import { pointInPolygon, polygonCentroid, polygonArea, polygonBounds, dist2 } from '../core/math.js';
import { catalogItem } from './catalog.js';

let rev = 0;
let cache = null;

/** Called whenever the project document changes. */
export function invalidateIndex() { rev++; cache = null; }

/** Monotonic revision — collision and routing caches key off this. */
export function indexRev() { return rev; }

export function index(project) {
  if (cache && cache.rev === rev && cache.project === project) return cache;
  const levels = new Map(project.levels.map((l) => [l.id, l]));
  const spaces = new Map(project.spaces.map((s) => [s.id, s]));
  const walls = new Map(project.walls.map((w) => [w.id, w]));
  const slabs = new Map(project.slabs.map((s) => [s.id, s]));
  const openings = new Map(project.openings.map((o) => [o.id, o]));
  const stairs = new Map(project.stairs.map((s) => [s.id, s]));
  const columns = new Map(project.columns.map((c) => [c.id, c]));
  const devices = new Map(project.devices.map((d) => [d.id, d]));
  const cables = new Map(project.cables.map((c) => [c.id, c]));
  const pathways = new Map(project.pathways.map((p) => [p.id, p]));
  const racks = new Map(project.racks.map((r) => [r.id, r]));
  const cableTypes = new Map(project.cableTypes.map((t) => [t.id, t]));
  const materials = new Map(project.materials.map((m) => [m.id, m]));

  const openingsByWall = new Map();
  for (const o of project.openings) {
    if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, []);
    openingsByWall.get(o.wallId).push(o);
  }
  for (const list of openingsByWall.values()) list.sort((a, b) => a.offset - b.offset);

  const wallsByLevel = new Map();
  for (const w of project.walls) {
    if (!wallsByLevel.has(w.levelId)) wallsByLevel.set(w.levelId, []);
    wallsByLevel.get(w.levelId).push(w);
  }
  const spacesByLevel = new Map();
  for (const s of project.spaces) {
    if (!spacesByLevel.has(s.levelId)) spacesByLevel.set(s.levelId, []);
    spacesByLevel.get(s.levelId).push(s);
  }
  const devicesBySpace = new Map();
  const devicesByRack = new Map();
  for (const d of project.devices) {
    const k = d.spaceId || '_none';
    if (!devicesBySpace.has(k)) devicesBySpace.set(k, []);
    devicesBySpace.get(k).push(d);
    if (d.rackId) {
      if (!devicesByRack.has(d.rackId)) devicesByRack.set(d.rackId, []);
      devicesByRack.get(d.rackId).push(d);
    }
  }
  for (const list of devicesByRack.values()) list.sort((a, b) => (b.rackU || 0) - (a.rackU || 0));

  // port id -> { device, port }
  const ports = new Map();
  for (const d of project.devices) for (const p of d.ports) ports.set(p.id, { device: d, port: p });

  // device id -> cables touching it; port id -> cables on that port
  const cablesByDevice = new Map();
  const cablesByPort = new Map();
  const cablesByPathway = new Map();
  for (const c of project.cables) {
    for (const end of [c.from, c.to]) {
      if (!end) continue;
      if (!cablesByDevice.has(end.deviceId)) cablesByDevice.set(end.deviceId, []);
      const arr = cablesByDevice.get(end.deviceId);
      if (!arr.includes(c)) arr.push(c);
      if (!cablesByPort.has(end.portId)) cablesByPort.set(end.portId, []);
      cablesByPort.get(end.portId).push(c);
    }
    for (const pid of c.pathwayIds || []) {
      if (!cablesByPathway.has(pid)) cablesByPathway.set(pid, []);
      cablesByPathway.get(pid).push(c);
    }
  }

  cache = {
    rev, project, levels, spaces, walls, slabs, openings, stairs, columns,
    devices, cables, pathways, racks, cableTypes, materials,
    openingsByWall, wallsByLevel, spacesByLevel, devicesBySpace, devicesByRack,
    ports, cablesByDevice, cablesByPort, cablesByPathway,
  };
  return cache;
}

/* ------------------------------------------------------------------ */
/* simple getters                                                      */
/* ------------------------------------------------------------------ */

export const getLevel = (p, id) => index(p).levels.get(id) || null;
export const getSpace = (p, id) => index(p).spaces.get(id) || null;
export const getWall = (p, id) => index(p).walls.get(id) || null;
export const getOpening = (p, id) => index(p).openings.get(id) || null;
export const getDevice = (p, id) => index(p).devices.get(id) || null;
export const getCable = (p, id) => index(p).cables.get(id) || null;
export const getPathway = (p, id) => index(p).pathways.get(id) || null;
export const getRack = (p, id) => index(p).racks.get(id) || null;
export const getCableType = (p, id) => index(p).cableTypes.get(id) || null;
export const getMaterial = (p, id) => index(p).materials.get(id) || null;

export function getEntity(p, kind, id) {
  switch (kind) {
    case 'level': return getLevel(p, id);
    case 'wall': return getWall(p, id);
    case 'slab': return index(p).slabs.get(id) || null;
    case 'opening': return getOpening(p, id);
    case 'stair': return index(p).stairs.get(id) || null;
    case 'column': return index(p).columns.get(id) || null;
    case 'space': return getSpace(p, id);
    case 'device': return getDevice(p, id);
    case 'cable': return getCable(p, id);
    case 'pathway': return getPathway(p, id);
    case 'rack': return getRack(p, id);
    default: return null;
  }
}

export function findPort(p, portId) { return index(p).ports.get(portId) || null; }
export function portOf(p, deviceId, portId) {
  const d = getDevice(p, deviceId);
  return d ? d.ports.find((x) => x.id === portId) || null : null;
}

export const devicesInSpace = (p, spaceId) => index(p).devicesBySpace.get(spaceId) || [];
export const devicesInRack = (p, rackId) => index(p).devicesByRack.get(rackId) || [];
export const cablesOfDevice = (p, deviceId) => index(p).cablesByDevice.get(deviceId) || [];
export const cablesOfPort = (p, portId) => index(p).cablesByPort.get(portId) || [];
export const cablesInPathway = (p, pathwayId) => index(p).cablesByPathway.get(pathwayId) || [];
export const wallsOfLevel = (p, levelId) => index(p).wallsByLevel.get(levelId) || [];
export const spacesOfLevel = (p, levelId) => index(p).spacesByLevel.get(levelId) || [];
export const openingsOfWall = (p, wallId) => index(p).openingsByWall.get(wallId) || [];

/* ------------------------------------------------------------------ */
/* spatial queries                                                     */
/* ------------------------------------------------------------------ */

/** Level whose [elevation, elevation+height) band contains world Y. */
export function levelAtY(p, y) {
  let best = null;
  for (const l of p.levels) {
    if (y >= l.elevation - 0.01 && y < l.elevation + l.height) return l;
    if (!best || Math.abs(l.elevation - y) < Math.abs(best.elevation - y)) best = l;
  }
  return best;
}

/** Innermost space at an XZ point on a level (smallest area wins). */
export function spaceAt(p, point, levelId) {
  let found = null, bestArea = Infinity;
  for (const s of spacesOfLevel(p, levelId)) {
    if (!s.boundary.length) continue;
    if (!pointInPolygon(point, s.boundary)) continue;
    const a = Math.abs(polygonArea(s.boundary));
    if (a < bestArea) { bestArea = a; found = s; }
  }
  return found;
}

export function spaceCentroid(space) {
  return space.boundary.length ? polygonCentroid(space.boundary) : { x: 0, z: 0 };
}
export function spaceBounds(space) { return polygonBounds(space.boundary); }
export function spaceArea(space) { return space.boundary.length ? Math.abs(polygonArea(space.boundary)) : 0; }

/** Floor elevation + ceiling geometry for a space, resolving level inheritance. */
export function spaceHeights(p, space) {
  const level = getLevel(p, space.levelId);
  if (!level) return { floorY: 0, ceilingY: 3, plenumTop: 3.2, levelTop: 3.2 };
  const floorY = level.elevation + (space.floorOffset || 0);
  const ceilingH = space.ceilingHeight ?? level.ceilingHeight;
  const ceilingY = floorY + ceilingH;
  const levelTop = level.elevation + level.height;
  const plenumTop = Math.max(ceilingY + 0.05, levelTop - level.slabThickness);
  return { floorY, ceilingY, plenumTop, levelTop, hasCeiling: level.hasCeiling };
}

/** Y a cable prefers when running above a space's ceiling. */
export function plenumY(p, space) {
  const h = spaceHeights(p, space);
  return h.hasCeiling ? (h.ceilingY + h.plenumTop) / 2 : h.ceilingY - 0.15;
}

/* ------------------------------------------------------------------ */
/* device / port positions                                             */
/* ------------------------------------------------------------------ */

/** World position of a device, resolving rack mounting. */
export function devicePosition(p, device) {
  if (device.rackId) {
    const rack = getRack(p, device.rackId);
    if (rack) {
      const u = device.rackU ?? 1;
      const uh = 0.04445; // 1U
      const y = rack.position.y + rack.baseHeight + (u - 1) * uh + (device.rackUnits * uh) / 2;
      return { x: rack.position.x, y, z: rack.position.z };
    }
  }
  return { x: device.position.x, y: device.position.y, z: device.position.z };
}

/**
 * World anchor of a port — where a cable physically terminates.
 * Ports spread across the rear face of the device so bundles read clearly.
 */
export function portAnchor(p, device, port) {
  const base = devicePosition(p, device);
  const idx = Math.max(0, device.ports.indexOf(port));
  const n = Math.max(1, device.ports.length);
  const s = device.size;
  const item = catalogItem(device.typeId);
  const rearward = item.shape === 'panel' ? 0.5 : 0.5;
  // local offsets: spread along width, sit on the rear face
  const spread = n > 1 ? ((idx / (n - 1)) - 0.5) * Math.min(s.w * 0.8, 0.9) : 0;
  const local = { x: spread, y: -s.h * 0.15, z: s.d * rearward };
  const c = Math.cos(device.rotation || 0), si = Math.sin(device.rotation || 0);
  return {
    x: base.x + local.x * c - local.z * si,
    y: base.y + local.y,
    z: base.z + local.x * si + local.z * c,
  };
}

export function cableEndpoints(p, cable) {
  const a = cable.from ? getDevice(p, cable.from.deviceId) : null;
  const b = cable.to ? getDevice(p, cable.to.deviceId) : null;
  const pa = a ? a.ports.find((x) => x.id === cable.from.portId) : null;
  const pb = b ? b.ports.find((x) => x.id === cable.to.portId) : null;
  return {
    sourceDevice: a, destDevice: b, sourcePort: pa, destPort: pb,
    sourcePos: a && pa ? portAnchor(p, a, pa) : null,
    destPos: b && pb ? portAnchor(p, b, pb) : null,
  };
}

/** Space a device belongs to, recomputed from its world position. */
export function resolveSpaceForPosition(p, position) {
  const level = levelAtY(p, position.y + 0.05);
  if (!level) return { levelId: null, spaceId: null };
  const s = spaceAt(p, { x: position.x, z: position.z }, level.id);
  return { levelId: level.id, spaceId: s ? s.id : null };
}

/* ------------------------------------------------------------------ */
/* infrastructure stats                                                */
/* ------------------------------------------------------------------ */

export function pathwayUtilisation(p, pathway) {
  const cables = cablesInPathway(p, pathway.id).filter((c) => c.status !== 'removed');
  const used = cables.length;
  const capacity = pathway.capacity || 0;
  // Cross-sectional fill as a second, more honest metric.
  const area = cables.reduce((s, c) => {
    const t = getCableType(p, c.typeId);
    const d = t?.diameter || 0.006;
    return s + Math.PI * (d / 2) ** 2;
  }, 0);
  const trayArea = (pathway.width || 0.3) * (pathway.height || 0.1);
  return {
    used, capacity, free: Math.max(0, capacity - used),
    ratio: capacity ? used / capacity : 0,
    fillRatio: trayArea ? area / trayArea : 0,
    cables,
  };
}

export function rackOccupancy(p, rack) {
  const devices = devicesInRack(p, rack.id);
  const map = new Array(rack.rackUnits + 1).fill(null);
  for (const d of devices) {
    const u = d.rackU ?? 0;
    for (let i = 0; i < (d.rackUnits || 1); i++) {
      if (u + i >= 1 && u + i <= rack.rackUnits) map[u + i] = d;
    }
  }
  const used = map.filter(Boolean).length;
  return { map, used, free: rack.rackUnits - used, devices };
}

/** Lowest free run of `n` rack units, or null. */
export function findFreeRackU(p, rack, n = 1) {
  const { map } = rackOccupancy(p, rack);
  for (let u = 1; u <= rack.rackUnits - n + 1; u++) {
    let ok = true;
    for (let i = 0; i < n; i++) if (map[u + i]) { ok = false; break; }
    if (ok) return u;
  }
  return null;
}

/** Nearest pathway vertex to a point (used when anchoring drops). */
export function nearestPathwayPoint(p, point, { levelId = null, maxDist = 25 } = {}) {
  let best = null;
  for (const pw of p.pathways) {
    if (levelId && pw.levelId && pw.levelId !== levelId) continue;
    for (let i = 0; i < pw.points.length; i++) {
      const q = pw.points[i];
      const d = Math.hypot(q.x - point.x, q.y - point.y, q.z - point.z);
      if (d < maxDist && (!best || d < best.dist)) best = { pathway: pw, pointIndex: i, point: q, dist: d };
    }
  }
  return best;
}

export function isVisibleInScenario(entity, scenarioId, project) {
  if (!entity.scenarioId) return true;
  if (entity.scenarioId === scenarioId) return true;
  const sc = project.scenarios.find((s) => s.id === scenarioId);
  // A scenario inherits everything from its base layer.
  let base = sc?.base;
  const guard = new Set();
  while (base && !guard.has(base)) {
    if (entity.scenarioId === base) return true;
    guard.add(base);
    base = project.scenarios.find((s) => s.id === base)?.base;
  }
  return false;
}

export function levelOrder(project) {
  return project.levels.slice().sort((a, b) => a.elevation - b.elevation);
}

/** Every wall bounding a space (used for opening/space association). */
export function wallsBoundingSpace(p, space, tol = 0.35) {
  if (!space.boundary.length) return [];
  const out = [];
  for (const w of wallsOfLevel(p, space.levelId)) {
    const mid = { x: (w.start.x + w.end.x) / 2, z: (w.start.z + w.end.z) / 2 };
    let near = false;
    for (let i = 0, j = space.boundary.length - 1; i < space.boundary.length; j = i++) {
      const a = space.boundary[j], b = space.boundary[i];
      const t = closestT(mid, a, b);
      const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (dist2(mid, q) < tol) { near = true; break; }
    }
    if (near) out.push(w);
  }
  return out;
}

function closestT(p0, a, b) {
  const ax = b.x - a.x, az = b.z - a.z;
  const l2 = ax * ax + az * az;
  if (l2 < 1e-9) return 0;
  let t = ((p0.x - a.x) * ax + (p0.z - a.z) * az) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
