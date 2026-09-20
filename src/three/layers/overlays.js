/**
 * Editor overlays: grid, selection + hover outlines, snap marker,
 * measurement, and the live preview while drawing walls, rooms, pathways
 * or a manual cable route.
 */
import * as THREE from 'three';

export function createOverlayLayer(matlib) {
  const root = new THREE.Group();
  root.name = 'overlays';
  root.renderOrder = 10;

  /* ---- grid ---- */
  const grid = new THREE.GridHelper(200, 200, 0x2c3a4c, 0x18202b);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.position.y = 0.004;
  const gridMinor = new THREE.GridHelper(200, 800, 0x18202b, 0x131a23);
  gridMinor.material.transparent = true;
  gridMinor.material.opacity = 0.28;
  gridMinor.position.y = 0.003;
  root.add(grid, gridMinor);

  /* ---- axes / north arrow ---- */
  const axes = new THREE.Group();
  const mkAxis = (dir, color) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), dir.clone().multiplyScalar(4).setY(0.02)]);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  };
  axes.add(mkAxis(new THREE.Vector3(1, 0, 0), 0xe0605c));   // +X east
  axes.add(mkAxis(new THREE.Vector3(0, 0, -1), 0x4ec9a0));  // -Z north
  root.add(axes);

  /* ---- selection / hover ---- */
  const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb02e);
  selectionBox.material.depthTest = false;
  selectionBox.material.transparent = true;
  selectionBox.visible = false;
  selectionBox.renderOrder = 30;
  root.add(selectionBox);

  const hoverBox = new THREE.Box3Helper(new THREE.Box3(), 0x7fd1e8);
  hoverBox.material.depthTest = false;
  hoverBox.material.transparent = true;
  hoverBox.material.opacity = 0.6;
  hoverBox.visible = false;
  hoverBox.renderOrder = 29;
  root.add(hoverBox);

  /* ---- snap marker ---- */
  const snapGeo = new THREE.RingGeometry(0.1, 0.16, 18);
  snapGeo.rotateX(-Math.PI / 2);
  const snapMarker = new THREE.Mesh(snapGeo, new THREE.MeshBasicMaterial({
    color: 0xffb02e, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }));
  snapMarker.visible = false;
  snapMarker.renderOrder = 31;
  root.add(snapMarker);

  /* ---- draft polyline (wall / route / pathway drawing) ---- */
  const draftGeo = new THREE.BufferGeometry();
  draftGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 256), 3));
  const draftLine = new THREE.Line(draftGeo, new THREE.LineBasicMaterial({
    color: 0x5b9dd9, depthTest: false, transparent: true, opacity: 0.95,
  }));
  draftLine.frustumCulled = false;
  draftLine.visible = false;
  draftLine.renderOrder = 32;
  root.add(draftLine);

  const draftPoints = new THREE.Points(draftGeo, new THREE.PointsMaterial({
    color: 0xffb02e, size: 8, sizeAttenuation: false, depthTest: false,
  }));
  draftPoints.frustumCulled = false;
  draftPoints.visible = false;
  draftPoints.renderOrder = 33;
  root.add(draftPoints);

  /* ---- draft rectangle (room tool) ---- */
  const rectGeo = new THREE.BufferGeometry();
  rectGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 5), 3));
  const rectLine = new THREE.LineLoop(rectGeo, new THREE.LineBasicMaterial({ color: 0xffb02e, depthTest: false }));
  rectLine.visible = false;
  rectLine.frustumCulled = false;
  rectLine.renderOrder = 32;
  root.add(rectLine);

  /* ---- cable waypoint handles ---- */
  const waypointGroup = new THREE.Group();
  waypointGroup.renderOrder = 36;
  root.add(waypointGroup);

  const wpGeo = new THREE.OctahedronGeometry(0.1);
  const midGeo = new THREE.SphereGeometry(0.062, 8, 6);
  const wpMat = new THREE.MeshBasicMaterial({ color: 0xffb02e, depthTest: false });
  const wpEndMat = new THREE.MeshBasicMaterial({ color: 0x5b9dd9, depthTest: false });
  const wpLockMat = new THREE.MeshBasicMaterial({ color: 0x8d9aab, depthTest: false });
  const midMat = new THREE.MeshBasicMaterial({
    color: 0x7fd1e8, depthTest: false, transparent: true, opacity: 0.5,
  });

  /**
   * Show draggable handles for a cable's physical route.
   * End handles are the port anchors and are not draggable — moving them would
   * detach the cable from its device. Midpoint handles insert a new waypoint.
   */
  // While a handle is being dragged the group must not be rebuilt underneath
  // the pointer, or the mesh the drag is tracking disappears mid-gesture.
  let waypointDragging = false;

  function setWaypointDragging(v) { waypointDragging = v; }

  function moveWaypointHandle(index, pos) {
    for (const m of waypointGroup.children) {
      if (m.userData.kind === 'waypoint' && m.userData.index === index) {
        m.position.set(pos.x, pos.y, pos.z);
        return;
      }
    }
  }

  function setWaypoints(cable, { locked = false } = {}) {
    if (waypointDragging) return;
    waypointGroup.clear();
    if (!cable || !(cable.route || []).length) return;
    const route = cable.route;
    for (let i = 0; i < route.length; i++) {
      const isEnd = i === 0 || i === route.length - 1;
      const mesh = new THREE.Mesh(wpGeo, isEnd ? wpEndMat : locked ? wpLockMat : wpMat);
      mesh.position.set(route[i].x, route[i].y, route[i].z);
      mesh.userData = { kind: 'waypoint', cableId: cable.id, index: i, endpoint: isEnd, locked };
      mesh.renderOrder = 36;
      waypointGroup.add(mesh);
    }
    if (locked) return;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 0.5) continue;
      const mesh = new THREE.Mesh(midGeo, midMat);
      mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      mesh.userData = { kind: 'waypointInsert', cableId: cable.id, index: i - 1 };
      mesh.renderOrder = 35;
      waypointGroup.add(mesh);
    }
  }

  /** Keep handles a usable size at any zoom. */
  function updateWaypointScale(camera) {
    if (!waypointGroup.children.length) return;
    for (const m of waypointGroup.children) {
      const d = camera.position.distanceTo(m.position);
      const s = Math.max(0.55, Math.min(d * 0.03, 7));
      m.scale.setScalar(s);
    }
  }

  function resolveWaypoint(hit) {
    const u = hit.object?.userData;
    if (u?.kind === 'waypoint' || u?.kind === 'waypointInsert') {
      return { kind: u.kind, id: `${u.cableId}:${u.index}`, cableId: u.cableId, index: u.index, endpoint: !!u.endpoint, locked: !!u.locked };
    }
    return null;
  }

  /* ---- measurement ---- */
  const measureGroup = new THREE.Group();
  measureGroup.renderOrder = 34;
  const measureGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const measureLine = new THREE.Line(measureGeo, new THREE.LineBasicMaterial({ color: 0xffb02e, depthTest: false }));
  const endA = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb02e, depthTest: false }));
  const endB = endA.clone();
  measureGroup.add(measureLine, endA, endB);
  measureGroup.visible = false;
  root.add(measureGroup);

  /* ---- API ---- */
  function setGrid(show, sizeHint = 1) {
    grid.visible = show;
    gridMinor.visible = show && sizeHint <= 0.5;
    axes.visible = show;
  }

  function setSelectionBox(box) {
    if (!box) { selectionBox.visible = false; return; }
    selectionBox.box.copy(box);
    selectionBox.visible = true;
  }

  function setHoverBox(box) {
    if (!box) { hoverBox.visible = false; return; }
    hoverBox.box.copy(box);
    hoverBox.visible = true;
  }

  function setSnap(point, camera) {
    if (!point) { snapMarker.visible = false; return; }
    snapMarker.position.set(point.x, point.y + 0.01, point.z);
    if (camera) {
      const d = camera.position.distanceTo(snapMarker.position);
      const s = Math.max(0.5, d * 0.035);
      snapMarker.scale.set(s, s, s);
    }
    snapMarker.visible = true;
  }

  function setDraft(points, { closed = false } = {}) {
    if (!points || points.length < 1) {
      draftLine.visible = false;
      draftPoints.visible = false;
      return;
    }
    const pts = closed ? [...points, points[0]] : points;
    const arr = draftGeo.attributes.position.array;
    const n = Math.min(pts.length, arr.length / 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pts[i].x; arr[i * 3 + 1] = pts[i].y; arr[i * 3 + 2] = pts[i].z;
    }
    draftGeo.attributes.position.needsUpdate = true;
    draftGeo.setDrawRange(0, n);
    draftGeo.computeBoundingSphere();
    draftLine.visible = n >= 2;
    draftPoints.visible = true;
  }

  function setDraftRect(a, b, y) {
    if (!a || !b) { rectLine.visible = false; return; }
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    const arr = rectGeo.attributes.position.array;
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) { arr[i * 3] = pts[i][0]; arr[i * 3 + 1] = y + 0.02; arr[i * 3 + 2] = pts[i][1]; }
    rectGeo.attributes.position.needsUpdate = true;
    rectGeo.setDrawRange(0, 4);
    rectGeo.computeBoundingSphere();
    rectLine.visible = true;
  }

  function setMeasure(a, b) {
    if (!a || !b) { measureGroup.visible = false; return; }
    measureGeo.setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
    endA.position.set(a.x, a.y, a.z);
    endB.position.set(b.x, b.y, b.z);
    measureGroup.visible = true;
  }

  return {
    root, setGrid, setSelectionBox, setHoverBox, setSnap, setDraft, setDraftRect, setMeasure,
    waypointGroup, setWaypoints, updateWaypointScale, resolveWaypoint,
    setWaypointDragging, moveWaypointHandle,
    clearDraft() { setDraft(null); setDraftRect(null); },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
      root.clear();
    },
  };
}
