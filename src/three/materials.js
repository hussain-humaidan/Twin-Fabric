/**
 * Shared material library.
 *
 * One material instance per (projectMaterial × element kind), so switching
 * view modes is a handful of property writes rather than a scene walk, and
 * thousands of meshes still batch on a few materials.
 */
import * as THREE from 'three';

export const VIEW_MODES = {
  normal: {
    label: 'Normal', arch: { opacity: 1, transparent: false, wireframe: false, depthWrite: true },
    ceilingOpacity: 1, hint: 'Solid building.',
  },
  xray: {
    label: 'X-Ray', arch: { opacity: 0.20, transparent: true, wireframe: false, depthWrite: false },
    ceilingOpacity: 0.12, hint: 'Walls transparent — see equipment and cables inside rooms.',
  },
  infrastructure: {
    label: 'Infrastructure', arch: { opacity: 0.09, transparent: true, wireframe: false, depthWrite: false },
    ceilingOpacity: 0.05, hint: 'Architecture recedes; equipment, trays and cables dominate.',
  },
  wireframe: {
    label: 'Wire', arch: { opacity: 0.55, transparent: true, wireframe: true, depthWrite: false },
    ceilingOpacity: 0.3, hint: 'Walls as outlines only.',
  },
};

export const SELECT_COLOR = 0xffb02e;
export const HOVER_COLOR = 0x7fd1e8;
export const HIGHLIGHT_COLOR = 0x5b9dd9;

export class MaterialLib {
  constructor(project) {
    this.project = project;
    this.cache = new Map();
    this.archMaterials = new Set();
    this.ceilingMaterials = new Set();
    this.byLevel = new Map();
    this.levelFactor = new Map();
    this.clipPlanes = [];
    this.viewMode = 'normal';

    this.selection = new THREE.MeshBasicMaterial({
      color: SELECT_COLOR, wireframe: true, transparent: true, opacity: 0.9, depthTest: false,
    });
    this.hoverOutline = new THREE.MeshBasicMaterial({
      color: HOVER_COLOR, wireframe: true, transparent: true, opacity: 0.55, depthTest: false,
    });
    this.ghost = new THREE.MeshBasicMaterial({
      color: 0x5b9dd9, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    });
    this.spaceFill = new THREE.MeshBasicMaterial({
      color: 0x5b9dd9, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide,
    });
    this.spaceFillHot = new THREE.MeshBasicMaterial({
      color: SELECT_COLOR, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
    });
    this.pathway = new THREE.MeshStandardMaterial({
      color: 0x6f7c8c, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.85,
    });
    this.rack = new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.7, metalness: 0.4 });
    this.rackFrame = new THREE.MeshStandardMaterial({ color: 0x3d4653, roughness: 0.5, metalness: 0.7 });
    this.device = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.22 });
    // Per-instance colours come from InstancedMesh.instanceColor; Three adds
    // the shader define itself once that attribute exists.
    this.deviceInstanced = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.22 });
    this.grid = new THREE.LineBasicMaterial({ color: 0x1e2732, transparent: true, opacity: 0.85 });
    this.measure = new THREE.LineBasicMaterial({ color: 0xffb02e, depthTest: false });
    this.draft = new THREE.LineBasicMaterial({ color: 0x5b9dd9, depthTest: false });
  }

  /**
   * Material for a project material id applied to a building element kind.
   * Materials are also keyed by level so a single level can be ghosted back
   * without touching the meshes.
   */
  get(materialId, kind = 'wall', levelId = '_') {
    const key = `${materialId}:${kind}:${levelId}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const def = this.project.materials.find((m) => m.id === materialId)
      || { color: '#9aa2ad', roughness: 0.9, metalness: 0, opacity: 1 };

    const isGlass = kind === 'glass' || def.opacity < 1;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.color),
      roughness: def.roughness ?? 0.9,
      metalness: def.metalness ?? 0,
      transparent: isGlass,
      opacity: def.opacity ?? 1,
      side: kind === 'ceiling' || kind === 'slab' || kind === 'roof' ? THREE.DoubleSide : THREE.FrontSide,
      clippingPlanes: this.clipPlanes,
      clipShadows: true,
    });
    mat.userData.baseOpacity = def.opacity ?? 1;
    mat.userData.kind = kind;
    mat.userData.levelId = levelId;
    if (!isGlass) {
      this.archMaterials.add(mat);
      if (kind === 'ceiling') this.ceilingMaterials.add(mat);
    }
    if (!this.byLevel.has(levelId)) this.byLevel.set(levelId, new Set());
    this.byLevel.get(levelId).add(mat);
    this.cache.set(key, mat);
    this.applyViewModeTo(mat);
    return mat;
  }

  /** factor 1 = normal, 0.25 = ghosted. */
  setLevelFactor(levelId, factor) {
    if (this.levelFactor.get(levelId) === factor) return;
    this.levelFactor.set(levelId, factor);
    for (const m of this.byLevel.get(levelId) || []) this.applyViewModeTo(m);
  }

  setClipPlanes(planes) {
    this.clipPlanes.length = 0;
    this.clipPlanes.push(...planes);
    for (const m of this.cache.values()) m.clippingPlanes = this.clipPlanes;
    for (const m of [this.pathway, this.rack, this.rackFrame, this.device, this.deviceInstanced]) {
      m.clippingPlanes = this.clipPlanes;
    }
  }

  setViewMode(mode) {
    this.viewMode = VIEW_MODES[mode] ? mode : 'normal';
    for (const m of this.cache.values()) this.applyViewModeTo(m);
    const vm = VIEW_MODES[this.viewMode];
    const infraDim = this.viewMode === 'infrastructure' || this.viewMode === 'wireframe';
    this.pathway.opacity = infraDim ? 1 : 0.85;
    this.rack.opacity = vm.arch.opacity < 0.5 ? 0.6 : 1;
    this.rack.transparent = vm.arch.opacity < 0.5;
  }

  applyViewModeTo(mat) {
    const vm = VIEW_MODES[this.viewMode] || VIEW_MODES.normal;
    const isCeiling = mat.userData.kind === 'ceiling';
    const base = mat.userData.baseOpacity ?? 1;
    const factor = this.levelFactor.get(mat.userData.levelId) ?? 1;
    const target = (isCeiling ? vm.ceilingOpacity : vm.arch.opacity) * factor;
    mat.opacity = Math.min(base, target);
    mat.transparent = vm.arch.transparent || base < 1 || factor < 1;
    mat.depthWrite = vm.arch.depthWrite && base >= 1 && factor >= 1;
    mat.wireframe = vm.arch.wireframe;
    mat.needsUpdate = true;
  }

  /** Cable colour, honouring per-cable overrides. */
  cableColor(project, cable) {
    if (cable.color) return new THREE.Color(cable.color);
    const t = project.cableTypes.find((x) => x.id === cable.typeId);
    return new THREE.Color(t?.color || '#8d9aab');
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    for (const m of [this.selection, this.hoverOutline, this.ghost, this.spaceFill, this.spaceFillHot,
      this.pathway, this.rack, this.rackFrame, this.device, this.deviceInstanced, this.grid, this.measure, this.draft]) {
      m.dispose();
    }
  }
}
