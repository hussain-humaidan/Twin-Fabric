/**
 * Geometry builders — descriptors from logic/geometry.js become BufferGeometry.
 * Everything is merged per entity so one wall (piers + lintels + sills) is a
 * single selectable mesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wallSegments, windowPanels, doorLeaves, stairGeometry, pathwaySegments, columnBox } from '../logic/geometry.js';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);

/** Merge an array of {position,size,rotationY,pitch?} boxes into one geometry. */
export function boxesToGeometry(boxes, { round = false } = {}) {
  if (!boxes.length) return null;
  const parts = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const b of boxes) {
    const g = (round ? UNIT_CYL : UNIT_BOX).clone();
    e.set(b.pitch || 0, b.rotationY || 0, 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(
      new THREE.Vector3(b.position.x, b.position.y, b.position.z),
      q,
      new THREE.Vector3(b.size.w, b.size.h, b.size.d)
    );
    g.applyMatrix4(m);
    parts.push(g);
  }
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  return merged;
}

export function wallGeometry(wall, openings, levelElevation) {
  return boxesToGeometry(wallSegments(wall, openings, levelElevation));
}

export function glazingGeometry(wall, openings, levelElevation) {
  return boxesToGeometry(windowPanels(wall, openings, levelElevation));
}

export function doorGeometry(wall, openings, levelElevation) {
  return boxesToGeometry(doorLeaves(wall, openings, levelElevation));
}

/**
 * Extruded slab from an XZ polygon with holes.
 * Shape space (sx, sy) maps to world (x, -z); the result is rotated flat and
 * translated so the slab's TOP face sits at topElevation.
 */
export function slabGeometry(slab) {
  if (!slab.polygon?.length) return null;
  const toShape = (poly) => poly.map((p) => new THREE.Vector2(p.x, -p.z));
  const outer = toShape(slab.polygon);
  if (THREE.ShapeUtils.area(outer) < 0) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const h of slab.holes || []) {
    const hp = toShape(h);
    if (THREE.ShapeUtils.area(hp) > 0) hp.reverse();
    shape.holes.push(new THREE.Path(hp));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);          // (x, y, z) → (x, z, -y): shape lies in XZ
  geo.translate(0, slab.topElevation - slab.thickness, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Flat polygon at a given Y — used for space floor highlights. */
export function polygonPlaneGeometry(polygon, y) {
  if (!polygon?.length) return null;
  const pts = polygon.map((p) => new THREE.Vector2(p.x, -p.z));
  if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();
  const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export function stairMeshGeometry(stair, fromElevation, toElevation) {
  const g = stairGeometry(stair, fromElevation, toElevation);
  return boxesToGeometry([...g.steps, ...g.landings]);
}

export function columnGeometry(column, level) {
  const b = columnBox(column, level);
  return boxesToGeometry([b], { round: b.round });
}

export function pathwayGeometry(pathway) {
  const segs = pathwaySegments(pathway);
  if (!segs.length) return null;
  const boxes = segs.map((s) => ({
    position: s.position,
    size: s.vertical
      ? { w: pathway.width || 0.3, h: s.length, d: pathway.width || 0.3 }
      : { w: s.length, h: pathway.height || 0.1, d: pathway.width || 0.3 },
    rotationY: s.vertical ? 0 : s.rotationY,
    pitch: s.vertical ? 0 : s.pitch,
  }));
  return boxesToGeometry(boxes);
}

/** 19" rack: side panels, base and a thin top so it reads as an enclosure. */
export function rackGeometry(rack) {
  const h = rack.baseHeight + rack.rackUnits * 0.04445 + 0.06;
  const w = rack.width, d = rack.depth;
  const t = 0.03;
  const boxes = [
    { position: { x: -w / 2 + t / 2, y: h / 2, z: 0 }, size: { w: t, h, d }, rotationY: 0 },
    { position: { x: w / 2 - t / 2, y: h / 2, z: 0 }, size: { w: t, h, d }, rotationY: 0 },
    { position: { x: 0, y: t / 2, z: 0 }, size: { w, h: t, d }, rotationY: 0 },
    { position: { x: 0, y: h - t / 2, z: 0 }, size: { w, h: t, d }, rotationY: 0 },
    { position: { x: 0, y: h / 2, z: -d / 2 + t / 2 }, size: { w, h, d: t }, rotationY: 0 },
  ];
  return boxesToGeometry(boxes);
}

/** Box outline (12 edges) used for selection and hover highlighting. */
export function outlineGeometry(size) {
  const g = new THREE.BoxGeometry(size.w, size.h, size.d);
  const e = new THREE.EdgesGeometry(g);
  g.dispose();
  return e;
}

export function unitBox() { return UNIT_BOX; }
export function unitCylinder() { return UNIT_CYL; }

/** A flat, camera-facing text sprite drawn on a canvas — no font loading. */
const labelCache = new Map();
export function labelTexture(text, { color = '#cfd8e4', bg = 'rgba(10,14,20,0.82)', border = '#2a3644', size = 42 } = {}) {
  const key = `${text}|${color}|${bg}|${border}|${size}`;
  if (labelCache.has(key)) return labelCache.get(key);
  const pad = 14;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `500 ${size}px "IBM Plex Mono", monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 1.4;
  canvas.width = Math.max(2, w);
  canvas.height = Math.max(2, h);
  const c = canvas.getContext('2d');
  c.font = `500 ${size}px "IBM Plex Mono", monospace`;
  c.textBaseline = 'middle';
  c.fillStyle = bg;
  roundRect(c, 1, 1, canvas.width - 2, canvas.height - 2, 6);
  c.fill();
  c.strokeStyle = border;
  c.lineWidth = 2;
  roundRect(c, 1, 1, canvas.width - 2, canvas.height - 2, 6);
  c.stroke();
  c.fillStyle = color;
  c.fillText(text, pad, canvas.height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const entry = { texture: tex, aspect: canvas.width / canvas.height };
  labelCache.set(key, entry);
  return entry;
}

export function clearLabelCache() {
  for (const e of labelCache.values()) e.texture.dispose();
  labelCache.clear();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
