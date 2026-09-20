/**
 * Cable layer.
 *
 * All cables of one type merge into a single LineSegments geometry, so the
 * scene costs roughly one draw call per cable type no matter how many
 * thousands of cables exist. Only the cables that need emphasis (selected,
 * hovered, or on a traced signal path) are promoted to tubes with direction
 * arrows, which keeps the heavy geometry count at single digits.
 */
import * as THREE from 'three';

const ARROW_SPACING = 6;     // metres between direction arrows on an emphasised cable
const TUBE_RADIAL = 6;

export function createCableLayer(matlib) {
  const root = new THREE.Group();
  root.name = 'cables';

  const bulk = new THREE.Group();
  const emphasis = new THREE.Group();
  root.add(bulk, emphasis);

  /** typeId -> { mesh, segCableIds:[] } */
  const typeMeshes = new Map();
  const materials = new Map();
  const emphasised = [];

  function materialFor(typeId, color, dim) {
    const key = `${typeId}:${dim ? 'dim' : 'on'}`;
    if (materials.has(key)) {
      const m = materials.get(key);
      m.color.set(color);
      return m;
    }
    const m = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: dim ? 0.13 : 0.92,
      depthWrite: false,
      clippingPlanes: matlib.clipPlanes,
    });
    materials.set(key, m);
    return m;
  }

  function clearEmphasis() {
    for (const o of emphasised) {
      o.geometry.dispose();
      emphasis.remove(o);
    }
    emphasised.length = 0;
  }

  /**
   * @param {object} p project
   * @param {(cable)=>boolean} isVisible
   * @param {{selected:Set<string>, hover:string|null, highlight:Set<string>}} state
   */
  function rebuild(p, isVisible, state = {}) {
    const selected = state.selected || new Set();
    const highlight = state.highlight || new Set();
    const hover = state.hover;
    const hot = new Set([...selected, ...highlight]);
    if (hover) hot.add(hover);
    const dimBulk = hot.size > 0;

    /* ---- bulk lines, bucketed by cable type ---- */
    const buckets = new Map();
    for (const c of p.cables) {
      if (!isVisible(c)) continue;
      const route = c.route || [];
      if (route.length < 2) continue;
      let b = buckets.get(c.typeId);
      if (!b) { b = { positions: [], segCableIds: [] }; buckets.set(c.typeId, b); }
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], q = route[i];
        b.positions.push(a.x, a.y, a.z, q.x, q.y, q.z);
        b.segCableIds.push(c.id);
      }
    }

    // Remove buckets that no longer have cables.
    for (const [typeId, entry] of Array.from(typeMeshes)) {
      if (buckets.has(typeId)) continue;
      bulk.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      typeMeshes.delete(typeId);
    }

    for (const [typeId, b] of buckets) {
      const type = p.cableTypes.find((t) => t.id === typeId);
      const color = type?.color || '#8d9aab';
      let entry = typeMeshes.get(typeId);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geo.computeBoundingSphere();
      if (entry) {
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = geo;
      } else {
        const mesh = new THREE.LineSegments(geo, materialFor(typeId, color, dimBulk));
        mesh.frustumCulled = true;
        mesh.userData = { kind: 'cableBulk', typeId };
        bulk.add(mesh);
        entry = { mesh, segCableIds: b.segCableIds };
        typeMeshes.set(typeId, entry);
      }
      entry.segCableIds = b.segCableIds;
      entry.mesh.material = materialFor(typeId, color, dimBulk);
    }

    /* ---- emphasised cables as tubes with direction arrows ---- */
    clearEmphasis();
    for (const id of hot) {
      const c = p.cables.find((x) => x.id === id);
      if (!c || (c.route || []).length < 2) continue;
      const color = matlib.cableColor(p, c);
      const isSel = selected.has(id);
      const pts = c.route.map((q) => new THREE.Vector3(q.x, q.y, q.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0);
      const tubeGeo = new THREE.TubeGeometry(curve, Math.min(400, Math.max(8, pts.length * 6)), isSel ? 0.055 : 0.04, TUBE_RADIAL, false);
      const mat = new THREE.MeshBasicMaterial({
        color: isSel ? 0xffb02e : color, transparent: true, opacity: isSel ? 1 : 0.95,
        clippingPlanes: matlib.clipPlanes,
      });
      const tube = new THREE.Mesh(tubeGeo, mat);
      tube.userData = { kind: 'cable', id };
      tube.renderOrder = 5;
      emphasis.add(tube);
      emphasised.push(tube);

      // Direction arrows — a cable is a directed source → destination run.
      const total = curve.getLength();
      const n = Math.max(1, Math.min(24, Math.floor(total / ARROW_SPACING)));
      const coneGeo = new THREE.ConeGeometry(0.11, 0.3, 7);
      const coneMat = new THREE.MeshBasicMaterial({ color: isSel ? 0xffd88a : color, clippingPlanes: matlib.clipPlanes });
      const cones = new THREE.InstancedMesh(coneGeo, coneMat, n);
      const m = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const pos = curve.getPointAt(t);
        const tan = curve.getTangentAt(t).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(up, tan);
        m.compose(pos, quat, new THREE.Vector3(1, 1, 1));
        cones.setMatrixAt(i, m);
      }
      cones.instanceMatrix.needsUpdate = true;
      cones.renderOrder = 6;
      cones.userData = { kind: 'cable', id };
      emphasis.add(cones);
      emphasised.push(cones);
    }
  }

  function applyVisibility(view) {
    root.visible = view.layers.cables;
  }

  function resolve(hit) {
    const o = hit.object;
    if (o.userData?.kind === 'cable') return { kind: 'cable', id: o.userData.id };
    if (o.userData?.kind === 'cableBulk') {
      const entry = typeMeshes.get(o.userData.typeId);
      if (!entry || hit.index == null) return null;
      const seg = Math.floor(hit.index / 2);
      const id = entry.segCableIds[seg];
      return id ? { kind: 'cable', id } : null;
    }
    return null;
  }

  function boundsOf(p, cableId) {
    const c = p.cables.find((x) => x.id === cableId);
    if (!c || !(c.route || []).length) return null;
    const box = new THREE.Box3();
    for (const q of c.route) box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    box.expandByScalar(0.8);
    return box;
  }

  return {
    root, rebuild, applyVisibility, resolve, boundsOf,
    dispose() {
      clearEmphasis();
      for (const e of typeMeshes.values()) { e.mesh.geometry.dispose(); bulk.remove(e.mesh); }
      typeMeshes.clear();
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
}
