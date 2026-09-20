/**
 * Architecture layer — the building itself as selectable 3D objects.
 * One mesh per wall / slab / stair / column, grouped per level so floor
 * isolation, ghosting and cutaway are a group-visibility change.
 */
import * as THREE from 'three';
import {
  wallGeometry, glazingGeometry, doorGeometry, slabGeometry,
  stairMeshGeometry, columnGeometry, polygonPlaneGeometry,
} from '../builders.js';
import { openingsOfWall, getLevel } from '../../model/queries.js';

export function createArchitectureLayer(matlib) {
  const root = new THREE.Group();
  root.name = 'architecture';

  const levelGroups = new Map();   // levelId -> { group, walls, glazing, doors, slabs, ceilings, stairs, columns, spaces }
  const meshIndex = new Map();     // `${kind}:${id}` -> mesh
  let project = null;

  function levelGroup(levelId) {
    if (levelGroups.has(levelId)) return levelGroups.get(levelId);
    const group = new THREE.Group();
    group.name = `level:${levelId}`;
    const sub = {};
    for (const k of ['walls', 'glazing', 'doors', 'slabs', 'ceilings', 'stairs', 'columns', 'spaces']) {
      sub[k] = new THREE.Group();
      sub[k].name = k;
      group.add(sub[k]);
    }
    const entry = { group, ...sub, levelId };
    levelGroups.set(levelId, entry);
    root.add(group);
    return entry;
  }

  function disposeGroup(g) {
    g.traverse((o) => { if (o.isMesh || o.isLine) o.geometry?.dispose(); });
    g.clear();
  }

  function clear() {
    for (const e of levelGroups.values()) {
      for (const k of ['walls', 'glazing', 'doors', 'slabs', 'ceilings', 'stairs', 'columns', 'spaces']) disposeGroup(e[k]);
      root.remove(e.group);
    }
    levelGroups.clear();
    meshIndex.clear();
  }

  function add(group, geo, material, kind, id, extra = {}) {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData = { kind, id, ...extra };
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    meshIndex.set(`${kind}:${id}`, mesh);
    return mesh;
  }

  function rebuild(p) {
    project = p;
    clear();

    for (const level of p.levels) levelGroup(level.id);

    /* ---- walls (+ glazing and door leaves) ---- */
    for (const wall of p.walls) {
      const level = getLevel(p, wall.levelId);
      if (!level) continue;
      const g = levelGroup(wall.levelId);
      const ops = openingsOfWall(p, wall.id);
      add(g.walls, wallGeometry(wall, ops, level.elevation),
        matlib.get(wall.materialId, wall.type === 'exterior' ? 'wall' : 'partition', wall.levelId),
        'wall', wall.id);
      add(g.glazing, glazingGeometry(wall, ops, level.elevation),
        matlib.get('MAT-GLASS', 'glass', wall.levelId), 'glazing', wall.id, { wallId: wall.id });
      add(g.doors, doorGeometry(wall, ops, level.elevation),
        matlib.get('MAT-WOOD', 'door', wall.levelId), 'doorleaf', wall.id, { wallId: wall.id });
    }

    /* ---- slabs & ceilings ---- */
    for (const slab of p.slabs) {
      const g = levelGroup(slab.levelId);
      const target = slab.kind === 'ceiling' ? g.ceilings : g.slabs;
      const kind = slab.kind === 'ceiling' ? 'ceiling' : slab.kind === 'roof' ? 'roof' : 'slab';
      add(target, slabGeometry(slab), matlib.get(slab.materialId, kind, slab.levelId), 'slab', slab.id, { slabKind: slab.kind });
    }

    /* ---- stairs ---- */
    for (const stair of p.stairs) {
      const from = getLevel(p, stair.fromLevelId);
      const to = getLevel(p, stair.toLevelId);
      if (!from || !to) continue;
      const g = levelGroup(stair.fromLevelId);
      add(g.stairs, stairMeshGeometry(stair, from.elevation, to.elevation),
        matlib.get(stair.materialId, 'stair', stair.fromLevelId), 'stair', stair.id);
    }

    /* ---- columns ---- */
    for (const col of p.columns) {
      const level = getLevel(p, col.levelId);
      if (!level) continue;
      const g = levelGroup(col.levelId);
      add(g.columns, columnGeometry(col, level), matlib.get(col.materialId, 'column', col.levelId), 'column', col.id);
    }

    /* ---- space floor plates (selection + plan readability) ---- */
    for (const space of p.spaces) {
      const level = getLevel(p, space.levelId);
      if (!level || !space.boundary?.length) continue;
      const g = levelGroup(space.levelId);
      const y = level.elevation + (space.floorOffset || 0) + 0.012;
      const mesh = add(g.spaces, polygonPlaneGeometry(space.boundary, y), matlib.spaceFill, 'space', space.id);
      if (mesh) mesh.renderOrder = -1;
    }
  }

  /** Apply level visibility, layer toggles and ghosting. */
  function applyVisibility(view) {
    const L = view.layers;
    for (const [levelId, e] of levelGroups) {
      const st = view.levelState[levelId] || 'visible';
      const isolated = view.isolateLevel && view.activeLevelId && view.activeLevelId !== levelId;
      const hidden = st === 'hidden' || isolated;
      const ghost = st === 'ghost' && !hidden;

      e.group.visible = !hidden;
      matlib.setLevelFactor(levelId, ghost ? 0.22 : 1);

      e.walls.visible = L.architecture;
      e.glazing.visible = L.architecture && L.windows;
      e.doors.visible = L.architecture && L.doors;
      e.slabs.visible = L.architecture || L.structure;
      e.ceilings.visible = L.ceilings;
      e.stairs.visible = L.stairs;
      e.columns.visible = L.structure;
      e.spaces.visible = L.spaces;

      // The roof level's slab honours the roof layer toggle.
      for (const m of e.slabs.children) {
        if (m.userData.slabKind === 'roof') m.visible = L.roof;
      }
    }
  }

  function setSpaceHighlight(spaceIds) {
    const set = spaceIds instanceof Set ? spaceIds : new Set(spaceIds || []);
    for (const e of levelGroups.values()) {
      for (const m of e.spaces.children) {
        m.material = set.has(m.userData.id) ? matlib.spaceFillHot : matlib.spaceFill;
      }
    }
  }

  function meshFor(kind, id) { return meshIndex.get(`${kind}:${id}`) || null; }

  function boundsOf(kind, id) {
    const m = meshFor(kind, id);
    if (!m) return null;
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
  }

  function levelBounds(levelId) {
    const e = levelGroups.get(levelId);
    if (!e) return null;
    return new THREE.Box3().setFromObject(e.group);
  }

  /** Pick resolver — maps a raycast hit back to a twin entity. */
  function resolve(hit) {
    let o = hit.object;
    while (o && !o.userData?.kind) o = o.parent;
    if (!o) return null;
    const { kind, id, wallId } = o.userData;
    if (kind === 'glazing' || kind === 'doorleaf') return { kind: 'wall', id: wallId };
    if (kind === 'ceiling') return { kind: 'slab', id };
    return { kind, id };
  }

  return {
    root, rebuild, applyVisibility, setSpaceHighlight, meshFor, boundsOf, levelBounds, resolve,
    get levelGroups() { return levelGroups; },
    dispose() { clear(); },
  };
}
