/**
 * Scene orchestration.
 *
 * Owns the render layers, turns view state into visibility predicates, and
 * rebuilds only the layers a change actually invalidated (that is what the
 * commit scopes are for).
 */
import * as THREE from 'three';
import { bus, EV, SCOPE, state } from '../core/store.js';
import { MaterialLib } from './materials.js';
import { createArchitectureLayer } from './layers/architecture.js';
import { createInfrastructureLayer } from './layers/infrastructure.js';
import { createCableLayer } from './layers/cables.js';
import { createPathwayLayer } from './layers/pathways.js';
import { createLabelLayer } from './layers/labels.js';
import { createOverlayLayer } from './layers/overlays.js';
import { getDevice, getLevel, isVisibleInScenario, indexRev } from '../model/queries.js';

export function createScene(viewport) {
  let project = state.project;
  const matlib = new MaterialLib(project);
  matlib.setClipPlanes(viewport.clipPlanes);

  const architecture = createArchitectureLayer(matlib);
  const infrastructure = createInfrastructureLayer(matlib);
  const cables = createCableLayer(matlib);
  const pathways = createPathwayLayer(matlib);
  const labels = createLabelLayer();
  const overlays = createOverlayLayer(matlib);

  viewport.scene.add(architecture.root, pathways.root, infrastructure.root, cables.root, labels.root, overlays.root);

  /* ---------------- visibility predicates ---------------- */

  const levelVisible = (levelId) => {
    if (!levelId) return true;
    const v = state.view;
    if ((v.levelState[levelId] || 'visible') === 'hidden') return false;
    if (v.isolateLevel && v.activeLevelId && v.activeLevelId !== levelId) return false;
    return true;
  };

  function deviceVisible(d) {
    const v = state.view;
    if (!v.layers.equipment) return false;
    if (!levelVisible(d.levelId)) return false;
    if (v.statusFilter[d.status] === false) return false;
    if (!isVisibleInScenario(d, v.scenarioId, project)) return false;
    return true;
  }

  function cableVisible(c) {
    const v = state.view;
    if (!v.layers.cables) return false;
    if (v.cableTypes[c.typeId] === false) return false;
    if (v.signalFilter[c.signal] === false) return false;
    if (v.statusFilter[c.status] === false) return false;
    if (!isVisibleInScenario(c, v.scenarioId, project)) return false;
    const a = c.from ? getDevice(project, c.from.deviceId) : null;
    const b = c.to ? getDevice(project, c.to.deviceId) : null;
    // A riser between two floors stays visible while either end's level is on.
    if (a && b && !levelVisible(a.levelId) && !levelVisible(b.levelId)) return false;
    if (v.activeLevelId && v.isolateLevel) {
      if (a?.levelId !== v.activeLevelId && b?.levelId !== v.activeLevelId) return false;
    }
    return true;
  }

  function pathwayVisible(pw) {
    if (!state.view.layers.pathways) return false;
    return levelVisible(pw.levelId);
  }

  function spaceLabelVisible(s) { return levelVisible(s.levelId); }

  /* ---------------- rebuild ---------------- */

  function emphasis() {
    const selected = new Set(state.selection.filter((s) => s.kind === 'device').map((s) => s.id));
    return {
      selected,
      hover: state.hover?.kind === 'device' ? state.hover.id : null,
      highlight: state.highlight.devices,
    };
  }

  function cableEmphasis() {
    return {
      selected: new Set(state.selection.filter((s) => s.kind === 'cable').map((s) => s.id)),
      hover: state.hover?.kind === 'cable' ? state.hover.id : null,
      highlight: state.highlight.cables,
    };
  }

  function rebuildArchitecture() { architecture.rebuild(project); }
  function rebuildDevices() { infrastructure.rebuild(project, deviceVisible, emphasis()); }
  function rebuildCables() { cables.rebuild(project, cableVisible, cableEmphasis()); }
  function rebuildPathways() {
    pathways.rebuild(project, pathwayVisible, {
      selected: new Set(state.selection.filter((s) => s.kind === 'pathway').map((s) => s.id)),
    });
  }
  function rebuildLabels() {
    labels.rebuild(project, {
      devices: true, spaces: true,
      isDeviceVisible: deviceVisible,
      isSpaceVisible: spaceLabelVisible,
      selected: new Set(state.selection.map((s) => s.id)),
    });
  }

  function rebuildAll() {
    matlib.project = project;
    rebuildArchitecture();
    rebuildPathways();
    rebuildDevices();
    rebuildCables();
    rebuildLabels();
    applyView();
  }

  function applyView() {
    const v = state.view;
    architecture.applyVisibility(v);
    infrastructure.applyVisibility(v);
    cables.applyVisibility(v);
    pathways.applyVisibility(v);
    labels.setVisible(v.layers.labels && v.labels.show);
    overlays.setGrid(v.grid.show, v.grid.size);
    matlib.setViewMode(v.viewMode);
    viewport.setCutaway(v.cutaway.on, v.cutaway.height);
    matlib.setClipPlanes(viewport.clipPlanes);
  }

  /* ---------------- events ---------------- */

  bus.on(EV.PROJECT, ({ scope }) => {
    project = state.project;
    matlib.project = project;
    const all = scope.has(SCOPE.ALL);
    if (all || scope.has(SCOPE.ARCH) || scope.has(SCOPE.SPACES)) rebuildArchitecture();
    if (all || scope.has(SCOPE.PATHWAYS)) rebuildPathways();
    if (all || scope.has(SCOPE.DEVICES) || scope.has(SCOPE.RACKS)) rebuildDevices();
    if (all || scope.has(SCOPE.CABLES) || scope.has(SCOPE.DEVICES)) rebuildCables();
    if (all || scope.has(SCOPE.DEVICES) || scope.has(SCOPE.SPACES)) rebuildLabels();
    if (all) applyView();
    updateSelectionVisuals();
    viewport.setWalkContext(project, indexRev());
  });

  bus.on(EV.SELECTION, () => {
    rebuildDevices();
    rebuildCables();
    rebuildPathways();
    rebuildLabels();
    updateSelectionVisuals();
    const spaceIds = state.selection.filter((s) => s.kind === 'space').map((s) => s.id);
    architecture.setSpaceHighlight(spaceIds);
  });

  bus.on(EV.HOVER, () => {
    rebuildDevices();
    rebuildCables();
    updateHoverVisual();
  });

  bus.on(EV.VIEW, () => {
    rebuildDevices();
    rebuildCables();
    rebuildPathways();
    rebuildLabels();
    applyView();
  });

  bus.on(EV.FOCUS, ({ kind, id }) => focusEntity(kind, id));

  /* ---------------- selection visuals ---------------- */

  function boundsFor(kind, id) {
    switch (kind) {
      case 'device':
      case 'rack': return infrastructure.boundsOf(kind, id);
      case 'cable': return cables.boundsOf(project, id);
      case 'pathway': return pathways.boundsOf(id);
      case 'level': return architecture.levelBounds(id);
      case 'opening': {
        const o = project.openings.find((x) => x.id === id);
        if (!o) return null;
        return architecture.boundsOf('wall', o.wallId);
      }
      default: return architecture.boundsOf(kind, id);
    }
  }

  function updateSelectionVisuals() {
    const sel = state.selection[state.selection.length - 1];
    if (!sel) {
      overlays.setSelectionBox(null);
      overlays.setWaypoints(null);
      return;
    }
    const box = boundsFor(sel.kind, sel.id);
    overlays.setSelectionBox(box && !box.isEmpty() ? box : null);

    // A selected cable exposes its route as draggable handles.
    if (sel.kind === 'cable') {
      const cable = project.cables.find((c) => c.id === sel.id);
      overlays.setWaypoints(cable || null, { locked: cable?.routeMode === 'locked' });
    } else {
      overlays.setWaypoints(null);
    }
  }

  function updateHoverVisual() {
    const h = state.hover;
    if (!h || h.kind === 'device' || h.kind === 'cable') { overlays.setHoverBox(null); return; }
    const box = boundsFor(h.kind, h.id);
    overlays.setHoverBox(box && !box.isEmpty() ? box : null);
  }

  function focusEntity(kind, id) {
    if (kind === 'level') {
      const box = architecture.levelBounds(id);
      if (box) viewport.frameBox(box, { padding: 1.1 });
      return;
    }
    if (kind === 'space') {
      const s = project.spaces.find((x) => x.id === id);
      const lvl = s ? getLevel(project, s.levelId) : null;
      if (s && lvl && s.boundary?.length) {
        const box = new THREE.Box3();
        for (const p of s.boundary) {
          box.expandByPoint(new THREE.Vector3(p.x, lvl.elevation, p.z));
          box.expandByPoint(new THREE.Vector3(p.x, lvl.elevation + lvl.ceilingHeight, p.z));
        }
        viewport.frameBox(box, { padding: 1.25 });
      }
      return;
    }
    const box = boundsFor(kind, id);
    if (box && !box.isEmpty()) viewport.frameBox(box, { padding: kind === 'cable' ? 1.2 : 2.6 });
  }

  function buildingBounds() {
    const box = new THREE.Box3();
    for (const s of project.slabs) {
      for (const p of s.polygon || []) {
        box.expandByPoint(new THREE.Vector3(p.x, s.topElevation - s.thickness, p.z));
        box.expandByPoint(new THREE.Vector3(p.x, s.topElevation, p.z));
      }
    }
    for (const l of project.levels) {
      box.expandByPoint(new THREE.Vector3(box.min.x || 0, l.elevation + l.height, box.min.z || 0));
    }
    return box;
  }

  /* ---------------- pickables ---------------- */

  // Waypoint handles sit above everything so they stay grabbable.
  viewport.registerPickable(overlays.waypointGroup, overlays.resolveWaypoint, { priority: 10, kind: 'waypoint', noSnap: true });
  // noSnap: placement and routing must not snap to other cables.
  viewport.registerPickable(cables.root, cables.resolve, { priority: 3, kind: 'cable', noSnap: true });
  viewport.registerPickable(infrastructure.root, infrastructure.resolve, { priority: 2, kind: 'device' });
  viewport.registerPickable(pathways.root, pathways.resolve, { priority: 1, kind: 'pathway' });
  viewport.registerPickable(architecture.root, architecture.resolve, { priority: 0, kind: 'arch' });

  /* ---------------- frame ---------------- */

  viewport.onFrame((dt, camera) => {
    labels.update(camera, state.view);
    overlays.updateWaypointScale(camera);
  });

  rebuildAll();

  return {
    matlib, architecture, infrastructure, cables, pathways, labels, overlays,
    rebuildAll, applyView, focusEntity, buildingBounds, boundsFor,
    deviceVisible, cableVisible, pathwayVisible, levelVisible,
    updateSelectionVisuals,
    dispose() {
      architecture.dispose(); infrastructure.dispose(); cables.dispose();
      pathways.dispose(); labels.dispose(); overlays.dispose(); matlib.dispose();
    },
  };
}
