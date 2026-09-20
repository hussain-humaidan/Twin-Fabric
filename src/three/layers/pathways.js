/**
 * Cable containment layer — trays, baskets, conduits, ducts and vertical
 * shafts. Colour encodes utilisation so a full tray is visible at a glance.
 */
import * as THREE from 'three';
import { pathwayGeometry } from '../builders.js';
import { pathwayUtilisation } from '../../model/queries.js';

const COLOR_FREE = new THREE.Color('#5f6c7c');
const COLOR_BUSY = new THREE.Color('#e8b339');
const COLOR_FULL = new THREE.Color('#e0605c');

export function createPathwayLayer(matlib) {
  const root = new THREE.Group();
  root.name = 'pathways';
  const meshes = new Map();
  const mats = new Map();

  function materialFor(key, color, emphasised) {
    const id = `${key}:${emphasised ? 1 : 0}`;
    if (mats.has(id)) { mats.get(id).color.copy(color); return mats.get(id); }
    const m = new THREE.MeshStandardMaterial({
      color: color.clone(), roughness: 0.45, metalness: 0.65,
      transparent: true, opacity: emphasised ? 1 : 0.82,
      clippingPlanes: matlib.clipPlanes,
    });
    mats.set(id, m);
    return m;
  }

  function rebuild(p, isVisible, state = {}) {
    const selected = state.selected || new Set();
    const seen = new Set();
    for (const pw of p.pathways) {
      if (!isVisible(pw)) continue;
      seen.add(pw.id);
      const util = pathwayUtilisation(p, pw);
      const ratio = Math.max(util.ratio, util.fillRatio);
      const color = ratio > 0.9 ? COLOR_FULL : ratio > 0.6 ? COLOR_BUSY : COLOR_FREE;
      const sel = selected.has(pw.id);
      const geo = pathwayGeometry(pw);
      if (!geo) continue;
      let mesh = meshes.get(pw.id);
      if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; }
      else {
        mesh = new THREE.Mesh(geo, materialFor(pw.kind, color, sel));
        mesh.userData = { kind: 'pathway', id: pw.id };
        root.add(mesh);
        meshes.set(pw.id, mesh);
      }
      mesh.material = sel
        ? new THREE.MeshBasicMaterial({ color: 0xffb02e, clippingPlanes: matlib.clipPlanes })
        : materialFor(pw.kind, color, false);
      mesh.userData.levelId = pw.levelId;
      mesh.userData.util = util;
    }
    for (const [id, mesh] of Array.from(meshes)) {
      if (seen.has(id)) continue;
      root.remove(mesh);
      mesh.geometry.dispose();
      meshes.delete(id);
    }
  }

  function applyVisibility(view) {
    root.visible = view.layers.pathways;
    for (const mesh of meshes.values()) {
      const lvl = mesh.userData.levelId;
      if (!lvl) { mesh.visible = true; continue; }  // risers span levels
      const st = view.levelState[lvl] || 'visible';
      const isolated = view.isolateLevel && view.activeLevelId && view.activeLevelId !== lvl;
      mesh.visible = st !== 'hidden' && !isolated;
    }
  }

  function resolve(hit) {
    let o = hit.object;
    while (o && !o.userData?.kind) o = o.parent;
    return o?.userData?.kind === 'pathway' ? { kind: 'pathway', id: o.userData.id } : null;
  }

  function boundsOf(id) {
    const m = meshes.get(id);
    return m ? new THREE.Box3().setFromObject(m) : null;
  }

  return {
    root, rebuild, applyVisibility, resolve, boundsOf,
    dispose() {
      for (const m of meshes.values()) { m.geometry.dispose(); root.remove(m); }
      meshes.clear();
      for (const m of mats.values()) m.dispose();
      mats.clear();
    },
  };
}
