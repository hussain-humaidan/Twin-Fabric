/**
 * Pure geometry / vector maths. No Three.js, no DOM.
 *
 * COORDINATE SYSTEM (project-wide, documented once here):
 *   Right-handed, Y up. 1 unit = 1 metre.
 *   +X = East, -X = West, +Z = South, -Z = North, +Y = Up.
 *   Plan (top-down) views look down -Y with +X right and +Z down-screen.
 *   Angles in radians, measured in the XZ plane as atan2(dz, dx).
 */

export const EPS = 1e-6;

export const v2 = (x = 0, z = 0) => ({ x, z });
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const add2 = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const sub2 = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const mul2 = (a, s) => ({ x: a.x * s, z: a.z * s });
export const dot2 = (a, b) => a.x * b.x + a.z * b.z;
export const cross2 = (a, b) => a.x * b.z - a.z * b.x;
export const len2 = (a) => Math.hypot(a.x, a.z);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm2 = (a) => { const l = len2(a) || 1; return { x: a.x / l, z: a.z / l }; };
export const perp2 = (a) => ({ x: -a.z, z: a.x });
export const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const angle2 = (a) => Math.atan2(a.z, a.x);

export const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const lerp3 = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
export const clone3 = (a) => ({ x: a.x, y: a.y, z: a.z });

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Round a value to `dp` decimals (avoids float noise in stored geometry). */
export const fix = (v, dp = 4) => {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
};

/** Total length of a 3D polyline. */
export function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += dist3(points[i - 1], points[i]);
  return L;
}

/** Signed area of a closed XZ polygon (positive = counter-clockwise in XZ). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  }
  return a / 2;
}

export function polygonCentroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cz += (poly[j].z + poly[i].z) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < EPS) {
    // Degenerate — fall back to the vertex average.
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, z: poly.reduce((s, p) => s + p.z, 0) / n };
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function polygonBounds(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  if (!poly.length) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, cx: 0, cz: 0, w: 0, d: 0 };
  return { minX, minZ, maxX, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

/** Even-odd point-in-polygon test in the XZ plane. */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const zi = poly[i].z, zj = poly[j].z, xi = poly[i].x, xj = poly[j].x;
    if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p (XZ), returned with its parameter t. */
export function closestOnSegment2(p, a, b) {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  if (l2 < EPS) return { point: { x: a.x, z: a.z }, t: 0, dist: dist2(p, a) };
  let t = dot2(sub2(p, a), ab) / l2;
  t = clamp(t, 0, 1);
  const point = { x: a.x + ab.x * t, z: a.z + ab.z * t };
  return { point, t, dist: dist2(p, point) };
}

/**
 * Proper segment/segment intersection in XZ.
 * Returns { t, u, point } or null. Touching endpoints count (t,u in [0,1]).
 */
export function segIntersect2(p1, p2, p3, p4) {
  const r = sub2(p2, p1);
  const s = sub2(p4, p3);
  const d = cross2(r, s);
  if (Math.abs(d) < EPS) return null; // parallel or collinear
  const qp = sub2(p3, p1);
  const t = cross2(qp, s) / d;
  const u = cross2(qp, r) / d;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, u, point: { x: p1.x + r.x * t, z: p1.z + r.z * t } };
}

/** Remove collinear / duplicate points from a 3D polyline. */
export function simplifyPolyline(points, tol = 0.01) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    if (dist3(a, b) < tol) continue;
    const ab = sub3(b, a), bc = sub3(c, b);
    const la = Math.hypot(ab.x, ab.y, ab.z) || 1;
    const lb = Math.hypot(bc.x, bc.y, bc.z) || 1;
    const dotn = (ab.x * bc.x + ab.y * bc.y + ab.z * bc.z) / (la * lb);
    if (dotn > 0.9995) continue; // effectively straight through b
    out.push(b);
  }
  const last = points[points.length - 1];
  if (dist3(out[out.length - 1], last) > tol || out.length === 1) out.push(last);
  return out;
}

/** Offset every vertex of a convex-ish polygon inwards by `d` (approximate). */
export function shrinkPolygon(poly, d) {
  const c = polygonCentroid(poly);
  return poly.map((p) => {
    const dir = sub2(p, c);
    const l = len2(dir) || 1;
    const nl = Math.max(0.05, l - d);
    return { x: c.x + (dir.x / l) * nl, z: c.z + (dir.z / l) * nl };
  });
}

/** Axis-aligned rectangle polygon helper (XZ). */
export function rect(x, z, w, d) {
  return [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];
}

/** Rotate a point around the origin in the XZ plane. */
export function rotate2(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}
