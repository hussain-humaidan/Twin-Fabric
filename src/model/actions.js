/**
 * Every mutation the UI and the 3D tools are allowed to make.
 *
 * Each action goes through store.commit(), which snapshots for undo and
 * declares which render scopes it invalidates, so a cable edit never forces
 * the architecture to rebuild.
 */
import { state, commit, transaction, mutateLive, SCOPE, toast, select } from '../core/store.js';
import {
  makeWall, makeOpening, makeSlab, makeColumn, makeStair, makeSpace,
  makePathway, makeRack, makeCable, makePort, makeLevel, OPENING_DEFAULTS,
} from './schema.js';
import { instantiate, catalogItem } from './catalog.js';
import {
  invalidateIndex, indexRev, getDevice, getSpace, getLevel, getRack, getPathway,
  portAnchor, resolveSpaceForPosition, findFreeRackU, spacesOfLevel, wallsOfLevel,
  pathwayUtilisation,
} from './queries.js';
import {
  invalidateRouteGraph, routeBetween, cableLength,
  detectPathwaysAlong, detectOpeningsAlong, validateRoute,
} from '../logic/router.js';
import { detectFaces, reconcileSpaces, spacesAdjacentToOpening } from '../logic/spaceDetect.js';
import { buildWallNetwork, locateOnWall } from '../logic/wallNetwork.js';
import { wallFrame } from '../logic/geometry.js';
import { rect, dist2, polygonCentroid } from '../core/math.js';
// polygonCentroid is used by shrinkBoundary when a room's ceiling follows a resize.
import { suggestCableType } from './signals.js';

/** Flush derived caches mid-mutation so follow-up reads see fresh data. */
function touch() { invalidateIndex(); invalidateRouteGraph(); }

/* ================================================================== */
/* BUILDING — levels                                                   */
/* ================================================================== */

export function updateLevel(levelId, patch) {
  commit('Edit level', (p) => {
    const l = p.levels.find((x) => x.id === levelId);
    if (!l) return;
    Object.assign(l, patch);
    l.placeholder = false;
    // Keep walls and slabs consistent with the level's new height.
    if (patch.height != null || patch.slabThickness != null) {
      for (const w of p.walls) if (w.levelId === levelId) w.height = l.height - l.slabThickness;
      for (const s of p.slabs) {
        if (s.levelId !== levelId) continue;
        if (s.kind === 'floor' || s.kind === 'roof') s.topElevation = l.elevation;
      }
    }
    if (patch.ceilingHeight != null) {
      for (const s of p.slabs) {
        if (s.levelId === levelId && s.kind === 'ceiling') s.topElevation = l.elevation + l.ceilingHeight;
      }
    }
    touch();
  }, [SCOPE.ARCH, SCOPE.SPACES, SCOPE.META, SCOPE.ROUTEGRAPH]);
}

export function addLevel(patch = {}) {
  let created = null;
  commit('Add level', (p, ids) => {
    const top = p.levels.reduce((a, b) => (b.elevation > a.elevation ? b : a), p.levels[0]);
    const l = makeLevel(ids, {
      name: patch.name || `Level ${p.levels.length + 1}`,
      index: p.levels.length,
      elevation: patch.elevation ?? (top ? top.elevation + top.height : 0),
      ...patch,
    });
    p.levels.push(l);
    created = l;
    touch();
  }, [SCOPE.ARCH, SCOPE.META]);
  return created;
}

export function deleteLevel(levelId) {
  commit('Delete level', (p) => {
    p.levels = p.levels.filter((l) => l.id !== levelId);
    const spaceIds = new Set(p.spaces.filter((s) => s.levelId === levelId).map((s) => s.id));
    const wallIds = new Set(p.walls.filter((w) => w.levelId === levelId).map((w) => w.id));
    p.walls = p.walls.filter((w) => w.levelId !== levelId);
    p.openings = p.openings.filter((o) => !wallIds.has(o.wallId));
    p.slabs = p.slabs.filter((s) => s.levelId !== levelId);
    p.columns = p.columns.filter((c) => c.levelId !== levelId);
    p.spaces = p.spaces.filter((s) => s.levelId !== levelId);
    p.stairs = p.stairs.filter((s) => s.fromLevelId !== levelId && s.toLevelId !== levelId);
    p.pathways = p.pathways.filter((pw) => pw.levelId !== levelId);
    const devIds = new Set(p.devices.filter((d) => spaceIds.has(d.spaceId) || d.levelId === levelId).map((d) => d.id));
    p.devices = p.devices.filter((d) => !devIds.has(d.id));
    p.cables = p.cables.filter((c) => !devIds.has(c.from?.deviceId) && !devIds.has(c.to?.deviceId));
    touch();
  }, [SCOPE.ALL]);
}

/* ================================================================== */
/* BUILDING — walls                                                    */
/* ================================================================== */

export function addWall(levelId, start, end, opts = {}) {
  let created = null;
  commit('Draw wall', (p, ids) => {
    const level = p.levels.find((l) => l.id === levelId);
    const d = p.settings.defaults;
    const w = makeWall(ids, {
      levelId, start, end,
      height: opts.height ?? (level ? level.height - level.slabThickness : d.wallHeight),
      thickness: opts.thickness ?? (opts.type === 'exterior' ? d.wallThicknessExterior : d.wallThicknessInterior),
      type: opts.type || 'interior',
      materialId: opts.materialId || (opts.type === 'exterior' ? 'MAT-BLOCK' : 'MAT-PARTITION'),
    });
    p.walls.push(w);
    created = w;
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
  return created;
}

export function updateWall(wallId, patch, { live = false } = {}) {
  const apply = (p) => {
    const w = p.walls.find((x) => x.id === wallId);
    if (!w) return;
    Object.assign(w, patch);
    if (patch.start || patch.end) {
      // Keep openings inside the wall when its length changes.
      const len = dist2(w.start, w.end);
      for (const o of p.openings) {
        if (o.wallId !== wallId) continue;
        o.offset = Math.min(Math.max(o.width / 2 + 0.05, o.offset), Math.max(o.width / 2 + 0.05, len - o.width / 2 - 0.05));
      }
    }
    touch();
  };
  if (live) mutateLive(apply, [SCOPE.ARCH]);
  else commit('Edit wall', apply, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
}

export function deleteWall(wallId) {
  commit('Delete wall', (p) => {
    p.walls = p.walls.filter((w) => w.id !== wallId);
    p.openings = p.openings.filter((o) => o.wallId !== wallId);
    for (const s of p.spaces) s.wallIds = (s.wallIds || []).filter((id) => id !== wallId);
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
}

/**
 * Create a room / hall from a dragged rectangle: floor, four walls, ceiling
 * and the Space entity, splitting any wall it shares with a neighbour.
 */
export function addRoomRect(levelId, x, z, w, d, opts = {}) {
  let created = null;
  commit(opts.kind === 'hall' ? 'Create hall' : 'Create room', (p, ids) => {
    const level = p.levels.find((l) => l.id === levelId);
    if (!level) return;
    const height = level.height - level.slabThickness;
    const existing = p.walls.filter((wl) => wl.levelId === levelId);
    const specs = buildWallNetwork([{ x, z, w, d }], { bounds: { minX: x, maxX: x + w, minZ: z, maxZ: z + d } });
    for (const s of specs) {
      const dup = existing.some((e) => sameSeg(e, s));
      if (dup) continue;
      p.walls.push(makeWall(ids, {
        levelId, start: s.start, end: s.end, height,
        thickness: opts.thickness ?? p.settings.defaults.wallThicknessInterior,
        type: opts.wallType || 'interior',
        materialId: 'MAT-PARTITION',
      }));
    }
    const space = makeSpace(ids, {
      id: opts.id, code: opts.code || '', name: opts.name || (opts.kind === 'hall' ? 'New hall' : 'New room'),
      levelId, kind: opts.kind || 'room', group: opts.group || null,
      boundary: rect(x, z, w, d),
    });
    p.spaces.push(space);
    p.slabs.push(makeSlab(ids, {
      levelId, kind: 'ceiling', spaceId: space.id, name: `Ceiling — ${space.name}`,
      polygon: rect(x + 0.05, z + 0.05, w - 0.1, d - 0.1),
      thickness: level.ceilingThickness, topElevation: level.elevation + level.ceilingHeight,
      materialId: 'MAT-CEILING',
    }));
    created = space;
    touch();
  }, [SCOPE.ARCH, SCOPE.SPACES, SCOPE.ROUTEGRAPH]);
  return created;
}

function sameSeg(a, b) {
  const q = (v) => Math.round(v * 1000);
  const k = (s) => `${q(s.x)}|${q(s.z)}`;
  return (k(a.start) === k(b.start) && k(a.end) === k(b.end))
      || (k(a.start) === k(b.end) && k(a.end) === k(b.start));
}

/**
 * Resize a rectangular room by moving the walls that form it.
 *
 * Shared walls move for both rooms, which is correct — a partition belongs to
 * the two spaces either side of it. Only endpoints that actually sit on the
 * old rectangle's edge, within that edge's extent, are moved, so walls
 * elsewhere on the same gridline are left alone.
 */
export function resizeSpaceRect(spaceId, next, { tol = 0.05 } = {}) {
  commit('Resize room', (p, ids) => {
    const s = p.spaces.find((x) => x.id === spaceId);
    if (!s || !s.boundary?.length) return;
    const old = boundsOfPolygon(s.boundary);
    const n = {
      minX: next.x, minZ: next.z,
      maxX: next.x + Math.max(0.2, next.w), maxZ: next.z + Math.max(0.2, next.d),
    };

    const mapX = (x, z) => {
      if (z < old.minZ - 0.5 || z > old.maxZ + 0.5) return x;      // outside this room's span
      if (Math.abs(x - old.minX) <= tol) return n.minX;
      if (Math.abs(x - old.maxX) <= tol) return n.maxX;
      return x;
    };
    const mapZ = (z, x) => {
      if (x < old.minX - 0.5 || x > old.maxX + 0.5) return z;
      if (Math.abs(z - old.minZ) <= tol) return n.minZ;
      if (Math.abs(z - old.maxZ) <= tol) return n.maxZ;
      return z;
    };

    for (const w of p.walls) {
      if (w.levelId !== s.levelId || w.locked) continue;
      for (const end of ['start', 'end']) {
        const pt = w[end];
        const nx = mapX(pt.x, pt.z);
        const nz = mapZ(pt.z, pt.x);
        if (nx !== pt.x || nz !== pt.z) w[end] = { x: nx, z: nz };
      }
      // Keep openings inside a wall that just got shorter.
      const len = dist2(w.start, w.end);
      for (const o of p.openings) {
        if (o.wallId !== w.id) continue;
        o.offset = Math.min(Math.max(o.width / 2 + 0.05, o.offset), Math.max(o.width / 2 + 0.05, len - o.width / 2 - 0.05));
      }
    }

    s.boundary = rect(n.minX, n.minZ, n.maxX - n.minX, n.maxZ - n.minZ);
    s.placeholder = false;

    // The suspended ceiling follows the room.
    for (const slab of p.slabs) {
      if (slab.spaceId !== spaceId || slab.kind !== 'ceiling') continue;
      slab.polygon = rect(n.minX + 0.05, n.minZ + 0.05, (n.maxX - n.minX) - 0.1, (n.maxZ - n.minZ) - 0.1);
    }

    // A shared wall just moved, so every room on this level re-derives its
    // outline from the geometry — otherwise the neighbour's boundary is a lie.
    redetectLevel(p, ids, s.levelId, { createMissing: false });
    touch();
  }, [SCOPE.ARCH, SCOPE.SPACES, SCOPE.ROUTEGRAPH]);
}

function boundsOfPolygon(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const q of poly) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Is this space a plain axis-aligned rectangle we can resize numerically? */
export function isRectSpace(space) {
  const b = space?.boundary;
  if (!b || b.length !== 4) return false;
  const xs = new Set(b.map((q) => Math.round(q.x * 1000)));
  const zs = new Set(b.map((q) => Math.round(q.z * 1000)));
  return xs.size === 2 && zs.size === 2;
}

export { boundsOfPolygon };

/* ================================================================== */
/* BUILDING — openings                                                 */
/* ================================================================== */

export function addOpeningAt(levelId, point, kind = 'door', opts = {}) {
  let created = null;
  const p0 = state.project;
  const walls = wallsOfLevel(p0, levelId);
  const hit = locateOnWall(walls, point, opts.tol ?? 1.2);
  if (!hit) { toast('No wall found here — click on a wall.', 'warn'); return null; }
  commit(`Add ${kind}`, (p, ids) => {
    const def = OPENING_DEFAULTS[kind] || OPENING_DEFAULTS.door;
    const o = makeOpening(ids, {
      wallId: hit.wall.id, kind, offset: hit.offset,
      width: opts.width ?? def.width, height: opts.height ?? def.height, sill: opts.sill ?? def.sill,
    });
    p.openings.push(o);
    const wall = p.walls.find((w) => w.id === o.wallId);
    if (wall) {
      const f = wallFrame(wall);
      const centre = { x: wall.start.x + f.dir.x * o.offset, z: wall.start.z + f.dir.z * o.offset };
      const { spaceA, spaceB } = spacesAdjacentToOpening(centre, f.normal, spacesOfLevel(p, levelId), Math.max(0.5, wall.thickness + 0.35));
      o.spaceA = spaceA; o.spaceB = spaceB;
    }
    created = o;
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
  return created;
}

export function updateOpening(openingId, patch) {
  commit('Edit opening', (p) => {
    const o = p.openings.find((x) => x.id === openingId);
    if (!o) return;
    Object.assign(o, patch);
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
}

export function deleteOpening(openingId) {
  commit('Delete opening', (p) => {
    p.openings = p.openings.filter((o) => o.id !== openingId);
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
}

/* ================================================================== */
/* BUILDING — columns, stairs, slabs                                   */
/* ================================================================== */

export function addColumn(levelId, position, opts = {}) {
  let created = null;
  commit('Add column', (p, ids) => {
    const c = makeColumn(ids, { levelId, position, ...opts });
    p.columns.push(c);
    created = c;
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
  return created;
}

export function addStair(fromLevelId, toLevelId, origin, opts = {}) {
  let created = null;
  commit('Add stair', (p, ids) => {
    const s = makeStair(ids, { fromLevelId, toLevelId, origin, ...opts });
    p.stairs.push(s);
    created = s;
    touch();
  }, [SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
  return created;
}

export function updateEntity(kind, id, patch, { live = false } = {}) {
  const KEY = {
    wall: 'walls', slab: 'slabs', opening: 'openings', stair: 'stairs',
    column: 'columns', space: 'spaces', pathway: 'pathways', rack: 'racks',
    device: 'devices', cable: 'cables', level: 'levels',
  }[kind];
  if (!KEY) return;
  const apply = (p) => {
    const e = p[KEY].find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    if (kind === 'space' || kind === 'wall' || kind === 'opening') e.placeholder = false;
    touch();
  };
  const scope = {
    wall: [SCOPE.ARCH, SCOPE.ROUTEGRAPH], slab: [SCOPE.ARCH], opening: [SCOPE.ARCH, SCOPE.ROUTEGRAPH],
    stair: [SCOPE.ARCH, SCOPE.ROUTEGRAPH], column: [SCOPE.ARCH, SCOPE.ROUTEGRAPH],
    space: [SCOPE.SPACES, SCOPE.ROUTEGRAPH], pathway: [SCOPE.PATHWAYS, SCOPE.ROUTEGRAPH],
    rack: [SCOPE.RACKS, SCOPE.DEVICES], device: [SCOPE.DEVICES], cable: [SCOPE.CABLES],
    level: [SCOPE.ARCH, SCOPE.META],
  }[kind];
  if (live) mutateLive(apply, scope);
  else commit(`Edit ${kind}`, apply, scope);
}

export function deleteEntity(kind, id) {
  switch (kind) {
    case 'wall': return deleteWall(id);
    case 'opening': return deleteOpening(id);
    case 'device': return deleteDevice(id);
    case 'cable': return deleteCable(id);
    case 'level': return deleteLevel(id);
    default: break;
  }
  const KEY = { slab: 'slabs', stair: 'stairs', column: 'columns', space: 'spaces', pathway: 'pathways', rack: 'racks' }[kind];
  if (!KEY) return;
  commit(`Delete ${kind}`, (p) => {
    p[KEY] = p[KEY].filter((x) => x.id !== id);
    if (kind === 'rack') for (const d of p.devices) if (d.rackId === id) { d.rackId = null; d.rackU = null; }
    if (kind === 'space') {
      for (const d of p.devices) if (d.spaceId === id) d.spaceId = null;
      p.slabs = p.slabs.filter((s) => s.spaceId !== id);
    }
    if (kind === 'pathway') for (const c of p.cables) c.pathwayIds = (c.pathwayIds || []).filter((x) => x !== id);
    touch();
  }, [SCOPE.ALL]);
}

/* ================================================================== */
/* BUILDING — room detection                                           */
/* ================================================================== */

/**
 * Re-derive every room boundary on a level from the wall geometry, and
 * refresh door/space associations. Geometry is the source of truth; the Space
 * entity keeps its identity and metadata and takes the new outline.
 */
function redetectLevel(p, ids, levelId, { createMissing = true } = {}) {
  const walls = p.walls.filter((w) => w.levelId === levelId);
  const faces = detectFaces(walls, { minArea: 1.2 });
  const existing = p.spaces.filter((s) => s.levelId === levelId);
  const { updated, created, orphaned } = reconcileSpaces(faces, existing);

  for (const u of updated) {
    const s = p.spaces.find((x) => x.id === u.spaceId);
    if (!s) continue;
    s.boundary = u.boundary;
    s.wallIds = u.wallIds;
    s.detected = true;
    // Keep each room's suspended ceiling on its new outline.
    for (const slab of p.slabs) {
      if (slab.spaceId === s.id && slab.kind === 'ceiling') slab.polygon = shrinkBoundary(u.boundary, 0.05);
    }
  }
  if (createMissing) {
    for (const c of created) {
      p.spaces.push(makeSpace(ids, {
        levelId, name: `Space ${p.spaces.filter((s) => s.levelId === levelId).length + 1}`,
        kind: c.area > 80 ? 'hall' : 'room', boundary: c.boundary, wallIds: c.wallIds, detected: true,
      }));
    }
  }
  for (const o of orphaned) o.detected = false;

  // Refresh door ↔ space associations for this level.
  const spaces = p.spaces.filter((s) => s.levelId === levelId);
  for (const o of p.openings) {
    const w = p.walls.find((x) => x.id === o.wallId);
    if (!w || w.levelId !== levelId) continue;
    const f = wallFrame(w);
    const centre = { x: w.start.x + f.dir.x * o.offset, z: w.start.z + f.dir.z * o.offset };
    const r = spacesAdjacentToOpening(centre, f.normal, spaces, Math.max(0.5, w.thickness + 0.35));
    o.spaceA = r.spaceA; o.spaceB = r.spaceB;
  }
  return { updated: updated.length, created: createMissing ? created.length : 0, orphaned: orphaned.length };
}

/** Inset a polygon slightly so a ceiling tile sits inside its walls. */
function shrinkBoundary(poly, d) {
  const c = polygonCentroid(poly);
  return poly.map((q) => {
    const dx = q.x - c.x, dz = q.z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    const nl = Math.max(0.05, l - d);
    return { x: c.x + (dx / l) * nl, z: c.z + (dz / l) * nl };
  });
}

export function detectRooms(levelId) {
  let summary = { updated: 0, created: 0, orphaned: 0 };
  commit('Detect rooms from walls', (p, ids) => {
    summary = redetectLevel(p, ids, levelId);
    touch();
  }, [SCOPE.SPACES, SCOPE.ARCH, SCOPE.ROUTEGRAPH]);
  toast(`Rooms detected — ${summary.updated} updated, ${summary.created} new, ${summary.orphaned} without geometry.`, 'ok');
  return summary;
}

/* ================================================================== */
/* INFRASTRUCTURE — devices                                            */
/* ================================================================== */

export function addDevice(templateId, position, opts = {}) {
  let created = null;
  const item = catalogItem(templateId);
  if (item.creates === 'rack') return addRack(position, { ...opts, rackUnits: item.rackUnits ?? 42, size: item.size });

  commit(`Add ${item.name}`, (p, ids) => {
    const dev = instantiate(ids, templateId, opts.overrides || {});
    dev.position = { ...position };
    if (opts.rotation != null) dev.rotation = opts.rotation;
    if (opts.mounting) dev.mounting = opts.mounting;
    dev.scenarioId = state.view.scenarioId || 'SCENARIO-PERMANENT';
    const resolved = resolveSpaceForPosition(p, position);
    dev.levelId = opts.levelId || resolved.levelId;
    dev.spaceId = opts.spaceId !== undefined ? opts.spaceId : resolved.spaceId;
    if (opts.rackId) {
      const rack = p.racks.find((r) => r.id === opts.rackId);
      if (rack) {
        dev.rackId = rack.id;
        dev.mounting = 'rack';
        dev.spaceId = rack.spaceId;
        dev.levelId = rack.levelId;
        invalidateIndex();
        dev.rackU = opts.rackU ?? findFreeRackU(p, rack, dev.rackUnits) ?? 1;
      }
    }
    // Give the device a sensible name if the user hasn't typed one.
    if (!opts.overrides?.name) {
      const space = dev.spaceId ? p.spaces.find((s) => s.id === dev.spaceId) : null;
      dev.name = space ? `${space.name} — ${item.name}` : item.name;
    }
    p.devices.push(dev);
    created = dev;
    touch();
  }, [SCOPE.DEVICES, SCOPE.ROUTEGRAPH]);
  return created;
}

export function moveDevice(deviceId, position, { live = false, rotation = null } = {}) {
  const apply = (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    if (!d) return;
    d.position = { ...position };
    if (rotation != null) d.rotation = rotation;
    if (!d.rackId) {
      const r = resolveSpaceForPosition(p, position);
      d.levelId = r.levelId; d.spaceId = r.spaceId;
    }
    touch();
  };
  if (live) mutateLive(apply, [SCOPE.DEVICES, SCOPE.CABLES]);
  else commit('Move device', (p) => { apply(p); rerouteCablesOf(p, deviceId); }, [SCOPE.DEVICES, SCOPE.CABLES, SCOPE.ROUTEGRAPH]);
}

export function deleteDevice(deviceId) {
  commit('Delete device', (p) => {
    p.devices = p.devices.filter((d) => d.id !== deviceId);
    p.cables = p.cables.filter((c) => c.from?.deviceId !== deviceId && c.to?.deviceId !== deviceId);
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES, SCOPE.ROUTEGRAPH]);
}

export function duplicateDevice(deviceId, offset = { x: 1, y: 0, z: 0 }) {
  let created = null;
  commit('Duplicate device', (p, ids) => {
    const src = p.devices.find((d) => d.id === deviceId);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = ids.next(catalogItem(src.typeId).idPrefix);
    copy.name = `${src.name} (copy)`;
    copy.ports = copy.ports.map((pt) => ({ ...pt, id: ids.next('PORT') }));
    copy.links = [];
    copy.position = { x: src.position.x + offset.x, y: src.position.y + offset.y, z: src.position.z + offset.z };
    copy.rackId = null; copy.rackU = null;
    const r = resolveSpaceForPosition(p, copy.position);
    copy.levelId = r.levelId; copy.spaceId = r.spaceId;
    p.devices.push(copy);
    created = copy;
    touch();
  }, [SCOPE.DEVICES]);
  return created;
}

export function mountInRack(deviceId, rackId, rackU = null) {
  commit('Mount in rack', (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    const r = p.racks.find((x) => x.id === rackId);
    if (!d || !r) return;
    invalidateIndex();
    d.rackId = rackId;
    d.mounting = 'rack';
    d.spaceId = r.spaceId;
    d.levelId = r.levelId;
    d.rackU = rackU ?? findFreeRackU(p, r, d.rackUnits) ?? 1;
    rerouteCablesOf(p, deviceId);
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES, SCOPE.RACKS]);
}

export function unmountFromRack(deviceId) {
  commit('Remove from rack', (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    if (!d || !d.rackId) return;
    const r = p.racks.find((x) => x.id === d.rackId);
    if (r) d.position = { x: r.position.x + 1.2, y: 0.9, z: r.position.z };
    d.rackId = null; d.rackU = null; d.mounting = 'floor';
    rerouteCablesOf(p, deviceId);
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES, SCOPE.RACKS]);
}

/* ---- ports ---- */

export function addPort(deviceId, patch = {}) {
  let created = null;
  commit('Add port', (p, ids) => {
    const d = p.devices.find((x) => x.id === deviceId);
    if (!d) return;
    const port = makePort(ids, { name: patch.name || `Port ${d.ports.length + 1}`, verified: true, ...patch });
    d.ports.push(port);
    created = port;
    touch();
  }, [SCOPE.DEVICES]);
  return created;
}

export function updatePort(deviceId, portId, patch) {
  commit('Edit port', (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    const port = d?.ports.find((x) => x.id === portId);
    if (!port) return;
    Object.assign(port, patch);
    port.verified = true;
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES]);
}

export function deletePort(deviceId, portId) {
  commit('Delete port', (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    if (!d) return;
    d.ports = d.ports.filter((x) => x.id !== portId);
    d.links = (d.links || []).filter((l) => l.from !== portId && l.to !== portId);
    p.cables = p.cables.filter((c) => c.from?.portId !== portId && c.to?.portId !== portId);
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES]);
}

export function setDeviceLinks(deviceId, links, passthrough) {
  commit('Edit signal continuity', (p) => {
    const d = p.devices.find((x) => x.id === deviceId);
    if (!d) return;
    if (links) d.links = links;
    if (passthrough) d.passthrough = passthrough;
    touch();
  }, [SCOPE.DEVICES]);
}

/* ================================================================== */
/* INFRASTRUCTURE — racks & pathways                                   */
/* ================================================================== */

export function addRack(position, opts = {}) {
  let created = null;
  commit('Add rack', (p, ids) => {
    const r = resolveSpaceForPosition(p, position);
    const lvl = r.levelId ? p.levels.find((l) => l.id === r.levelId) : null;
    const rack = makeRack(ids, {
      name: opts.name || `Rack ${p.racks.length + 1}`,
      position: { ...position, y: opts.y ?? (lvl ? lvl.elevation : 0) },
      spaceId: r.spaceId, levelId: r.levelId,
      rackUnits: opts.rackUnits ?? 42,
      scenarioId: state.view.scenarioId,
    });
    p.racks.push(rack);
    created = rack;
    touch();
  }, [SCOPE.RACKS, SCOPE.ROUTEGRAPH]);
  return created;
}

export function addPathway(points, opts = {}) {
  let created = null;
  commit('Add pathway', (p, ids) => {
    const pw = makePathway(ids, {
      name: opts.name || `${(opts.kind || 'tray')} ${p.pathways.length + 1}`,
      kind: opts.kind || 'tray', points, levelId: opts.levelId || null,
      width: opts.width, height: opts.height, capacity: opts.capacity,
    });
    p.pathways.push(pw);
    created = pw;
    touch();
  }, [SCOPE.PATHWAYS, SCOPE.ROUTEGRAPH]);
  return created;
}

/* ================================================================== */
/* CABLES                                                              */
/* ================================================================== */

/**
 * Create a cable between two ports.
 * The route is generated by the physical router unless one is supplied.
 */
export function createCable(src, dst, opts = {}) {
  let created = null;
  const p0 = state.project;
  const srcDev = getDevice(p0, src.deviceId);
  const dstDev = getDevice(p0, dst.deviceId);
  if (!srcDev || !dstDev) { toast('Both endpoints must exist.', 'err'); return null; }
  const srcPort = srcDev.ports.find((x) => x.id === src.portId);
  const dstPort = dstDev.ports.find((x) => x.id === dst.portId);
  if (!srcPort || !dstPort) { toast('Both ports must exist.', 'err'); return null; }

  const typeId = opts.typeId || suggestCableType(p0, srcPort, dstPort).id;
  const type = p0.cableTypes.find((t) => t.id === typeId);

  const from = portAnchor(p0, srcDev, srcPort);
  const to = portAnchor(p0, dstDev, dstPort);
  let route = opts.route;
  let pathwayIds = [];
  let openingIds = [];
  let warnings = [];
  if (route && route.length >= 2) {
    pathwayIds = detectPathwaysAlong(p0, route);
    openingIds = detectOpeningsAlong(p0, indexRev(), route);
  } else {
    const res = routeBetween(p0, indexRev(), from, to, { fromSpaceId: srcDev.spaceId, toSpaceId: dstDev.spaceId });
    route = res.route; pathwayIds = res.pathwayIds; openingIds = res.openingIds; warnings = res.warnings;
  }

  commit('Add cable', (p, ids) => {
    const cable = makeCable(ids, {
      id: ids.next(`CABLE-${(type?.id || 'CT-CUSTOM').replace('CT-', '')}`),
      typeId, signal: type?.signal || 'data',
      from: { deviceId: src.deviceId, portId: src.portId },
      to: { deviceId: dst.deviceId, portId: dst.portId },
      route, pathwayIds, openingIds, warnings,
      routeMode: opts.route ? 'manual' : 'auto',
      status: opts.status || (state.view.scenarioId === 'SCENARIO-FUTURE' ? 'planned' : 'installed'),
      scenarioId: opts.scenarioId || state.view.scenarioId || 'SCENARIO-PERMANENT',
      label: opts.label || '',
      notes: opts.notes || '',
    });
    cable.length = cableLength(p, cable, cable.route);
    p.cables.push(cable);
    created = cable;
    touch();
  }, [SCOPE.CABLES]);

  // Containment fill is an engineering constraint, so say so immediately.
  if (created) warnOnFullPathways(created.pathwayIds);
  return created;
}

function warnOnFullPathways(pathwayIds) {
  for (const pid of pathwayIds || []) {
    const pw = getPathway(state.project, pid);
    if (!pw) continue;
    const u = pathwayUtilisation(state.project, pw);
    if (u.used > u.capacity) {
      toast(`${pw.name} is over capacity — ${u.used} cables in ${u.capacity} ways (${(u.fillRatio * 100).toFixed(0)}% fill).`, 'err', 8000);
    } else if (u.ratio > 0.85 || u.fillRatio > 0.85) {
      toast(`${pw.name} is at ${(Math.max(u.ratio, u.fillRatio) * 100).toFixed(0)}% capacity.`, 'warn', 6000);
    }
  }
}

export function setCableRoute(cableId, route, { mode = 'manual' } = {}) {
  commit('Edit cable route', (p) => {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c) return;
    c.route = route;
    c.routeMode = mode;
    c.pathwayIds = detectPathwaysAlong(p, route);
    c.openingIds = detectOpeningsAlong(p, indexRev(), route);
    c.length = cableLength(p, c, route);
    touch();
  }, [SCOPE.CABLES]);
}

/* ---- waypoint editing ---- */

/** Recompute everything that depends on a cable's physical route. */
function refreshRoute(p, cable) {
  invalidateIndex();
  cable.length = cableLength(p, cable, cable.route);
  cable.pathwayIds = detectPathwaysAlong(p, cable.route);
  cable.openingIds = detectOpeningsAlong(p, indexRev(), cable.route);
  const problems = validateRoute(p, indexRev(), cable.route);
  cable.warnings = problems.length
    ? [`Route passes through building fabric at ${problems.length} segment(s): ${Array.from(new Set(problems.map((x) => x.reason))).join(', ')}.`]
    : [];
}

/**
 * Move one waypoint of a cable's route.
 * The first and last points are the port anchors and cannot be moved — that
 * would detach the cable from its device.
 */
export function moveCableWaypoint(cableId, index, position, { live = false } = {}) {
  const apply = (p) => {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c || !c.route || index <= 0 || index >= c.route.length - 1) return;
    if (c.routeMode === 'locked') return;
    c.route[index] = { x: position.x, y: position.y, z: position.z };
    if (c.routeMode === 'auto') c.routeMode = 'semi';
    if (live) {
      c.length = cableLength(p, c, c.route);
      touch();
      return;
    }
    refreshRoute(p, c);
    touch();
  };
  if (live) mutateLive(apply, [SCOPE.CABLES]);
  else commit('Move cable waypoint', apply, [SCOPE.CABLES]);
}

/** Insert a new waypoint into the segment starting at `afterIndex`. */
export function insertCableWaypoint(cableId, afterIndex, position) {
  let created = -1;
  commit('Add cable waypoint', (p) => {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c || !c.route || afterIndex < 0 || afterIndex >= c.route.length - 1) return;
    if (c.routeMode === 'locked') return;
    c.route.splice(afterIndex + 1, 0, { x: position.x, y: position.y, z: position.z });
    if (c.routeMode === 'auto') c.routeMode = 'semi';
    created = afterIndex + 1;
    refreshRoute(p, c);
    touch();
  }, [SCOPE.CABLES]);
  return created;
}

export function deleteCableWaypoint(cableId, index) {
  commit('Delete cable waypoint', (p) => {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c || !c.route || index <= 0 || index >= c.route.length - 1) return;
    if (c.routeMode === 'locked') return;
    if (c.route.length <= 2) return;
    c.route.splice(index, 1);
    if (c.routeMode === 'auto') c.routeMode = 'semi';
    refreshRoute(p, c);
    touch();
  }, [SCOPE.CABLES]);
}

export function setRouteMode(cableId, mode) {
  commit('Set route mode', (p) => {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c) return;
    c.routeMode = mode;
    touch();
  }, [SCOPE.CABLES]);
}

export function rerouteCable(cableId) {
  commit('Re-route cable', (p) => {
    rerouteOne(p, p.cables.find((c) => c.id === cableId));
    touch();
  }, [SCOPE.CABLES]);
}

function rerouteOne(p, cable) {
  if (!cable || !cable.from || !cable.to) return;
  const a = p.devices.find((d) => d.id === cable.from.deviceId);
  const b = p.devices.find((d) => d.id === cable.to.deviceId);
  if (!a || !b) return;
  const pa = a.ports.find((x) => x.id === cable.from.portId);
  const pb = b.ports.find((x) => x.id === cable.to.portId);
  if (!pa || !pb) return;
  invalidateIndex();
  const res = routeBetween(p, indexRev(), portAnchor(p, a, pa), portAnchor(p, b, pb), {
    fromSpaceId: a.spaceId, toSpaceId: b.spaceId,
  });
  cable.route = res.route;
  cable.pathwayIds = res.pathwayIds;
  cable.openingIds = res.openingIds;
  cable.warnings = res.warnings;
  cable.routeMode = 'auto';
  cable.length = cableLength(p, cable, cable.route);
}

/**
 * Re-attach a semi-automatic route to its (moved) devices without discarding
 * the engineer's interior waypoints — only the port anchors follow the device.
 */
function reattachEnds(p, cable) {
  if (!cable.from || !cable.to || (cable.route || []).length < 2) return;
  const a = p.devices.find((d) => d.id === cable.from.deviceId);
  const b = p.devices.find((d) => d.id === cable.to.deviceId);
  if (!a || !b) return;
  const pa = a.ports.find((x) => x.id === cable.from.portId);
  const pb = b.ports.find((x) => x.id === cable.to.portId);
  if (!pa || !pb) return;
  invalidateIndex();
  cable.route[0] = portAnchor(p, a, pa);
  cable.route[cable.route.length - 1] = portAnchor(p, b, pb);
  refreshRoute(p, cable);
}

function rerouteCablesOf(p, deviceId) {
  for (const c of p.cables) {
    if (c.routeMode === 'manual' || c.routeMode === 'locked') continue;
    if (c.from?.deviceId !== deviceId && c.to?.deviceId !== deviceId) continue;
    if (c.routeMode === 'semi') reattachEnds(p, c);
    else rerouteOne(p, c);
  }
}

/**
 * The router proposes, the engineer disposes: automatic routes regenerate,
 * semi-automatic routes keep their waypoints, manual and locked are untouched
 * unless explicitly asked for.
 */
export function rerouteAll({ includeManual = false, includeLocked = false } = {}) {
  let n = 0, kept = 0;
  commit('Re-route all cables', (p) => {
    for (const c of p.cables) {
      if (c.routeMode === 'locked' && !includeLocked) { kept++; continue; }
      if (c.routeMode === 'manual' && !includeManual) { kept++; continue; }
      if (c.routeMode === 'semi' && !includeManual) { reattachEnds(p, c); kept++; continue; }
      rerouteOne(p, c);
      n++;
    }
    touch();
  }, [SCOPE.CABLES]);
  toast(
    `${n} cable${n === 1 ? '' : 's'} re-routed${kept ? `, ${kept} left as designed (manual / locked / semi-automatic)` : ''}.`,
    'ok', 5000
  );
}

export function deleteCable(cableId) {
  commit('Delete cable', (p) => {
    p.cables = p.cables.filter((c) => c.id !== cableId);
    touch();
  }, [SCOPE.CABLES]);
}

export function duplicateCable(cableId) {
  let created = null;
  commit('Duplicate cable', (p, ids) => {
    const src = p.cables.find((c) => c.id === cableId);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = ids.next(`CABLE-${src.typeId.replace('CT-', '')}`);
    copy.name = '';
    p.cables.push(copy);
    created = copy;
    touch();
  }, [SCOPE.CABLES]);
  return created;
}

/* ================================================================== */
/* CONFIG — cable types, scenarios                                     */
/* ================================================================== */

export function updateCableType(typeId, patch) {
  commit('Edit cable type', (p) => {
    const t = p.cableTypes.find((x) => x.id === typeId);
    if (!t) return;
    Object.assign(t, patch);
    if (patch.signal) for (const c of p.cables) if (c.typeId === typeId) c.signal = patch.signal;
    touch();
  }, [SCOPE.META, SCOPE.CABLES]);
}

export function addCableType(patch) {
  let created = null;
  commit('Add cable type', (p, ids) => {
    const t = {
      id: ids.next('CT', 2), name: patch.name || 'New cable type', signal: patch.signal || 'data',
      family: patch.family || 'custom', color: patch.color || '#8d9aab',
      category: patch.category || 'Other', diameter: patch.diameter ?? 0.006,
      maxLength: patch.maxLength ?? null, slack: patch.slack ?? 1.08,
    };
    p.cableTypes.push(t);
    created = t;
    touch();
  }, [SCOPE.META]);
  return created;
}

export function addScenario(patch) {
  let created = null;
  commit('Add scenario', (p, ids) => {
    const s = {
      id: ids.next('SCENARIO', 2), name: patch.name || 'New scenario', kind: patch.kind || 'event',
      base: patch.base ?? 'SCENARIO-PERMANENT', color: patch.color || '#58c6e8', active: true, notes: patch.notes || '',
    };
    p.scenarios.push(s);
    created = s;
    touch();
  }, [SCOPE.META]);
  return created;
}

export function deleteScenario(scenarioId) {
  if (scenarioId === 'SCENARIO-PERMANENT') { toast('The permanent layer cannot be deleted.', 'warn'); return; }
  commit('Delete scenario', (p) => {
    p.scenarios = p.scenarios.filter((s) => s.id !== scenarioId);
    p.devices = p.devices.filter((d) => d.scenarioId !== scenarioId);
    p.cables = p.cables.filter((c) => c.scenarioId !== scenarioId);
    touch();
  }, [SCOPE.ALL]);
}

/** Project-level metadata: name, client, reference, and the building it covers. */
export function updateProjectMeta(patch) {
  commit('Edit project', (p) => {
    const { building, ...rest } = patch;
    Object.assign(p, rest);
    if (building) Object.assign(p.building, building);
    touch();
  }, [SCOPE.META]);
}

export function updateSettings(patch) {
  commit('Edit settings', (p) => {
    deepMerge(p.settings, patch);
    touch();
  }, [SCOPE.META, SCOPE.CABLES]);
}

function deepMerge(t, s) {
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object') deepMerge(t[k], v);
    else t[k] = v;
  }
  return t;
}

/* ================================================================== */
/* bulk                                                                */
/* ================================================================== */

export function clearInfrastructure() {
  commit('Clear all infrastructure', (p) => {
    p.devices = [];
    p.cables = [];
    p.racks = [];
    touch();
  }, [SCOPE.DEVICES, SCOPE.CABLES, SCOPE.RACKS]);
  toast('All equipment and cables removed. The building is untouched.', 'ok');
}

export function renameSpaces(pairs) {
  transaction('Rename spaces', (p) => {
    for (const { id, name, code } of pairs) {
      const s = p.spaces.find((x) => x.id === id);
      if (!s) continue;
      if (name != null) s.name = name;
      if (code != null) s.code = code;
      s.placeholder = false;
    }
    touch();
  }, [SCOPE.SPACES]);
}

export { polygonCentroid, getSpace, getLevel, getRack, select };
