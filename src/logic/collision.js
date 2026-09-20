/**
 * Physical collision against the building.
 *
 * Two consumers:
 *   1. the cable router — a cable may only cross a wall through an opening
 *      that actually admits cables, and may only change level through a slab
 *      penetration, shaft or stair void;
 *   2. first-person walkthrough — walls block, doors and archways don't,
 *      floors and stair treads carry the walker.
 */
import { segIntersect2, pointInPolygon, closestOnSegment2, dist2, polygonArea } from '../core/math.js';
import { wallFrame, stairGeometry, columnFootprint } from './geometry.js';

let cacheKey = null;
let cacheVal = null;

/** Pre-computed, level-bucketed obstacle index. Rebuilt when the project changes. */
export function collisionIndex(project, rev) {
  if (cacheVal && cacheKey === rev && cacheVal.project === project) return cacheVal;
  const levels = new Map(project.levels.map((l) => [l.id, l]));
  const openingsByWall = new Map();
  for (const o of project.openings) {
    if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, []);
    openingsByWall.get(o.wallId).push(o);
  }

  const walls = project.walls.map((w) => {
    const lvl = levels.get(w.levelId);
    const base = (lvl ? lvl.elevation : 0) + (w.baseOffset || 0);
    const f = wallFrame(w);
    return {
      wall: w, frame: f, baseY: base, topY: base + w.height,
      openings: (openingsByWall.get(w.id) || []).map((o) => ({
        o, yMin: base + (o.sill || 0), yMax: base + (o.sill || 0) + o.height,
        uMin: o.offset - o.width / 2, uMax: o.offset + o.width / 2,
      })),
      bounds: {
        minX: Math.min(w.start.x, w.end.x) - w.thickness,
        maxX: Math.max(w.start.x, w.end.x) + w.thickness,
        minZ: Math.min(w.start.z, w.end.z) - w.thickness,
        maxZ: Math.max(w.start.z, w.end.z) + w.thickness,
      },
    };
  });

  const columns = project.columns.map((c) => {
    const lvl = levels.get(c.levelId);
    const base = lvl ? lvl.elevation : 0;
    return { column: c, poly: columnFootprint(c), baseY: base, topY: base + (c.height ?? (lvl?.height || 3)) };
  });

  const slabs = project.slabs
    .filter((s) => s.kind === 'floor' || s.kind === 'roof')
    .map((s) => ({ slab: s, y: s.topElevation, bottom: s.topElevation - s.thickness }));

  const stairVoids = project.stairs.map((st) => {
    const from = levels.get(st.fromLevelId), to = levels.get(st.toLevelId);
    const g = stairGeometry(st, from?.elevation ?? 0, to?.elevation ?? 3);
    return { stair: st, poly: g.footprint, yMin: from?.elevation ?? 0, yMax: to?.elevation ?? 3, geom: g };
  });

  cacheKey = rev;
  cacheVal = { project, levels, walls, columns, slabs, stairVoids };
  return cacheVal;
}

const between = (v, a, b, tol = 0) => v >= Math.min(a, b) - tol && v <= Math.max(a, b) + tol;

/**
 * Can a straight 3D segment physically exist between p0 and p1?
 * @returns {{ blocked:boolean, reason?:string, wallId?:string, openingId?:string,
 *             openingIds:string[], columnId?:string, slabId?:string }}
 */
export function segmentBlocked(project, rev, p0, p1, opts = {}) {
  const {
    allowDoors = true,
    ignoreSlabs = false,
    slabPenetrationTolerance = 0.45,
    radius = 0.0,
  } = opts;
  const idx = collisionIndex(project, rev);
  const openingIds = [];

  const minX = Math.min(p0.x, p1.x) - radius, maxX = Math.max(p0.x, p1.x) + radius;
  const minZ = Math.min(p0.z, p1.z) - radius, maxZ = Math.max(p0.z, p1.z) + radius;
  const minY = Math.min(p0.y, p1.y), maxY = Math.max(p0.y, p1.y);

  /* ---- walls ---- */
  for (const w of idx.walls) {
    if (w.bounds.maxX < minX || w.bounds.minX > maxX) continue;
    if (w.bounds.maxZ < minZ || w.bounds.minZ > maxZ) continue;
    if (w.topY < minY - 0.001 || w.baseY > maxY + 0.001) continue;

    const hit = segIntersect2(
      { x: p0.x, z: p0.z }, { x: p1.x, z: p1.z },
      w.wall.start, w.wall.end
    );
    if (!hit) continue;

    const y = p0.y + (p1.y - p0.y) * hit.t;
    if (y < w.baseY - 0.001 || y > w.topY + 0.001) continue; // passes over or under

    const u = hit.u * w.frame.length;
    let through = null;
    for (const op of w.openings) {
      const passable = op.o.cablePassable !== false;
      if (!passable) continue;
      if (op.o.kind === 'door' && !allowDoors) continue;
      if (u >= op.uMin + 0.02 && u <= op.uMax - 0.02 && y >= op.yMin + 0.01 && y <= op.yMax - 0.01) {
        through = op.o;
        break;
      }
    }
    if (through) { openingIds.push(through.id); continue; }
    return { blocked: true, reason: 'wall', wallId: w.wall.id, openingIds };
  }

  /* ---- columns ---- */
  for (const c of idx.columns) {
    if (c.topY < minY - 0.001 || c.baseY > maxY + 0.001) continue;
    if (polygonCrossed(c.poly, p0, p1)) {
      return { blocked: true, reason: 'column', columnId: c.column.id, openingIds };
    }
  }

  /* ---- slabs (level changes) ---- */
  if (!ignoreSlabs && Math.abs(p1.y - p0.y) > 0.05) {
    for (const s of idx.slabs) {
      const y = s.slab.topElevation;
      if (!between(y, p0.y, p1.y, -0.001)) continue;
      const t = (y - p0.y) / (p1.y - p0.y);
      if (t < 0 || t > 1) continue;
      const pt = { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t };
      if (!pointInPolygon(pt, s.slab.polygon)) continue;
      // A hole (stair void / riser) is a legitimate way through.
      let inHole = false;
      for (const h of s.slab.holes || []) if (pointInPolygon(pt, h)) { inHole = true; break; }
      if (inHole) continue;
      // Or a stair void.
      let inStair = false;
      for (const sv of idx.stairVoids) if (pointInPolygon(pt, sv.poly)) { inStair = true; break; }
      if (inStair) continue;
      // Or within tolerance of a vertical shaft pathway.
      if (nearVerticalShaft(project, pt, y, slabPenetrationTolerance)) continue;
      return { blocked: true, reason: 'slab', slabId: s.slab.id, openingIds };
    }
  }

  return { blocked: false, openingIds };
}

function polygonCrossed(poly, p0, p1) {
  const a = { x: p0.x, z: p0.z }, b = { x: p1.x, z: p1.z };
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segIntersect2(a, b, poly[j], poly[i])) return true;
  }
  return false;
}

function nearVerticalShaft(project, pt, y, tol) {
  for (const pw of project.pathways) {
    if (pw.kind !== 'shaft' && pw.kind !== 'conduit' && pw.kind !== 'duct') continue;
    const pts = pw.points || [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.2) continue; // not vertical
      if (y < Math.min(a.y, b.y) - 0.1 || y > Math.max(a.y, b.y) + 0.1) continue;
      if (dist2(pt, { x: a.x, z: a.z }) <= tol + (pw.width || 0.3)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* first-person walkthrough                                            */
/* ------------------------------------------------------------------ */

/** Highest walkable surface at (x,z) at or just below `fromY`. */
export function groundHeightAt(project, rev, x, z, fromY, stepUp = 0.45) {
  const idx = collisionIndex(project, rev);
  let best = -Infinity;
  const pt = { x, z };

  for (const s of idx.slabs) {
    const y = s.slab.topElevation;
    if (y > fromY + stepUp) continue;
    if (!pointInPolygon(pt, s.slab.polygon)) continue;
    let inHole = false;
    for (const h of s.slab.holes || []) if (pointInPolygon(pt, h)) { inHole = true; break; }
    if (inHole) continue;
    if (y > best) best = y;
  }

  for (const sv of idx.stairVoids) {
    if (!pointInPolygon(pt, sv.poly)) continue;
    for (const st of sv.geom.steps) {
      const top = st.position.y + st.size.h / 2;
      if (top > fromY + stepUp) continue;
      const half = Math.max(st.size.w, st.size.d) / 2 + 0.05;
      if (Math.abs(st.position.x - x) > half || Math.abs(st.position.z - z) > half) continue;
      if (top > best) best = top;
    }
    for (const l of sv.geom.landings) {
      const top = l.position.y + l.size.h / 2;
      if (top > fromY + stepUp) continue;
      if (top > best) best = top;
    }
  }

  return best === -Infinity ? null : best;
}

/**
 * Slide a walker against walls. Returns a corrected XZ position.
 * Openings that people can pass through (doors, archways) are ignored.
 */
export function resolveWalk(project, rev, from, to, eyeY, radius = 0.32) {
  const idx = collisionIndex(project, rev);
  let pos = { x: to.x, z: to.z };
  const bodyLow = eyeY - 1.5;
  const bodyHigh = eyeY + 0.1;

  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const w of idx.walls) {
      if (w.topY < bodyLow || w.baseY > bodyHigh) continue;
      if (pos.x < w.bounds.minX - radius || pos.x > w.bounds.maxX + radius) continue;
      if (pos.z < w.bounds.minZ - radius || pos.z > w.bounds.maxZ + radius) continue;

      const near = closestOnSegment2(pos, w.wall.start, w.wall.end);
      const minDist = w.wall.thickness / 2 + radius;
      if (near.dist >= minDist) continue;

      // Is the walker inside a person-passable opening?
      const u = near.t * w.frame.length;
      let open = false;
      for (const op of w.openings) {
        if (op.o.peoplePassable === false) continue;
        if (op.o.kind !== 'door' && op.o.kind !== 'archway') continue;
        if (u > op.uMin + radius * 0.4 && u < op.uMax - radius * 0.4
            && bodyLow >= op.yMin - 0.05 && bodyHigh <= op.yMax + 0.6) { open = true; break; }
      }
      if (open) continue;

      const push = minDist - near.dist + 0.001;
      let nx = pos.x - near.point.x, nz = pos.z - near.point.z;
      const l = Math.hypot(nx, nz);
      if (l < 1e-5) {
        nx = w.frame.normal.x; nz = w.frame.normal.z;
        const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
      } else { nx /= l; nz /= l; }
      pos = { x: pos.x + nx * push, z: pos.z + nz * push };
      moved = true;
    }
    if (!moved) break;
  }
  return pos;
}

/** Space containing a point, ignoring level bands — used for status readout. */
export function spaceAtPoint(project, point, levelId) {
  let found = null, bestArea = Infinity;
  for (const s of project.spaces) {
    if (levelId && s.levelId !== levelId) continue;
    if (!s.boundary?.length || !pointInPolygon(point, s.boundary)) continue;
    const a = Math.abs(polygonArea(s.boundary));
    if (a < bestArea) { bestArea = a; found = s; }
  }
  return found;
}
