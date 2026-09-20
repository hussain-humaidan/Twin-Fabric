/**
 * Turn a set of room rectangles into a clean, non-overlapping wall network.
 *
 * Adjacent rooms share a single wall, and a long wall crossed by partitions is
 * split at every junction — which is what the space detector needs to close
 * each cell, and what lets a door belong to exactly one wall.
 *
 * Used by the building templates and by the "Create room / Create hall" tools.
 */
import { closestOnSegment2, dist2 } from '../core/math.js';

const K = 1e-3;
const q = (v) => Math.round(v / K);

/**
 * @param {Array<{x,z,w,d}>} rects
 * @param {{bounds?:{minX,maxX,minZ,maxZ}}} opts
 * @returns {Array<{start,end,type:'exterior'|'interior',axis:'x'|'z'}>}
 */
export function buildWallNetwork(rects, opts = {}) {
  const horiz = new Map(); // z -> [[x0,x1], …]
  const vert = new Map();  // x -> [[z0,z1], …]

  const push = (map, key, a, b) => {
    const k = q(key);
    if (!map.has(k)) map.set(k, { coord: key, spans: [] });
    map.get(k).spans.push([Math.min(a, b), Math.max(a, b)]);
  };

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rects) {
    const x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;
    push(horiz, z0, x0, x1);
    push(horiz, z1, x0, x1);
    push(vert, x0, z0, z1);
    push(vert, x1, z0, z1);
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z1);
  }
  const bounds = opts.bounds || { minX, maxX, minZ, maxZ };

  const out = [];
  const emit = (map, axis) => {
    for (const { coord, spans } of map.values()) {
      const cuts = new Set();
      for (const [a, b] of spans) { cuts.add(q(a)); cuts.add(q(b)); }
      // Every other line crossing this one also splits it.
      const other = axis === 'x' ? vert : horiz;
      for (const o of other.values()) {
        for (const [a, b] of o.spans) {
          if (coord >= a - K && coord <= b + K) cuts.add(q(o.coord));
        }
      }
      const sorted = Array.from(cuts).map((v) => v * K).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        if (b - a < 0.02) continue;
        const mid = (a + b) / 2;
        const covered = spans.some(([s0, s1]) => mid > s0 + K && mid < s1 - K);
        if (!covered) continue;
        const isExterior = axis === 'x'
          ? (Math.abs(coord - bounds.minZ) < 0.01 || Math.abs(coord - bounds.maxZ) < 0.01)
          : (Math.abs(coord - bounds.minX) < 0.01 || Math.abs(coord - bounds.maxX) < 0.01);
        out.push(
          axis === 'x'
            ? { start: { x: a, z: coord }, end: { x: b, z: coord }, type: isExterior ? 'exterior' : 'interior', axis: 'x' }
            : { start: { x: coord, z: a }, end: { x: coord, z: b }, type: isExterior ? 'exterior' : 'interior', axis: 'z' }
        );
      }
    }
  };
  emit(horiz, 'x');
  emit(vert, 'z');
  return out;
}

/**
 * Find the wall a world point sits on and the opening offset along it.
 * @returns {{wall, offset:number, dist:number}|null}
 */
export function locateOnWall(walls, point, tol = 0.6) {
  let best = null;
  for (const w of walls) {
    const r = closestOnSegment2(point, w.start, w.end);
    if (r.dist > tol) continue;
    const len = dist2(w.start, w.end);
    const offset = r.t * len;
    if (offset < 0.15 || offset > len - 0.15) continue; // too close to a junction
    if (!best || r.dist < best.dist) best = { wall: w, offset, dist: r.dist };
  }
  return best;
}

/** Merge a new rectangle's walls into an existing wall list, splitting overlaps. */
export function mergeRectIntoNetwork(existingWalls, rect, bounds) {
  const rects = [rect];
  const fresh = buildWallNetwork(rects, { bounds });
  const keep = [];
  for (const nw of fresh) {
    const dup = existingWalls.some((w) => sameSegment(w, nw));
    if (!dup) keep.push(nw);
  }
  return keep;
}

function sameSegment(a, b) {
  const p = (s) => `${q(s.x)}|${q(s.z)}`;
  const ka = `${p(a.start)}~${p(a.end)}`;
  const kb = `${p(b.start)}~${p(b.end)}`;
  const kbr = `${p(b.end)}~${p(b.start)}`;
  return ka === kb || ka === kbr;
}
