/**
 * WebGL viewport: renderer, cameras, navigation, picking and the frame loop.
 *
 * Two navigation modes share one scene:
 *   orbit — editor camera (orbit / pan / zoom, orthographic presets)
 *   walk  — first-person walkthrough with gravity, stair climbing and wall
 *           collision resolved against the real building geometry
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { groundHeightAt, resolveWalk } from '../logic/collision.js';

export const CAMERA_PRESETS = {
  persp: { label: '3D', ortho: false },
  top:   { label: 'Top', ortho: true, dir: [0, 1, 0.0001], up: [0, 0, -1] },
  plan:  { label: 'Plan', ortho: true, dir: [0, 1, 0.0001], up: [0, 0, -1] },
  front: { label: 'Front', ortho: true, dir: [0, 0, 1], up: [0, 1, 0] },
  side:  { label: 'Side', ortho: true, dir: [1, 0, 0], up: [0, 1, 0] },
  iso:   { label: 'Iso', ortho: true, dir: [1, 1, 1], up: [0, 1, 0] },
};

export function createViewport(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x070a0f, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070a0f, 120, 340);

  /* ---------------- lighting ---------------- */
  const hemi = new THREE.HemisphereLight(0xbcd2e8, 0x30353d, 1.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.55);
  key.position.set(48, 90, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x93b4d6, 0.6);
  fill.position.set(-60, 40, -50);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a0, 0.3);
  rim.position.set(10, 20, -80);
  scene.add(rim);

  /* ---------------- cameras ---------------- */
  const aspect = () => Math.max(0.001, (container.clientWidth || 1) / (container.clientHeight || 1));
  const persp = new THREE.PerspectiveCamera(52, aspect(), 0.1, 2000);
  persp.position.set(62, 52, 94);
  const orthoSize = 45;
  const ortho = new THREE.OrthographicCamera(-orthoSize * aspect(), orthoSize * aspect(), orthoSize, -orthoSize, -600, 1200);
  ortho.position.set(30, 120, 20);

  let camera = persp;
  let preset = 'persp';

  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI * 0.499;
  controls.target.set(30, 4, 20);
  controls.screenSpacePanning = false;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN,
  };

  const orthoControls = new OrbitControls(ortho, renderer.domElement);
  orthoControls.enableDamping = true;
  orthoControls.dampingFactor = 0.12;
  orthoControls.enableRotate = false;
  orthoControls.target.set(30, 0, 20);
  orthoControls.enabled = false;
  orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  /* ---------------- walk mode ---------------- */
  const walkCam = new THREE.PerspectiveCamera(70, aspect(), 0.08, 800);
  const walk = new PointerLockControls(walkCam, renderer.domElement);
  const walkState = {
    active: false, vy: 0, eye: 1.68, speed: 3.4, run: 7.2,
    keys: new Set(), lastGround: 0, project: null, rev: 0,
  };

  /* ---------------- clipping ---------------- */
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  const clipPlanes = [];

  /* ---------------- picking ---------------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.22;
  raycaster.params.Points.threshold = 0.3;
  const pointer = new THREE.Vector2();
  /** @type {Array<{object:THREE.Object3D, resolve:Function, priority:number}>} */
  const pickTargets = [];

  function ndc(event) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((event.clientY - r.top) / r.height) * 2 + 1;
    return pointer;
  }

  function pick(event, { filterKinds = null } = {}) {
    if (walkState.active) return null;
    ndc(event);
    raycaster.setFromCamera(pointer, camera);
    const groups = pickTargets
      .filter((t) => t.object.visible && (!filterKinds || filterKinds.includes(t.kind)))
      .sort((a, b) => b.priority - a.priority);
    let best = null;
    for (const t of groups) {
      const hits = raycaster.intersectObject(t.object, true);
      for (const hit of hits) {
        const res = t.resolve(hit);
        if (!res) continue;
        const score = hit.distance - t.priority * 0.45;
        if (!best || score < best.score) best = { ...res, score, distance: hit.distance, point: hit.point.clone(), hit };
        break;
      }
    }
    return best;
  }

  /** Where the pointer ray crosses a horizontal plane at world Y. */
  function planePoint(event, y = 0) {
    ndc(event);
    raycaster.setFromCamera(pointer, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  /** Nearest point on any pickable surface, else the plane at `fallbackY`. */
  function surfacePoint(event, fallbackY = 0) {
    ndc(event);
    raycaster.setFromCamera(pointer, camera);
    let best = null;
    for (const t of pickTargets) {
      if (!t.object.visible || t.noSnap) continue;
      const hits = raycaster.intersectObject(t.object, true);
      if (hits.length && (!best || hits[0].distance < best.distance)) best = hits[0];
    }
    if (best) return { point: best.point.clone(), normal: best.face ? best.face.normal.clone().transformDirection(best.object.matrixWorld) : new THREE.Vector3(0, 1, 0), object: best.object };
    const p = planePoint(event, fallbackY);
    return p ? { point: p, normal: new THREE.Vector3(0, 1, 0), object: null } : null;
  }

  function registerPickable(object, resolve, { priority = 0, kind = null, noSnap = false } = {}) {
    const entry = { object, resolve, priority, kind, noSnap };
    pickTargets.push(entry);
    return () => {
      const i = pickTargets.indexOf(entry);
      if (i >= 0) pickTargets.splice(i, 1);
    };
  }

  /* ---------------- camera presets ---------------- */
  function setPreset(name) {
    const p = CAMERA_PRESETS[name];
    if (!p) return;
    preset = name;
    const target = (camera === persp ? controls.target : orthoControls.target).clone();
    if (!p.ortho) {
      camera = persp;
      controls.enabled = true;
      orthoControls.enabled = false;
      controls.target.copy(target);
    } else {
      camera = ortho;
      controls.enabled = false;
      orthoControls.enabled = true;
      orthoControls.target.copy(target);
      const d = new THREE.Vector3(...p.dir).normalize().multiplyScalar(220);
      ortho.position.copy(target).add(d);
      ortho.up.set(...p.up);
      ortho.lookAt(target);
      orthoControls.enableRotate = name === 'iso';
      orthoControls.update();
    }
    resize();
    return preset;
  }

  function frameBox(box, { padding = 1.35, instant = false } = {}) {
    if (!box || box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 * padding + 1.5;

    if (camera === ortho) {
      orthoControls.target.copy(centre);
      const p = CAMERA_PRESETS[preset];
      const d = new THREE.Vector3(...(p.dir || [0, 1, 0.0001])).normalize().multiplyScalar(220);
      ortho.position.copy(centre).add(d);
      const a = aspect();
      const half = Math.max(radius, 3);
      ortho.left = -half * a; ortho.right = half * a; ortho.top = half; ortho.bottom = -half;
      ortho.updateProjectionMatrix();
      orthoControls.update();
      return;
    }
    const dist = radius / Math.sin((persp.fov * Math.PI) / 360);
    const dir = persp.position.clone().sub(controls.target).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.01) dir.set(0.6, 0.55, 0.8).normalize();
    const goal = centre.clone().add(dir.multiplyScalar(Math.max(dist, 3)));
    if (instant) {
      persp.position.copy(goal);
      controls.target.copy(centre);
      controls.update();
    } else {
      tween = { fromPos: persp.position.clone(), toPos: goal, fromTgt: controls.target.clone(), toTgt: centre, t: 0, dur: 0.45 };
    }
  }

  let tween = null;

  /* ---------------- cutaway ---------------- */
  function setCutaway(on, height) {
    clipPlanes.length = 0;
    if (on) {
      clipPlane.constant = height;
      clipPlane.normal.set(0, -1, 0);
      clipPlanes.push(clipPlane);
    }
    if (opts.onClipChange) opts.onClipChange(clipPlanes);
  }

  /* ---------------- walk navigation ---------------- */
  function setNavMode(mode, { project = null, rev = 0, start = null } = {}) {
    const wantWalk = mode === 'walk';
    if (wantWalk === walkState.active) return;
    walkState.active = wantWalk;
    walkState.project = project;
    walkState.rev = rev;
    if (wantWalk) {
      const from = start || controls.target.clone();
      const g = project ? groundHeightAt(project, rev, from.x, from.z, from.y + 3, 3) : 0;
      walkCam.position.set(from.x, (g ?? 0) + walkState.eye, from.z);
      walkCam.rotation.set(0, persp.rotation.y, 0);
      walkState.lastGround = g ?? 0;
      walkState.vy = 0;
      controls.enabled = false;
      orthoControls.enabled = false;
      walk.lock();
      window.addEventListener('keydown', onWalkKeyDown);
      window.addEventListener('keyup', onWalkKeyUp);
    } else {
      walk.unlock();
      window.removeEventListener('keydown', onWalkKeyDown);
      window.removeEventListener('keyup', onWalkKeyUp);
      walkState.keys.clear();
      controls.enabled = camera === persp;
      orthoControls.enabled = camera === ortho;
      // Hand the orbit camera the walker's viewpoint.
      persp.position.copy(walkCam.position).add(new THREE.Vector3(0, 6, 10));
      controls.target.copy(walkCam.position);
      controls.update();
    }
    if (opts.onNavModeChange) opts.onNavModeChange(wantWalk ? 'walk' : 'orbit');
  }

  // Browser-initiated unlock (Esc) must return the app to orbit mode too.
  walk.addEventListener('unlock', () => { if (walkState.active) setNavMode('orbit'); });

  function onWalkKeyDown(e) {
    if (e.code === 'Escape') { setNavMode('orbit'); return; }
    walkState.keys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
  }
  function onWalkKeyUp(e) { walkState.keys.delete(e.code); }

  function updateWalk(dt) {
    const k = walkState.keys;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? walkState.run : walkState.speed) * dt;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);

    const before = walkCam.position.clone();
    if (fwd) walk.moveForward(fwd * speed);
    if (strafe) walk.moveRight(strafe * speed);

    const project = walkState.project;
    if (project) {
      const solved = resolveWalk(project, walkState.rev, before, walkCam.position, walkCam.position.y, 0.32);
      walkCam.position.x = solved.x;
      walkCam.position.z = solved.z;

      const g = groundHeightAt(project, walkState.rev, walkCam.position.x, walkCam.position.z, walkCam.position.y - walkState.eye + 0.5, 0.5);
      const targetY = (g ?? walkState.lastGround) + walkState.eye;
      if (g != null) walkState.lastGround = g;
      if (walkCam.position.y > targetY + 0.02) {
        walkState.vy -= 16 * dt;
        walkCam.position.y = Math.max(targetY, walkCam.position.y + walkState.vy * dt);
        if (walkCam.position.y <= targetY) walkState.vy = 0;
      } else {
        walkCam.position.y += (targetY - walkCam.position.y) * Math.min(1, dt * 14);
        walkState.vy = 0;
      }
    }
  }

  /* ---------------- loop ---------------- */
  const clock = new THREE.Clock();
  const frameCbs = new Set();
  let running = true;

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    // updateStyle must stay on: with it off the drawing buffer resizes but the
    // canvas keeps its old CSS box, and the render ends up stretched or blank.
    renderer.setSize(w, h);
    const a = w / h;
    persp.aspect = a; persp.updateProjectionMatrix();
    walkCam.aspect = a; walkCam.updateProjectionMatrix();
    const halfH = (ortho.top - ortho.bottom) / 2 || orthoSize;
    ortho.left = -halfH * a; ortho.right = halfH * a;
    ortho.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (tween) {
      tween.t += dt / tween.dur;
      const t = Math.min(1, tween.t);
      const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      persp.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
      controls.update();
      if (t >= 1) tween = null;
    }

    if (walkState.active) updateWalk(dt);
    else if (camera === persp) controls.update();
    else orthoControls.update();

    for (const cb of frameCbs) cb(dt, activeCamera());
    renderer.render(scene, activeCamera());
  }

  function activeCamera() { return walkState.active ? walkCam : camera; }

  tick();

  return {
    scene, renderer, controls, orthoControls,
    get camera() { return activeCamera(); },
    get orbitCamera() { return camera; },
    get preset() { return preset; },
    get isWalking() { return walkState.active; },
    walkCam,
    clipPlanes,
    registerPickable, pick, planePoint, surfacePoint, ndc, raycaster,
    setPreset, frameBox, setCutaway, setNavMode,
    /** Re-enable whichever orbit controller belongs to the active camera. */
    restoreControls() {
      controls.enabled = camera === persp && !walkState.active;
      orthoControls.enabled = camera === ortho && !walkState.active;
    },
    setWalkContext(project, rev) { walkState.project = project; walkState.rev = rev; },
    onFrame(fn) { frameCbs.add(fn); return () => frameCbs.delete(fn); },
    resize,
    dispose() {
      running = false;
      ro.disconnect();
      controls.dispose();
      orthoControls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
