/**
 * Rooms detected from wall geometry.
 *
 * Treats the level's wall centrelines as a planar graph, splits every wall at
 * its intersections, then walks the half-edge structure to extract the minimal
 * enclosed cycles — the actual rooms. The Space entity keeps the metadata
 * (name, code, equipment, cables); this is what supplies its real boundary.
 */
import { segIntersect2, polygonArea, polygonCentroid, pointInPolygon, dist2, EPS } from '../core/math.js';

const SNAP = 1e-3;
const key = (p) => `${Math.round(p.x / SNAP)}|${Math.round(p.z / SNAP)}`;

/**
 * Split walls at every intersection and T-junction.
 * @returns {Array<{a:{x,z}, b:{x,z}, wallId:string}>}
 */
export function splitWallSegments(walls) {
  const cuts = walls.map(() => new Set([0, 1]));

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const A = walls[i], B = walls[j];
      const hit = segIntersect2(A.start, A.end, B.start, B.end);
      if (!hit) continue;
      if (hit.t > EPS && hit.t < 1 - EPS) cuts[i].add(hit.t);
      if (hit.u > EPS && hit.u < 1 - EPS) cuts[j].add(hit.u);
    }
  }

  const out = [];
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const ts = Array.from(cuts[i]).sort((a, b) => a - b);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1], t1 = ts[k];
      const a = { x: w.start.x + (w.end.x - w.start.x) * t0, z: w.start.z + (w.end.z - w.start.z) * t0 };
      const b = { x: w.start.x + (w.end.x - w.start.x) * t1, z: w.start.z + (w.end.z - w.start.z) * t1 };
      if (dist2(a, b) < 0.02) continue;
      out.push({ a, b, wallId: w.id });
    }
  }
  return out;
}

/**
 * Extract enclosed faces (rooms) from wall segments.
 * @returns {Array<{polygon:Array<{x,z}>, area:number, wallIds:string[]}>}
 */
export function detectFaces(walls, { minArea = 1.0 } = {}) {
  const segs = splitWallSegments(walls);
  if (!segs.length) return [];

  /** vertex key -> { p, out: [halfEdgeIndex] } */
  const verts = new Map();
  const he = []; // half edges: { from, to, wallId, twin, angle }

  const vertex = (p) => {
    const k = key(p);
    if (!verts.has(k)) verts.set(k, { p: { x: p.x, z: p.z }, out: [] });
    return k;
  };

  for (const s of segs) {
    const ka = vertex(s.a), kb = vertex(s.b);
    if (ka === kb) continue;
    const i = he.length;
    he.push({ from: ka, to: kb, wallId: s.wallId, twin: i + 1, angle: 0 });
    he.push({ from: kb, to: ka, wallId: s.wallId, twin: i, angle: 0 });
    verts.get(ka).out.push(i);
    verts.get(kb).out.push(i + 1);
  }

  for (const e of he) {
    const a = verts.get(e.from).p, b = verts.get(e.to).p;
    e.angle = Math.atan2(b.z - a.z, b.x - a.x);
  }
  // Sort each vertex's outgoing edges counter-clockwise by direction.
  for (const v of verts.values()) v.out.sort((i, j) => he[i].angle - he[j].angle);

  const nextOf = (i) => {
    const e = he[i];
    const v = verts.get(e.to);
    const twinIdx = v.out.indexOf(e.twin);
    if (twinIdx === -1) return e.twin;
    // Step to the edge immediately clockwise of the reverse direction.
    return v.out[(twinIdx - 1 + v.out.length) % v.out.length];
  };

  const seen = new Array(he.length).fill(false);
  const faces = [];
  for (let i = 0; i < he.length; i++) {
    if (seen[i]) continue;
    const cycle = [];
    let cur = i;
    let guard = 0;
    while (!seen[cur] && guard++ < he.length * 2 + 8) {
      seen[cur] = true;
      cycle.push(cur);
      cur = nextOf(cur);
      if (cur === i) break;
    }
    if (cycle.length < 3) continue;
    const polygon = cycle.map((k) => verts.get(he[k].from).p);
    const area = polygonArea(polygon);
    if (Math.abs(area) < minArea) continue;
    faces.push({ polygon, area, signed: area, wallIds: Array.from(new Set(cycle.map((k) => he[k].wallId))) });
  }

  // Drop the outer face: the one that contains every other face's centroid.
  if (faces.length > 1) {
    const centroids = faces.map((f) => polygonCentroid(f.polygon));
    let outerIdx = -1;
    for (let i = 0; i < faces.length; i++) {
      let containsAll = true;
      for (let j = 0; j < faces.length; j++) {
        if (i === j) continue;
        if (!pointInPolygon(centroids[j], faces[i].polygon)) { containsAll = false; break; }
      }
      if (containsAll) { outerIdx = i; break; }
    }
    if (outerIdx >= 0) faces.splice(outerIdx, 1);
  }

  return faces.map((f) => ({
    polygon: f.area < 0 ? f.polygon.slice().reverse() : f.polygon,
    area: Math.abs(f.area),
    wallIds: f.wallIds,
  }));
}

/**
 * Reconcile detected faces with the existing Space entities on a level.
 * Existing spaces keep their id, name, code and metadata; only the boundary
 * and wall associations are refreshed. New faces become new spaces.
 *
 * @returns {{updated:Array, created:Array, orphaned:Array}} plain descriptors
 */
export function reconcileSpaces(faces, existingSpaces) {
  const updated = [];
  const created = [];
  const used = new Set();

  for (const face of faces) {
    const c = polygonCentroid(face.polygon);
    let match = null;
    // 1. an existing space whose centroid falls inside this face
    for (const s of existingSpaces) {
      if (used.has(s.id) || !s.boundary?.length) continue;
      if (pointInPolygon(polygonCentroid(s.boundary), face.polygon)) { match = s; break; }
    }
    // 2. otherwise an existing space that contains this face's centroid
    if (!match) {
      for (const s of existingSpaces) {
        if (used.has(s.id) || !s.boundary?.length) continue;
        if (pointInPolygon(c, s.boundary)) { match = s; break; }
      }
    }
    if (match) {
      used.add(match.id);
      updated.push({ spaceId: match.id, boundary: face.polygon, wallIds: face.wallIds, area: face.area });
    } else {
      created.push({ boundary: face.polygon, wallIds: face.wallIds, area: face.area, centroid: c });
    }
  }

  const orphaned = existingSpaces.filter((s) => !used.has(s.id));
  return { updated, created, orphaned };
}

/** Which spaces a wall separates — used to auto-fill door spaceA/spaceB. */
export function spacesAdjacentToOpening(openingCentre, normal, spaces, probe = 0.45) {
  const a = { x: openingCentre.x + normal.x * probe, z: openingCentre.z + normal.z * probe };
  const b = { x: openingCentre.x - normal.x * probe, z: openingCentre.z - normal.z * probe };
  const hit = (pt) => {
    let best = null, bestArea = Infinity;
    for (const s of spaces) {
      if (!s.boundary?.length || !pointInPolygon(pt, s.boundary)) continue;
      const ar = Math.abs(polygonArea(s.boundary));
      if (ar < bestArea) { bestArea = ar; best = s; }
    }
    return best;
  };
  return { spaceA: hit(a)?.id || null, spaceB: hit(b)?.id || null };
}
