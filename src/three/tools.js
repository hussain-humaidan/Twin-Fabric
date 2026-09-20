/**
 * Pointer tools — everything you can do by clicking in the 3D view.
 *
 * select · move · draw wall · create room/hall · door/window/penetration ·
 * column · pathway · place equipment · add cable (auto or manual route) ·
 * measure.
 *
 * Tools never mutate the document directly; they call model/actions.js.
 */
import * as THREE from 'three';
import {
  state, bus, EV, setTool, select, setHover, clearSelection, toast, status, pushHistory,
} from '../core/store.js';
import * as A from '../model/actions.js';
import {
  getDevice, getLevel, levelAtY, spaceAt, wallsOfLevel, portAnchor, indexRev,
} from '../model/queries.js';
import { validateConnection } from '../logic/validate.js';
import { suggestCableType } from '../model/signals.js';
import { round, dist2 } from '../core/math.js';
import { catalogItem } from '../model/catalog.js';

const CLICK_SLOP = 5;   // px — beyond this a press counts as a drag, not a click

export function createTools(viewport, scene) {
  const dom = viewport.renderer.domElement;
  let portPicker = null;          // (device, role, cableTypeHint) => Promise<portId|null>
  let contextMenuHandler = null;

  const draft = {
    points: [],                   // committed chain points (wall / pathway / route)
    rectStart: null,
    dragging: null,               // { deviceId, offset, startPos }
    waypoint: null,               // { cableId, index, y } while dragging a route handle
    measure: [],
    cable: null,                  // { srcDeviceId, srcPortId, manual, waypoints }
  };

  let down = null;                // { x, y, button, pick }
  let lastPointer = null;

  /* ---------------------------------------------------------------- */
  /* helpers                                                           */
  /* ---------------------------------------------------------------- */

  function activeLevel() {
    const p = state.project;
    const id = state.view.activeLevelId;
    return (id && getLevel(p, id)) || p.levels[0] || null;
  }

  function drawY() {
    const l = activeLevel();
    return l ? l.elevation : 0;
  }

  /** Snap a raw world point: vertex snap first, then grid. */
  function snap(point, { vertical = false } = {}) {
    const g = state.view.grid;
    const p = state.project;
    const out = { x: point.x, y: point.y, z: point.z };
    let snapped = null;

    if (g.snapVertex) {
      const lvl = activeLevel();
      const walls = lvl ? wallsOfLevel(p, lvl.id) : [];
      let best = null;
      for (const w of walls) {
        for (const v of [w.start, w.end]) {
          const d = dist2({ x: out.x, z: out.z }, v);
          if (d < 0.45 && (!best || d < best.d)) best = { d, v };
        }
      }
      if (best) { out.x = best.v.x; out.z = best.v.z; snapped = 'vertex'; }
    }
    if (!snapped && g.snap && g.size > 0) {
      out.x = round(out.x, g.size);
      out.z = round(out.z, g.size);
      if (vertical) out.y = round(out.y, g.size);
      snapped = 'grid';
    }
    return { point: out, snapped };
  }

  function worldAt(event, y = null) {
    const p = viewport.planePoint(event, y ?? drawY());
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  function surfaceAt(event) {
    const s = viewport.surfacePoint(event, drawY());
    if (!s) return null;
    return { point: { x: s.point.x, y: s.point.y, z: s.point.z }, normal: s.normal, object: s.object };
  }

  function updateCursorReadout(event) {
    const w = worldAt(event);
    if (!w) return;
    const lvl = activeLevel();
    const sp = lvl ? spaceAt(state.project, { x: w.x, z: w.z }, lvl.id) : null;
    state.cursor = { x: w.x, y: w.y, z: w.z, spaceId: sp?.id || null, levelId: lvl?.id || null };
    bus.emit(EV.STATUS, null);
  }

  /* ---------------------------------------------------------------- */
  /* tool lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  const DRAW_TOOLS = new Set(['wall', 'room', 'hall', 'door', 'window', 'penetration', 'column', 'pathway', 'device', 'cable', 'measure']);

  function applyToolMode() {
    const tool = state.view.tool;
    const drawing = DRAW_TOOLS.has(tool);
    viewport.controls.mouseButtons.LEFT = drawing ? null : THREE.MOUSE.ROTATE;
    viewport.orthoControls.mouseButtons.LEFT = drawing ? null : THREE.MOUSE.PAN;
    dom.style.cursor = drawing ? 'crosshair' : 'default';
    if (!drawing) resetDraft();
    emitHint();
  }

  function resetDraft() {
    draft.points = [];
    draft.rectStart = null;
    draft.cable = null;
    scene.overlays.clearDraft();
    scene.overlays.setSnap(null);
  }

  function cancel() {
    if (draft.waypoint) {
      const wp = draft.waypoint;
      draft.waypoint = null;
      scene.overlays.setWaypointDragging(false);
      scene.overlays.setSnap(null);
      viewport.restoreControls();
      A.moveCableWaypoint(wp.cableId, wp.index, wp.start);
      toast('Waypoint drag cancelled.', 'info');
      return true;
    }
    if (draft.cable || draft.points.length || draft.rectStart) {
      resetDraft();
      emitHint();
      return true;
    }
    if (state.view.tool !== 'select') { setTool('select'); return true; }
    if (state.selection.length) { clearSelection(); return true; }
    return false;
  }

  const HINTS = {
    wall: 'Click to start the wall, click again for each corner. <b>Enter</b> or double-click finishes, <b>Esc</b> cancels.',
    room: 'Drag a rectangle to create a room — floor, four walls, ceiling and the room record.',
    hall: 'Drag a rectangle to create a hall.',
    door: 'Click a wall to cut a door (a cable penetration is added above it).',
    window: 'Click a wall to cut a window.',
    penetration: 'Click a wall to add a cable penetration — cables may route through it.',
    column: 'Click to place a structural column.',
    pathway: 'Click points to draw a cable tray. <b>Enter</b> finishes, <b>Esc</b> cancels.',
    device: 'Click in the building to place the selected equipment. <b>Esc</b> cancels.',
    measure: 'Click two points to measure. <b>Esc</b> clears.',
  };

  function emitHint() {
    const tool = state.view.tool;
    let text = HINTS[tool] || null;
    if (tool === 'cable') {
      text = draft.cable
        ? (draft.cable.manual
          ? 'Click points to draw the physical route, then click the <b>destination device</b>. <b>Enter</b> auto-routes the rest.'
          : 'Now click the <b>destination device</b>. <b>Esc</b> cancels.')
        : 'Click the <b>source device</b>, choose its output port, then click the destination.';
    }
    if (tool === 'device' && state.toolState.templateId) {
      text = `Placing <b>${catalogItem(state.toolState.templateId).name}</b> — click in the building. <b>Esc</b> cancels.`;
    }
    bus.emit('tool:hint', text);
  }

  bus.on(EV.TOOL, applyToolMode);

  /* ---------------------------------------------------------------- */
  /* pointer handling                                                  */
  /* ---------------------------------------------------------------- */

  dom.addEventListener('pointerdown', (e) => {
    if (viewport.isWalking) return;
    try { if (e.pointerId != null) dom.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    const pick = viewport.pick(e);
    down = { x: e.clientX, y: e.clientY, button: e.button, pick, time: performance.now() };

    // Grab a cable waypoint handle (highest picking priority).
    if (e.button === 0 && pick?.kind === 'waypoint' && !pick.endpoint && !pick.locked) {
      const cable = state.project.cables.find((c) => c.id === pick.cableId);
      const pt = cable?.route?.[pick.index];
      if (pt) {
        pushHistory();
        draft.waypoint = {
          cableId: pick.cableId, index: pick.index, y: pt.y,
          start: { x: pt.x, y: pt.y, z: pt.z },
        };
        scene.overlays.setWaypointDragging(true);
        viewport.controls.enabled = false;
        viewport.orthoControls.enabled = false;
        status('Dragging waypoint — hold Shift for height, Esc to cancel.');
      }
      return;
    }

    if (e.button === 0 && state.view.tool === 'select' && pick?.kind === 'device'
        && state.selection.some((s) => s.kind === 'device' && s.id === pick.id)) {
      const dev = getDevice(state.project, pick.id);
      if (dev && !dev.rackId) {
        const w = worldAt(e, dev.position.y);
        if (w) {
          pushHistory();
          draft.dragging = {
            deviceId: dev.id,
            offset: { x: dev.position.x - w.x, z: dev.position.z - w.z },
            y: dev.position.y,
          };
          viewport.controls.enabled = false;
          viewport.orthoControls.enabled = false;
        }
      }
    }

    if (e.button === 0 && (state.view.tool === 'room' || state.view.tool === 'hall')) {
      const w = worldAt(e);
      if (w) draft.rectStart = snap(w).point;
    }
  });

  dom.addEventListener('pointermove', (e) => {
    if (viewport.isWalking) return;
    lastPointer = e;
    updateCursorReadout(e);

    /* cable waypoint drag: horizontal by default, vertical with Shift */
    if (draft.waypoint) {
      const wp = draft.waypoint;
      let next = null;
      if (e.shiftKey) {
        // Move along Y in the camera's vertical plane through the waypoint.
        const cam = viewport.camera;
        const toCam = { x: cam.position.x - 0, z: cam.position.z - 0 };
        void toCam;
        const cur = state.project.cables.find((c) => c.id === wp.cableId)?.route?.[wp.index];
        if (cur) {
          const r = viewport.renderer.domElement.getBoundingClientRect();
          const dy = (wp.lastClientY ?? e.clientY) - e.clientY;
          next = { x: cur.x, y: Math.max(0, cur.y + dy * 0.02 * Math.max(1, r.height / 600)), z: cur.z };
        }
      } else {
        const w = worldAt(e, wp.y);
        if (w) {
          const s = snap(w);
          next = { x: s.point.x, y: wp.y, z: s.point.z };
        }
      }
      wp.lastClientY = e.clientY;
      if (next) {
        A.moveCableWaypoint(wp.cableId, wp.index, next, { live: true });
        scene.overlays.moveWaypointHandle(wp.index, next);
        scene.overlays.setSnap(next, viewport.camera);
      }
      return;
    }

    /* device drag */
    if (draft.dragging) {
      const w = worldAt(e, draft.dragging.y);
      if (w) {
        const raw = { x: w.x + draft.dragging.offset.x, y: draft.dragging.y, z: w.z + draft.dragging.offset.z };
        const s = snap(raw);
        A.moveDevice(draft.dragging.deviceId, s.point, { live: true });
        scene.overlays.setSnap(s.point, viewport.camera);
      }
      return;
    }

    /* rectangle preview */
    if (draft.rectStart) {
      const w = worldAt(e);
      if (w) {
        const s = snap(w).point;
        scene.overlays.setDraftRect(draft.rectStart, s, drawY());
      }
      return;
    }

    const tool = state.view.tool;

    /* chain preview (wall / pathway / manual cable route) */
    if ((tool === 'wall' || tool === 'pathway' || (tool === 'cable' && draft.cable?.manual)) && draft.points.length) {
      const w = tool === 'cable' ? surfaceAt(e)?.point : worldAt(e);
      if (w) {
        const s = snap(w, { vertical: tool !== 'wall' });
        const pts = [...draft.points, s.point].map((q) => new THREE.Vector3(q.x, liftY(q, tool), q.z));
        scene.overlays.setDraft(pts);
        scene.overlays.setSnap(s.point, viewport.camera);
      }
      return;
    }

    /* placement preview / hover */
    if (tool === 'device' && state.toolState.templateId) {
      const s = surfaceAt(e);
      if (s) scene.overlays.setSnap(s.point, viewport.camera);
      return;
    }

    if (tool === 'select' || tool === 'cable' || tool === 'door' || tool === 'window' || tool === 'penetration') {
      const pick = viewport.pick(e);
      setHover(pick?.kind || null, pick?.id || null);
      if (tool !== 'select') {
        const s = surfaceAt(e);
        if (s) scene.overlays.setSnap(s.point, viewport.camera);
      }
    }
  });

  function liftY(p, tool) {
    if (tool === 'wall') return drawY() + 0.05;
    return p.y;
  }

  dom.addEventListener('pointerup', (e) => {
    if (viewport.isWalking) return;
    try { if (e.pointerId != null) dom.releasePointerCapture(e.pointerId); } catch { /* synthetic event */ }

    if (draft.waypoint) {
      const wp = draft.waypoint;
      draft.waypoint = null;
      scene.overlays.setWaypointDragging(false);
      scene.overlays.setSnap(null);
      viewport.restoreControls();
      const cable = state.project.cables.find((c) => c.id === wp.cableId);
      const pt = cable?.route?.[wp.index];
      if (pt) {
        // Commit, which recomputes length, containment, openings and collisions.
        A.moveCableWaypoint(wp.cableId, wp.index, pt);
        const after = state.project.cables.find((c) => c.id === wp.cableId);
        const warn = (after?.warnings || [])[0];
        toast(
          `${wp.cableId} — ${after.length.toFixed(2)} m${warn ? ` · ${warn}` : ''}`,
          warn ? 'warn' : 'ok', warn ? 7000 : 2600
        );
      }
      return;
    }

    if (draft.dragging) {
      const id = draft.dragging.deviceId;
      const dev = getDevice(state.project, id);
      draft.dragging = null;
      viewport.restoreControls();
      scene.overlays.setSnap(null);
      if (dev) A.moveDevice(id, dev.position);   // commits + re-routes cables
      return;
    }

    if (draft.rectStart) {
      const w = worldAt(e);
      const start = draft.rectStart;
      draft.rectStart = null;
      scene.overlays.setDraftRect(null);
      if (w) {
        const end = snap(w).point;
        const x = Math.min(start.x, end.x), z = Math.min(start.z, end.z);
        const width = Math.abs(end.x - start.x), depth = Math.abs(end.z - start.z);
        if (width > 0.6 && depth > 0.6) {
          const lvl = activeLevel();
          const isHall = state.view.tool === 'hall';
          const sp = A.addRoomRect(lvl.id, x, z, width, depth, {
            kind: isHall ? 'hall' : 'room',
            name: isHall ? 'New hall' : 'New room',
          });
          if (sp) { select('space', sp.id); toast(`${sp.name} created (${width.toFixed(1)} × ${depth.toFixed(1)} m).`, 'ok'); }
        } else {
          toast('Rectangle too small.', 'warn');
        }
      }
      return;
    }

    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const wasClick = moved < CLICK_SLOP;
    const pick = down.pick;
    down = null;
    if (!wasClick) return;

    if (e.button === 2) { handleContextMenu(e, pick); return; }
    if (e.button !== 0) return;
    handleClick(e, pick);
  });

  dom.addEventListener('dblclick', (e) => {
    const tool = state.view.tool;
    if (tool === 'wall' || tool === 'pathway') { finishChain(); return; }
    if (tool === 'select') {
      const pick = viewport.pick(e);
      if (pick) bus.emit(EV.FOCUS, { kind: pick.kind, id: pick.id });
    }
  });

  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------------------------------------------------------------- */
  /* click dispatch                                                    */
  /* ---------------------------------------------------------------- */

  function handleClick(e, pick) {
    const tool = state.view.tool;
    switch (tool) {
      case 'select': {
        // Clicking a midpoint handle inserts a waypoint there.
        if (pick?.kind === 'waypointInsert') {
          const w = surfaceAt(e)?.point || worldAt(e);
          const cable = state.project.cables.find((c) => c.id === pick.cableId);
          const a = cable?.route?.[pick.index];
          const b = cable?.route?.[pick.index + 1];
          if (a && b) {
            const mid = w
              ? { x: w.x, y: (a.y + b.y) / 2, z: w.z }
              : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
            A.insertCableWaypoint(pick.cableId, pick.index, mid);
            toast('Waypoint added — drag it to shape the route.', 'ok');
          }
          break;
        }
        if (pick?.kind === 'waypoint') break;    // handled on pointerdown
        if (pick) select(pick.kind, pick.id, { additive: e.shiftKey });
        else if (!e.shiftKey) clearSelection();
        break;
      }
      case 'wall':
      case 'pathway': {
        const w = tool === 'pathway' ? (surfaceAt(e)?.point || worldAt(e)) : worldAt(e);
        if (!w) break;
        const s = snap(w, { vertical: tool === 'pathway' });
        draft.points.push(tool === 'wall' ? { x: s.point.x, y: drawY(), z: s.point.z } : s.point);
        if (tool === 'wall' && draft.points.length >= 2) {
          const a = draft.points[draft.points.length - 2];
          const b = draft.points[draft.points.length - 1];
          if (dist2(a, b) > 0.15) {
            A.addWall(activeLevel().id, { x: a.x, z: a.z }, { x: b.x, z: b.z });
          }
        }
        break;
      }
      case 'room':
      case 'hall': break;  // handled on pointerup
      case 'door':
      case 'window':
      case 'penetration': {
        const s = surfaceAt(e);
        if (!s) break;
        const lvl = activeLevel();
        const o = A.addOpeningAt(lvl.id, { x: s.point.x, z: s.point.z }, tool);
        if (o) { select('opening', o.id); toast(`${tool} added.`, 'ok'); }
        break;
      }
      case 'column': {
        const w = worldAt(e);
        if (!w) break;
        const s = snap(w).point;
        const c = A.addColumn(activeLevel().id, { x: s.x, z: s.z });
        if (c) select('column', c.id);
        break;
      }
      case 'device': {
        placeDevice(e);
        break;
      }
      case 'cable': {
        handleCableClick(e, pick);
        break;
      }
      case 'measure': {
        const s = surfaceAt(e);
        if (!s) break;
        if (draft.measure.length >= 2) draft.measure = [];
        draft.measure.push(s.point);
        if (draft.measure.length === 2) {
          const [a, b] = draft.measure;
          const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          scene.overlays.setMeasure(a, b);
          state.view.measure = { a, b, distance: d };
          bus.emit(EV.VIEW, state.view);
          toast(`Distance: ${d.toFixed(3)} m  (Δx ${Math.abs(a.x - b.x).toFixed(2)} · Δy ${Math.abs(a.y - b.y).toFixed(2)} · Δz ${Math.abs(a.z - b.z).toFixed(2)})`, 'ok', 8000);
        } else {
          scene.overlays.setMeasure(null);
          state.view.measure = null;
        }
        break;
      }
      default: break;
    }
  }

  function finishChain() {
    const tool = state.view.tool;
    if (tool === 'pathway' && draft.points.length >= 2) {
      const lvl = activeLevel();
      const pw = A.addPathway(draft.points.map((p) => ({ ...p })), { levelId: lvl?.id || null, kind: 'tray' });
      if (pw) { select('pathway', pw.id); toast(`${pw.name} created — cables can now route through it.`, 'ok'); }
    }
    resetDraft();
    emitHint();
  }

  /* ---------------------------------------------------------------- */
  /* equipment placement                                               */
  /* ---------------------------------------------------------------- */

  function placeDevice(e) {
    const templateId = state.toolState.templateId;
    if (!templateId) return;
    const item = catalogItem(templateId);
    const s = surfaceAt(e);
    if (!s) return;

    let pos = { ...s.point };
    let rotation = 0;
    const n = s.normal || new THREE.Vector3(0, 1, 0);
    const mounting = item.mounting;

    if (mounting === 'wall' && Math.abs(n.y) < 0.5) {
      // Sit against the wall face, facing out along its normal.
      pos.x += n.x * (item.size.d / 2 + 0.02);
      pos.z += n.z * (item.size.d / 2 + 0.02);
      rotation = Math.atan2(n.x, n.z);
      const lvl = activeLevel();
      if (lvl) pos.y = Math.max(pos.y, lvl.elevation + 1.2);
    } else if (mounting === 'ceiling') {
      const lvl = activeLevel();
      if (lvl) pos.y = lvl.elevation + lvl.ceilingHeight - item.size.h / 2 - 0.02;
    } else if (mounting === 'desk') {
      pos.y = s.point.y + 0.75;
    } else {
      pos.y = s.point.y + item.size.h / 2;
    }

    const sp = snap(pos);
    pos = { x: sp.point.x, y: pos.y, z: sp.point.z };

    const dev = A.addDevice(templateId, pos, { rotation });
    if (dev) {
      select(dev.id?.startsWith('RACK') ? 'rack' : 'device', dev.id);
      toast(`${dev.name} placed${dev.spaceId ? '' : ' (outside any room — check placement)'}.`, dev.spaceId ? 'ok' : 'warn');
    }
    if (!e.shiftKey) setTool('select');
  }

  /* ---------------------------------------------------------------- */
  /* cable creation                                                    */
  /* ---------------------------------------------------------------- */

  async function handleCableClick(e, pick) {
    const p = state.project;

    if (!draft.cable) {
      if (pick?.kind !== 'device') { toast('Click a source device to start the cable.', 'warn'); return; }
      const dev = getDevice(p, pick.id);
      const portId = await choosePort(dev, 'source');
      if (!portId) return;
      draft.cable = { srcDeviceId: dev.id, srcPortId: portId, manual: !!state.toolState.manualRoute, waypoints: [] };
      const port = dev.ports.find((x) => x.id === portId);
      status(`Cable from ${dev.name} · ${port.name} — pick the destination.`);
      emitHint();
      return;
    }

    if (draft.cable.manual && pick?.kind !== 'device') {
      const s = surfaceAt(e);
      if (!s) return;
      const sp = snap(s.point, { vertical: true }).point;
      draft.cable.waypoints.push(sp);
      draft.points = [...draft.cable.waypoints];
      scene.overlays.setDraft(draft.points.map((q) => new THREE.Vector3(q.x, q.y, q.z)));
      return;
    }

    if (pick?.kind !== 'device') { toast('Click the destination device.', 'warn'); return; }
    const dst = getDevice(p, pick.id);
    const src = getDevice(p, draft.cable.srcDeviceId);
    const srcPort = src?.ports.find((x) => x.id === draft.cable.srcPortId);
    if (!src || !dst || !srcPort) { resetDraft(); return; }

    const portId = await choosePort(dst, 'destination', srcPort);
    if (!portId) return;
    const dstPort = dst.ports.find((x) => x.id === portId);

    const typeId = suggestCableType(p, srcPort, dstPort).id;
    const v = validateConnection(p, { device: src, port: srcPort }, { device: dst, port: dstPort }, typeId);
    if (!v.ok) {
      toast(`Invalid connection — ${v.errors[0]}`, 'err', 8000);
      bus.emit('cable:invalid', { src, srcPort, dst, dstPort, validation: v });
      return;
    }

    let route = null;
    if (draft.cable.manual && draft.cable.waypoints.length) {
      route = [
        portAnchor(p, src, srcPort),
        ...draft.cable.waypoints,
        portAnchor(p, dst, dstPort),
      ];
    }

    const cable = A.createCable(
      { deviceId: src.id, portId: srcPort.id },
      { deviceId: dst.id, portId: dstPort.id },
      { typeId, route }
    );
    if (cable) {
      select('cable', cable.id);
      const warn = (cable.warnings || []).length ? ` — ${cable.warnings[0]}` : '';
      toast(`${cable.id} created · ${cable.length.toFixed(2)} m${warn}`, (cable.warnings || []).length ? 'warn' : 'ok', 6000);
      if (v.warnings.length) toast(v.warnings[0], 'warn', 7000);
    }
    resetDraft();
    if (!e.shiftKey) setTool('select');
    else emitHint();
  }

  async function choosePort(device, role, otherPort = null) {
    if (!device) return null;
    const wanted = role === 'source' ? ['out', 'bidir'] : ['in', 'bidir'];
    const candidates = device.ports.filter((p) => wanted.includes(p.direction));
    if (!candidates.length) {
      toast(`${device.name} has no ${role === 'source' ? 'output' : 'input'} port. Add one in the Ports panel.`, 'err', 6000);
      return null;
    }
    if (portPicker) return portPicker(device, role, otherPort);
    return candidates[0].id;
  }

  /* ---------------------------------------------------------------- */
  /* context menu                                                      */
  /* ---------------------------------------------------------------- */

  function handleContextMenu(e, pick) {
    // Right-click a waypoint to remove it, without disturbing the selection.
    if (pick?.kind === 'waypoint') {
      if (pick.endpoint) { toast('End points are the device port anchors and cannot be removed.', 'warn'); return; }
      if (pick.locked) { toast('This route is locked. Unlock it in the cable inspector first.', 'warn'); return; }
      A.deleteCableWaypoint(pick.cableId, pick.index);
      toast('Waypoint removed.', 'ok');
      return;
    }
    if (pick?.kind === 'waypointInsert') return;
    if (pick) select(pick.kind, pick.id);
    if (contextMenuHandler) contextMenuHandler({ x: e.clientX, y: e.clientY, target: pick, world: worldAt(e) });
  }

  /* ---------------------------------------------------------------- */
  /* keyboard within the viewport                                      */
  /* ---------------------------------------------------------------- */

  function onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Enter') {
      const tool = state.view.tool;
      if (tool === 'wall' || tool === 'pathway') { finishChain(); e.preventDefault(); }
      else if (tool === 'cable' && draft.cable?.manual) {
        draft.cable.manual = false;
        toast('Remaining route will be generated automatically — click the destination device.', 'info');
        emitHint();
      }
    }
    if (e.key === 'Escape') { if (cancel()) e.preventDefault(); }
  }
  window.addEventListener('keydown', onKey);

  applyToolMode();

  return {
    cancel,
    setPortPicker(fn) { portPicker = fn; },
    setContextMenuHandler(fn) { contextMenuHandler = fn; },
    get draft() { return draft; },
    clearMeasure() {
      draft.measure = [];
      scene.overlays.setMeasure(null);
      state.view.measure = null;
      bus.emit(EV.VIEW, state.view);
    },
    /** Start a cable from a port chosen in the inspector. */
    beginCableFromPort(deviceId, portId, { manual = false } = {}) {
      setTool('cable', { manualRoute: manual });
      draft.cable = { srcDeviceId: deviceId, srcPortId: portId, manual, waypoints: [] };
      emitHint();
    },
    dispose() { window.removeEventListener('keydown', onKey); },
  };
}
