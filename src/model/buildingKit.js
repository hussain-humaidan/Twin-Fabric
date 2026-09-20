/**
 * Building kit - reusable constructors that turn a room layout into real
 * parametric geometry: split wall networks, doors, windows, tray
 * penetrations, and opening-to-space association.
 *
 * Deliberately generic. Nothing here knows what KIND of building it is
 * making; the templates in model/templates/ supply the layout.
 */
import { makeWall, makeSlab, makeOpening, makeSpace } from './schema.js';
import { buildWallNetwork, locateOnWall } from '../logic/wallNetwork.js';
import { wallFrame } from '../logic/geometry.js';
import { spacesAdjacentToOpening } from '../logic/spaceDetect.js';
import { rect, pointInPolygon, dist2, segIntersect2 } from '../core/math.js';
/* ------------------------------------------------------------------ */
/* shared builders                                                     */
/* ------------------------------------------------------------------ */

function addLevelFromRects(project, ids, level, rects, opts = {}) {
  const {
    interiorThickness = 0.15, exteriorThickness = 0.30,
    exteriorMaterial = 'MAT-BLOCK', interiorMaterial = 'MAT-PARTITION',
    bounds,
  } = opts;
  const wallHeight = level.height - level.slabThickness;

  const specs = buildWallNetwork(rects.map((r) => r.rect), { bounds });
  const walls = specs.map((s) => makeWall(ids, {
    levelId: level.id,
    start: s.start, end: s.end,
    height: wallHeight,
    thickness: s.type === 'exterior' ? exteriorThickness : interiorThickness,
    type: s.type,
    materialId: s.type === 'exterior' ? exteriorMaterial : interiorMaterial,
    structural: s.type === 'exterior',
    placeholder: true,
  }));
  project.walls.push(...walls);

  const spaces = rects.map((r) => makeSpace(ids, {
    id: r.id,
    code: r.code,
    name: r.name,
    levelId: level.id,
    kind: r.kind,
    group: r.group || null,
    boundary: rect(r.rect.x, r.rect.z, r.rect.w, r.rect.d),
    ceilingHeight: r.ceilingHeight ?? null,
    placeholder: true,
  }));
  project.spaces.push(...spaces);

  // Every space carries its own suspended ceiling so it can be hidden alone.
  if (level.hasCeiling) {
    for (const r of rects) {
      if (r.noCeiling) continue;
      project.slabs.push(makeSlab(ids, {
        levelId: level.id, kind: 'ceiling', spaceId: r.id,
        name: `Ceiling — ${r.name}`,
        polygon: rect(r.rect.x + 0.05, r.rect.z + 0.05, r.rect.w - 0.1, r.rect.d - 0.1),
        thickness: level.ceilingThickness,
        topElevation: level.elevation + (r.ceilingHeight ?? level.ceilingHeight),
        materialId: 'MAT-CEILING',
      }));
    }
  }
  return { walls, spaces };
}

/** Place a door (and, above it, a cable penetration) on whatever wall is at `at`. */
function addDoor(project, ids, walls, at, opts = {}) {
  const hit = locateOnWall(walls, at, opts.tol ?? 0.8);
  if (!hit) return null;
  const door = makeOpening(ids, {
    wallId: hit.wall.id,
    kind: opts.kind || 'door',
    offset: hit.offset,
    width: opts.width,
    height: opts.height,
    name: opts.name || '',
  });
  project.openings.push(door);
  if (opts.penetration !== false) {
    const len = dist2(hit.wall.start, hit.wall.end);
    let pOffset = hit.offset + (opts.penetrationGap ?? 1.3);
    if (pOffset > len - 0.4) pOffset = hit.offset - (opts.penetrationGap ?? 1.3);
    if (pOffset > 0.3 && pOffset < len - 0.3) {
      project.openings.push(makeOpening(ids, {
        wallId: hit.wall.id,
        kind: 'penetration',
        offset: pOffset,
        width: 0.3,
        height: 0.3,
        sill: opts.penetrationSill ?? (hit.wall.height - 0.35),
        name: 'Cable penetration',
      }));
    }
  }
  return door;
}

/** Windows at regular centres along every long exterior wall. */
function addWindows(project, ids, walls, { spacing = 4.5, width = 1.5, height = 1.6, sill = 0.95, skipSpaces = [] } = {}) {
  for (const w of walls) {
    if (w.type !== 'exterior') continue;
    const len = dist2(w.start, w.end);
    if (len < 3.2) continue;
    const n = Math.max(1, Math.floor(len / spacing));
    const step = len / (n + 1);
    for (let i = 1; i <= n; i++) {
      const offset = step * i;
      if (offset < 1.1 || offset > len - 1.1) continue;
      project.openings.push(makeOpening(ids, {
        wallId: w.id, kind: 'window', offset, width, height, sill,
      }));
    }
  }
}

/**
 * Cut a sleeved penetration wherever a cable tray crosses a wall — which is
 * exactly what happens on site, and what makes the route legal to the
 * collision checker. Crossings already served by an opening are left alone.
 */
function addTrayPenetrations(project, ids, pathway) {
  if (!pathway.levelId) return;                        // risers go through slabs
  const levels = new Map(project.levels.map((l) => [l.id, l]));
  const walls = project.walls.filter((w) => w.levelId === pathway.levelId);
  const pts = pathway.points || [];
  const h = Math.max(0.3, (pathway.height || 0.1) + 0.2);
  const wdt = Math.max(0.4, (pathway.width || 0.3) + 0.15);

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    for (const w of walls) {
      const hit = segIntersect2({ x: a.x, z: a.z }, { x: b.x, z: b.z }, w.start, w.end);
      if (!hit) continue;
      const lvl = levels.get(w.levelId);
      const base = (lvl ? lvl.elevation : 0) + (w.baseOffset || 0);
      const y = a.y + (b.y - a.y) * hit.t;
      if (y < base + 0.05 || y > base + w.height - 0.05) continue;
      const len = dist2(w.start, w.end);
      const offset = hit.u * len;
      if (offset < 0.4 || offset > len - 0.4) continue;

      const existing = project.openings.filter((o) => o.wallId === w.id);
      // Overlapping offsets would merge in wall segmentation — skip those.
      if (existing.some((o) => Math.abs(o.offset - offset) < (o.width + wdt) / 2 + 0.1)) continue;

      project.openings.push(makeOpening(ids, {
        wallId: w.id, kind: 'penetration', offset,
        width: wdt, height: h, sill: y - base - h / 2,
        name: `Tray penetration — ${pathway.name}`,
      }));
    }
  }
}

function associateOpenings(project) {
  const wallsById = new Map(project.walls.map((w) => [w.id, w]));
  const levelsById = new Map(project.levels.map((l) => [l.id, l]));
  for (const o of project.openings) {
    const w = wallsById.get(o.wallId);
    if (!w) continue;
    const f = wallFrame(w);
    const centre = { x: w.start.x + f.dir.x * o.offset, z: w.start.z + f.dir.z * o.offset };
    const spaces = project.spaces.filter((s) => s.levelId === w.levelId);
    const { spaceA, spaceB } = spacesAdjacentToOpening(centre, f.normal, spaces, Math.max(0.5, w.thickness + 0.35));
    o.spaceA = spaceA; o.spaceB = spaceB;
  }
  // Give every space its wall + opening lists.
  const openingsByWall = new Map();
  for (const o of project.openings) {
    if (!openingsByWall.has(o.wallId)) openingsByWall.set(o.wallId, []);
    openingsByWall.get(o.wallId).push(o.id);
  }
  for (const s of project.spaces) {
    if (!s.boundary.length) continue;
    const wallIds = [];
    for (const w of project.walls) {
      if (w.levelId !== s.levelId) continue;
      const mid = { x: (w.start.x + w.end.x) / 2, z: (w.start.z + w.end.z) / 2 };
      if (nearPolygonEdge(mid, s.boundary, Math.max(0.4, w.thickness))) wallIds.push(w.id);
    }
    s.wallIds = wallIds;
    s.openingIds = wallIds.flatMap((id) => openingsByWall.get(id) || [])
      .filter((oid) => {
        const o = project.openings.find((x) => x.id === oid);
        return o && (o.spaceA === s.id || o.spaceB === s.id || o.kind === 'window');
      });
  }
}

function nearPolygonEdge(p, poly, tol) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ax = b.x - a.x, az = b.z - a.z;
    const l2 = ax * ax + az * az;
    let t = l2 > 1e-9 ? ((p.x - a.x) * ax + (p.z - a.z) * az) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: a.x + ax * t, z: a.z + az * t };
    if (dist2(p, q) < tol) return true;
  }
  return false;
}

function spaceAtPoint(project, levelId, pt) {
  let best = null, bestArea = Infinity;
  for (const s of project.spaces) {
    if (s.levelId !== levelId || !s.boundary.length) continue;
    if (!pointInPolygon(pt, s.boundary)) continue;
    const b = s.boundary;
    let area = 0;
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) area += b[j].x * b[i].z - b[i].x * b[j].z;
    area = Math.abs(area / 2);
    if (area < bestArea) { bestArea = area; best = s; }
  }
  return best;
}

export {
  addLevelFromRects, addDoor, addWindows, addTrayPenetrations,
  associateOpenings, spaceAtPoint,
};
