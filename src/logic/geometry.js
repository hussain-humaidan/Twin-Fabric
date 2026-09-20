/**
 * Parametric building geometry — data in, box/polygon descriptors out.
 * No Three.js here: the renderer turns these descriptors into meshes.
 *
 * A wall is never a single cube. It is generated from
 * (start, end, height, thickness, baseOffset) and split into piers, sills and
 * lintels around its openings, so a door or a cable penetration is a real hole.
 */
import { sub2, norm2, len2, angle2, perp2, rect } from '../core/math.js';

/** @returns {{dir, normal, length, angle, rotationY}} wall local frame. */
export function wallFrame(wall) {
  const d = sub2(wall.end, wall.start);
  const length = len2(d);
  const dir = length > 1e-6 ? norm2(d) : { x: 1, z: 0 };
  const angle = angle2(dir);
  return { dir, normal: perp2(dir), length, angle, rotationY: -angle };
}

/**
 * Split a wall into solid box segments around its openings.
 * @returns {Array<{position:{x,y,z}, size:{w,h,d}, rotationY:number, part:string}>}
 */
export function wallSegments(wall, openings, levelElevation = 0) {
  const { dir, length, rotationY } = wallFrame(wall);
  const baseY = levelElevation + (wall.baseOffset || 0);
  const H = wall.height;
  const T = wall.thickness;
  const out = [];

  const push = (u0, u1, y0, y1, part) => {
    const w = u1 - u0;
    const h = y1 - y0;
    if (w < 1e-4 || h < 1e-4) return;
    const um = (u0 + u1) / 2;
    out.push({
      position: { x: wall.start.x + dir.x * um, y: baseY + (y0 + y1) / 2, z: wall.start.z + dir.z * um },
      size: { w, h, d: T },
      rotationY,
      part,
    });
  };

  const ops = (openings || [])
    .map((o) => {
      const half = o.width / 2;
      return { o, x0: Math.max(0, o.offset - half), x1: Math.min(length, o.offset + half) };
    })
    .filter((e) => e.x1 > e.x0)
    .sort((a, b) => a.x0 - b.x0);

  let cursor = 0;
  for (const { o, x0, x1 } of ops) {
    const a = Math.max(cursor, x0);
    const b = Math.max(a, x1);
    if (a > cursor) push(cursor, a, 0, H, 'pier');
    const sill = Math.max(0, Math.min(o.sill || 0, H));
    const top = Math.min(H, sill + o.height);
    if (sill > 0) push(a, b, 0, sill, 'sill');
    if (top < H) push(a, b, top, H, 'lintel');
    cursor = Math.max(cursor, b);
  }
  if (cursor < length) push(cursor, length, 0, H, 'pier');
  if (!ops.length && out.length === 0) push(0, length, 0, H, 'pier');
  return out;
}

/** Glazing panel descriptors for windows (rendered as transparent infill). */
export function windowPanels(wall, openings, levelElevation = 0) {
  const { dir, rotationY } = wallFrame(wall);
  const baseY = levelElevation + (wall.baseOffset || 0);
  const out = [];
  for (const o of openings || []) {
    if (o.kind !== 'window') continue;
    out.push({
      position: {
        x: wall.start.x + dir.x * o.offset,
        y: baseY + (o.sill || 0) + o.height / 2,
        z: wall.start.z + dir.z * o.offset,
      },
      size: { w: o.width, h: o.height, d: Math.max(0.012, wall.thickness * 0.14) },
      rotationY,
      openingId: o.id,
    });
  }
  return out;
}

/** Door leaf descriptors (thin panel inside the opening, drawn ajar). */
export function doorLeaves(wall, openings, levelElevation = 0) {
  const { dir, rotationY } = wallFrame(wall);
  const baseY = levelElevation + (wall.baseOffset || 0);
  const out = [];
  for (const o of openings || []) {
    if (o.kind !== 'door') continue;
    out.push({
      position: {
        x: wall.start.x + dir.x * o.offset,
        y: baseY + (o.sill || 0) + o.height / 2,
        z: wall.start.z + dir.z * o.offset,
      },
      size: { w: o.width * 0.96, h: o.height * 0.98, d: 0.04 },
      rotationY,
      openingId: o.id,
    });
  }
  return out;
}

/** World centre + aperture of an opening — used by routing and collision. */
export function openingWorld(wall, opening, levelElevation = 0) {
  const { dir, normal, rotationY } = wallFrame(wall);
  const baseY = levelElevation + (wall.baseOffset || 0);
  const centre = {
    x: wall.start.x + dir.x * opening.offset,
    y: baseY + (opening.sill || 0) + opening.height / 2,
    z: wall.start.z + dir.z * opening.offset,
  };
  return {
    centre,
    normal,
    dir,
    rotationY,
    halfWidth: opening.width / 2,
    yMin: baseY + (opening.sill || 0),
    yMax: baseY + (opening.sill || 0) + opening.height,
    thickness: wall.thickness,
  };
}

/** Axis-aligned XZ bounds of a wall including thickness — broad-phase helper. */
export function wallBounds(wall) {
  const t = wall.thickness / 2;
  const minX = Math.min(wall.start.x, wall.end.x) - t;
  const maxX = Math.max(wall.start.x, wall.end.x) + t;
  const minZ = Math.min(wall.start.z, wall.end.z) - t;
  const maxZ = Math.max(wall.start.z, wall.end.z) + t;
  return { minX, maxX, minZ, maxZ };
}

/* ------------------------------------------------------------------ */
/* stairs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Generate a flight (or switchback) of real steps between two levels.
 * @returns {{steps:Array, landings:Array, footprint:Array<{x,z}>, rise:number, going:number}}
 */
export function stairGeometry(stair, fromElevation, toElevation) {
  const rise = Math.max(0.1, toElevation - fromElevation);
  const n = Math.max(2, Math.round(rise / (stair.riserHeight || 0.175)));
  const riser = rise / n;
  const tread = stair.treadDepth || 0.28;
  const W = stair.width || 1.4;
  const rot = stair.rotation || 0;
  const dir = { x: Math.cos(rot), z: Math.sin(rot) };
  const lat = { x: -dir.z, z: dir.x };
  const rotationY = -rot;

  const steps = [];
  const landings = [];
  const twoFlights = (stair.flights || 2) >= 2;
  const n1 = twoFlights ? Math.ceil(n / 2) : n;
  const n2 = n - n1;

  const at = (along, side, y, sz) => ({
    position: {
      x: stair.origin.x + dir.x * along + lat.x * side,
      y,
      z: stair.origin.z + dir.z * along + lat.z * side,
    },
    size: sz,
    rotationY,
  });

  // Flight 1 — travelling along +dir on the near side.
  for (let i = 0; i < n1; i++) {
    const along = (i + 0.5) * tread;
    const y = fromElevation + (i + 1) * riser - riser / 2;
    steps.push(at(along, twoFlights ? -W / 2 : 0, y, { w: tread, h: riser, d: W }));
  }

  let landingAlong = n1 * tread + (stair.landingDepth || 1.4) / 2;
  if (twoFlights) {
    const ly = fromElevation + n1 * riser;
    landings.push(at(landingAlong, 0, ly - 0.06, { w: stair.landingDepth || 1.4, h: 0.12, d: W * 2 }));
    // Flight 2 — back along -dir on the far side.
    const startAlong = n1 * tread + (stair.landingDepth || 1.4);
    for (let i = 0; i < n2; i++) {
      const along = startAlong - (i + 0.5) * tread;
      const y = ly + (i + 1) * riser - riser / 2;
      steps.push(at(along, W / 2, y, { w: tread, h: riser, d: W }));
    }
  }

  const totalRun = twoFlights ? n1 * tread + (stair.landingDepth || 1.4) : n * tread;
  const halfW = twoFlights ? W : W / 2;
  const corners = [
    { a: 0, s: -halfW }, { a: totalRun, s: -halfW }, { a: totalRun, s: halfW }, { a: 0, s: halfW },
  ].map(({ a, s }) => ({
    x: stair.origin.x + dir.x * a + lat.x * s,
    z: stair.origin.z + dir.z * a + lat.z * s,
  }));

  return { steps, landings, footprint: corners, rise, going: totalRun, riser, treadCount: n, width: W, twoFlights };
}

/* ------------------------------------------------------------------ */
/* columns, pathways                                                   */
/* ------------------------------------------------------------------ */

export function columnBox(column, level) {
  const h = column.height ?? level.height;
  return {
    position: { x: column.position.x, y: level.elevation + h / 2, z: column.position.z },
    size: column.shape === 'round'
      ? { w: column.radius * 2, h, d: column.radius * 2 }
      : { w: column.width, h, d: column.depth },
    rotationY: column.rotation || 0,
    round: column.shape === 'round',
  };
}

export function columnFootprint(column) {
  if (column.shape === 'round') {
    const r = column.radius;
    return rect(column.position.x - r, column.position.z - r, r * 2, r * 2);
  }
  const hw = column.width / 2, hd = column.depth / 2;
  const c = Math.cos(column.rotation || 0), s = Math.sin(column.rotation || 0);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => ({
    x: column.position.x + x * c - z * s,
    z: column.position.z + x * s + z * c,
  }));
}

/** Rectangular tube segments following a pathway polyline. */
export function pathwaySegments(pathway) {
  const pts = pathway.points || [];
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) continue;
    const horiz = Math.hypot(dx, dz);
    const vertical = horiz < 0.08;
    out.push({
      from: a, to: b, length: len, vertical,
      position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
      rotationY: vertical ? 0 : -Math.atan2(dz, dx),
      pitch: vertical ? Math.PI / 2 : -Math.atan2(dy, horiz),
      size: { w: len, h: pathway.height || 0.1, d: pathway.width || 0.3 },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* room helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the four walls of a rectangular room. Wall centrelines sit on the
 * rectangle edges so adjacent rooms drawn edge-to-edge share wall lines and
 * the space detector closes both cells.
 */
export function rectWallSpecs(x, z, w, d, { thickness = 0.15, height = 3.2, type = 'interior' } = {}) {
  const c = [
    { x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d },
  ];
  return [0, 1, 2, 3].map((i) => ({
    start: c[i], end: c[(i + 1) % 4], thickness, height, type,
  }));
}

export { rect };
