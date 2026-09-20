/**
 * 3D labels.
 *
 * Canvas-drawn sprites — always face the camera, need no font download, and
 * are budgeted: only the nearest N labels within the distance cut-off render,
 * so a building with hundreds of devices never turns into a wall of text.
 */
import * as THREE from 'three';
import { labelTexture } from '../builders.js';
import { devicePosition, spaceCentroid, getLevel } from '../../model/queries.js';

const MAX_DEVICE_LABELS = 90;
const MAX_SPACE_LABELS = 60;

export function createLabelLayer() {
  const root = new THREE.Group();
  root.name = 'labels';
  root.renderOrder = 20;

  /** Reusable sprite pool — avoids per-frame allocation. */
  const pool = [];
  let used = 0;
  const camPos = new THREE.Vector3();

  function takeSprite() {
    if (used < pool.length) return pool[used++];
    const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 20;
    root.add(s);
    pool.push(s);
    used++;
    return s;
  }

  function release() {
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    used = 0;
  }

  let entries = [];   // { text, position, scale, color, kind, id }

  function rebuild(p, { devices = true, spaces = true, isDeviceVisible = () => true, isSpaceVisible = () => true, selected = new Set() } = {}) {
    entries = [];
    if (devices) {
      for (const d of p.devices) {
        if (!isDeviceVisible(d)) continue;
        const pos = devicePosition(p, d);
        entries.push({
          kind: 'device', id: d.id,
          text: d.id,
          position: new THREE.Vector3(pos.x, pos.y + Math.max(d.size.h / 2, 0.12) + 0.22, pos.z),
          size: 0.34, color: selected.has(d.id) ? '#ffd88a' : '#cfd8e4',
          border: selected.has(d.id) ? '#ffb02e' : '#2a3644',
          priority: selected.has(d.id) ? 2 : 1,
        });
      }
    }
    if (spaces) {
      for (const s of p.spaces) {
        if (!isSpaceVisible(s) || !s.boundary?.length) continue;
        const lvl = getLevel(p, s.levelId);
        const c = spaceCentroid(s);
        const y = (lvl?.elevation || 0) + Math.min(2.4, (lvl?.ceilingHeight || 3) * 0.55);
        entries.push({
          kind: 'space', id: s.id,
          text: s.code ? `${s.code} · ${s.name}` : s.name,
          position: new THREE.Vector3(c.x, y, c.z),
          size: 0.55, color: '#9fb4c8', border: '#243040',
          priority: selected.has(s.id) ? 2 : 0,
        });
      }
    }
  }

  /** Called every frame — cheap distance sort + budget. */
  function update(camera, view) {
    release();
    if (!view.layers.labels || !view.labels.show) return;
    camera.getWorldPosition(camPos);
    const maxD = view.labels.maxDistance || 45;
    const scaleMul = 1;

    const visible = [];
    for (const e of entries) {
      if (e.kind === 'device' && !view.labels.devices) continue;
      if (e.kind === 'space' && !view.labels.spaces) continue;
      const d = camPos.distanceTo(e.position);
      const limit = e.kind === 'space' ? maxD * 3.5 : maxD;
      if (d > limit && e.priority < 2) continue;
      visible.push({ e, d });
    }
    visible.sort((a, b) => (b.e.priority - a.e.priority) || (a.d - b.d));

    let devCount = 0, spaceCount = 0;
    for (const { e, d } of visible) {
      if (e.kind === 'device') { if (devCount >= MAX_DEVICE_LABELS) continue; devCount++; }
      else { if (spaceCount >= MAX_SPACE_LABELS) continue; spaceCount++; }

      const { texture, aspect } = labelTexture(e.text, { color: e.color, border: e.border });
      const sprite = takeSprite();
      sprite.material.map = texture;
      sprite.material.needsUpdate = true;
      sprite.material.opacity = e.priority >= 2 ? 1 : Math.max(0.25, 1 - d / (e.kind === 'space' ? maxD * 3.5 : maxD));
      sprite.position.copy(e.position);
      const h = e.size * scaleMul;
      sprite.scale.set(h * aspect, h, 1);
      sprite.visible = true;
    }
    release();
  }

  return {
    root, rebuild, update,
    setVisible(v) { root.visible = v; },
    dispose() {
      for (const s of pool) { s.material.dispose(); root.remove(s); }
      pool.length = 0;
    },
  };
}
