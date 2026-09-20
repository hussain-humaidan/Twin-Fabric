/**
 * Equipment layer.
 *
 * Devices render as two InstancedMeshes (box-like and cylindrical), so a
 * building with a thousand devices still costs two draw calls. Selection maps
 * an instanceId back to the device id. Racks are individual meshes.
 */
import * as THREE from 'three';
import { unitBox, unitCylinder, rackGeometry } from '../builders.js';
import { devicePosition, getLevel } from '../../model/queries.js';
import { STATUS_COLOR } from '../../model/schema.js';
import { HIGHLIGHT_COLOR, SELECT_COLOR } from '../materials.js';

const MIN_CAPACITY = 64;

export function createInfrastructureLayer(matlib) {
  const root = new THREE.Group();
  root.name = 'infrastructure';

  const devicesGroup = new THREE.Group();
  const racksGroup = new THREE.Group();
  root.add(devicesGroup, racksGroup);

  let boxMesh = null;
  let cylMesh = null;
  const boxIds = [];
  const cylIds = [];
  const deviceTransforms = new Map();  // deviceId -> { position, rotation, size }
  const rackMeshes = new Map();

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const col = new THREE.Color();
  const statusCol = new THREE.Color();

  function ensureMesh(which, capacity) {
    const geo = which === 'box' ? unitBox() : unitCylinder();
    const existing = which === 'box' ? boxMesh : cylMesh;
    if (existing && existing.instanceMatrix.count >= capacity) return existing;
    if (existing) { devicesGroup.remove(existing); existing.dispose(); }
    const mesh = new THREE.InstancedMesh(geo, matlib.deviceInstanced, Math.max(MIN_CAPACITY, capacity * 2));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    mesh.frustumCulled = false;
    mesh.userData.kind = 'deviceInstances';
    mesh.userData.which = which;
    devicesGroup.add(mesh);
    if (which === 'box') boxMesh = mesh; else cylMesh = mesh;
    return mesh;
  }

  /**
   * @param {object} p project
   * @param {(device)=>boolean} isVisible visibility predicate from the filters
   * @param {{selected:Set, hover:string|null, highlight:Set}} emphasis
   */
  function rebuild(p, isVisible, emphasis = {}) {
    const selected = emphasis.selected || new Set();
    const highlight = emphasis.highlight || new Set();
    const hover = emphasis.hover || null;
    const dimOthers = highlight.size > 0;

    const boxes = [];
    const cyls = [];
    deviceTransforms.clear();

    for (const d of p.devices) {
      if (!isVisible(d)) continue;
      const pos = devicePosition(p, d);
      deviceTransforms.set(d.id, { position: pos, rotation: d.rotation || 0, size: d.size });
      (d.shape === 'cylinder' ? cyls : boxes).push({ d, pos });
    }

    boxIds.length = 0;
    cylIds.length = 0;

    const fill = (mesh, list, ids) => {
      if (!mesh) return;
      let i = 0;
      for (const { d, pos } of list) {
        e.set(0, d.rotation || 0, 0);
        q.setFromEuler(e);
        v.set(Math.max(d.size.w, 0.02), Math.max(d.size.h, 0.02), Math.max(d.size.d, 0.02));
        m4.compose(new THREE.Vector3(pos.x, pos.y, pos.z), q, v);
        mesh.setMatrixAt(i, m4);

        col.set(d.color || '#8d9aab');
        const sc = STATUS_COLOR[d.status];
        if (sc && d.status !== 'active') { statusCol.set(sc); col.lerp(statusCol, 0.55); }
        if (selected.has(d.id)) col.set(SELECT_COLOR);
        else if (hover === d.id) col.lerp(new THREE.Color(0x7fd1e8), 0.5);
        else if (highlight.has(d.id)) { statusCol.set(HIGHLIGHT_COLOR); col.lerp(statusCol, 0.65); }
        else if (dimOthers) col.multiplyScalar(0.42);
        mesh.setColorAt(i, col);

        ids[i] = d.id;
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    fill(ensureMesh('box', boxes.length), boxes, boxIds);
    fill(ensureMesh('cyl', cyls.length), cyls, cylIds);

    /* ---- racks ---- */
    const seen = new Set();
    for (const r of p.racks) {
      seen.add(r.id);
      let mesh = rackMeshes.get(r.id);
      const geo = rackGeometry(r);
      if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
      else {
        mesh = new THREE.Mesh(geo, matlib.rack);
        mesh.userData = { kind: 'rack', id: r.id };
        racksGroup.add(mesh);
        rackMeshes.set(r.id, mesh);
      }
      mesh.position.set(r.position.x, r.position.y, r.position.z);
      mesh.rotation.y = r.rotation || 0;
      const lvl = getLevel(p, r.levelId);
      mesh.userData.levelId = lvl?.id || null;
    }
    for (const [id, mesh] of Array.from(rackMeshes)) {
      if (seen.has(id)) continue;
      racksGroup.remove(mesh);
      mesh.geometry.dispose();
      rackMeshes.delete(id);
    }
  }

  function applyVisibility(view) {
    devicesGroup.visible = view.layers.equipment;
    racksGroup.visible = view.layers.racks;
    for (const [, mesh] of rackMeshes) {
      const st = view.levelState[mesh.userData.levelId] || 'visible';
      const isolated = view.isolateLevel && view.activeLevelId && view.activeLevelId !== mesh.userData.levelId;
      mesh.visible = st !== 'hidden' && !isolated;
    }
  }

  function resolve(hit) {
    const o = hit.object;
    if (o.userData?.kind === 'rack') return { kind: 'rack', id: o.userData.id };
    if (o.userData?.kind === 'deviceInstances' && hit.instanceId != null) {
      const ids = o.userData.which === 'box' ? boxIds : cylIds;
      const id = ids[hit.instanceId];
      return id ? { kind: 'device', id } : null;
    }
    return null;
  }

  function transformOf(deviceId) { return deviceTransforms.get(deviceId) || null; }

  function boundsOf(kind, id) {
    if (kind === 'rack') {
      const m = rackMeshes.get(id);
      if (!m) return null;
      return new THREE.Box3().setFromObject(m);
    }
    const t = deviceTransforms.get(id);
    if (!t) return null;
    const half = new THREE.Vector3(t.size.w, t.size.h, t.size.d).multiplyScalar(0.5).addScalar(0.15);
    const c = new THREE.Vector3(t.position.x, t.position.y, t.position.z);
    return new THREE.Box3(c.clone().sub(half), c.clone().add(half));
  }

  return {
    root, devicesGroup, racksGroup, rebuild, applyVisibility, resolve, transformOf, boundsOf,
    dispose() {
      for (const m of [boxMesh, cylMesh]) if (m) { m.dispose(); devicesGroup.remove(m); }
      for (const m of rackMeshes.values()) { m.geometry.dispose(); racksGroup.remove(m); }
      rackMeshes.clear();
    },
  };
}
