/**
 * Physically-aware cable router.
 *
 * Builds a navigation graph out of the building itself:
 *   • pathway vertices  (trays, conduits, ducts, vertical shafts)
 *   • opening nodes     (doors, archways, cable penetrations — only where the
 *                        opening actually admits cables)
 *   • space hubs        (ceiling void above each room's centroid)
 *   • stair voids       (vertical link between levels)
 * then runs Dijkstra with per-pathway cost weights, so a cable prefers
 * tray → corridor → riser over free air, and can never pass through a solid
 * wall or an un-penetrated slab.
 */
import { dist3, pointInPolygon, polygonCentroid, simplifyPolyline, polylineLength } from '../core/math.js';
import { PATHWAY_COST } from '../model/schema.js';
import { openingWorld, wallFrame, stairGeometry } from './geometry.js';
import { segmentBlocked } from './collision.js';

const MERGE = 0.25; // metres — pathway vertices this close share a graph node

let gCacheRev = null;
let gCache = null;

const nkey = (p) => `${Math.round(p.x / MERGE)}_${Math.round(p.y / MERGE)}_${Math.round(p.z / MERGE)}`;

class Graph {
  constructor() { this.nodes = new Map(); this.adj = new Map(); }
  add(id, pos, kind, ref) {
    if (!this.nodes.has(id)) { this.nodes.set(id, { id, pos, kind, ref }); this.adj.set(id, []); }
    return this.nodes.get(id);
  }
  link(a, b, cost, meta = {}) {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b)) return;
    this.adj.get(a).push({ to: b, cost, meta });
    this.adj.get(b).push({ to: a, cost, meta });
  }
}

/** Build (or reuse) the routing graph for the current project state. */
export function buildRouteGraph(project, rev) {
  if (gCache && gCacheRev === rev && gCache.project === project) return gCache;

  const g = new Graph();
  const R = project.settings.routing;
  const levels = new Map(project.levels.map((l) => [l.id, l]));
  const wallsById = new Map(project.walls.map((w) => [w.id, w]));

  /* ---- 1. pathway vertices ---- */
  for (const pw of project.pathways) {
    if (pw.status === 'removed') continue;
    const cost = pw.costFactor ?? PATHWAY_COST[pw.kind] ?? 0.6;
    let prevId = null;
    for (const pt of pw.points || []) {
      const id = `pw:${nkey(pt)}`;
      const n = g.add(id, { ...pt }, 'pathway', pw.id);
      if (!n.ref) n.ref = pw.id;
      if (!n.pathways) n.pathways = new Set();
      n.pathways = n.pathways || new Set();
      n.pathways.add(pw.id);
      if (prevId) g.link(prevId, id, dist3(g.nodes.get(prevId).pos, pt) * cost, { pathwayId: pw.id });
      prevId = id;
    }
  }

  /* ---- 2. openings that admit cables ---- */
  const openingNodes = [];
  for (const o of project.openings) {
    if (o.cablePassable === false) continue;
    if (o.kind === 'door' && !R.allowDoorRouting) continue;
    const w = wallsById.get(o.wallId);
    if (!w) continue;
    const lvl = levels.get(w.levelId);
    const ow = openingWorld(w, o, lvl ? lvl.elevation : 0);
    // Cables hug the head of a door, and sit centred in a dedicated penetration.
    const y = o.kind === 'door' || o.kind === 'archway'
      ? ow.yMax - Math.min(0.12, o.height * 0.08)
      : ow.centre.y;
    const pos = { x: ow.centre.x, y, z: ow.centre.z };
    const id = `op:${o.id}`;
    g.add(id, pos, 'opening', o.id);
    openingNodes.push({ id, opening: o, wall: w, world: ow, pos });
  }

  /* ---- 3. space hubs in the ceiling void ---- */
  const hubs = [];
  for (const s of project.spaces) {
    if (!s.boundary?.length) continue;
    const lvl = levels.get(s.levelId);
    if (!lvl) continue;
    const c = polygonCentroid(s.boundary);
    const floorY = lvl.elevation + (s.floorOffset || 0);
    const ceilH = s.ceilingHeight ?? lvl.ceilingHeight;
    const y = lvl.hasCeiling
      ? Math.min(floorY + ceilH + 0.25, lvl.elevation + lvl.height - lvl.slabThickness - 0.1)
      : floorY + ceilH - 0.15;
    const id = `hub:${s.id}`;
    g.add(id, { x: c.x, y, z: c.z }, 'hub', s.id);
    hubs.push({ id, space: s, pos: { x: c.x, y, z: c.z }, level: lvl });
  }
  const hubBySpace = new Map(hubs.map((h) => [h.space.id, h]));

  /* ---- 4. hub ↔ opening ---- */
  for (const on of openingNodes) {
    for (const sid of [on.opening.spaceA, on.opening.spaceB]) {
      if (!sid) continue;
      const hub = hubBySpace.get(sid);
      if (!hub) continue;
      const hit = segmentBlocked(project, rev, hub.pos, on.pos, { allowDoors: true, ignoreSlabs: true });
      if (hit.blocked && hit.wallId !== on.wall.id) continue;
      g.link(hub.id, on.id, dist3(hub.pos, on.pos) * R.openingCost, { openingId: on.opening.id });
    }
    // If the opening was never associated with spaces, probe both sides.
    if (!on.opening.spaceA && !on.opening.spaceB) {
      const f = wallFrame(on.wall);
      for (const sgn of [1, -1]) {
        const probe = { x: on.pos.x + f.normal.x * 0.6 * sgn, z: on.pos.z + f.normal.z * 0.6 * sgn };
        const hub = hubs.find((h) => h.space.levelId === on.wall.levelId && pointInPolygon(probe, h.space.boundary));
        if (hub) g.link(hub.id, on.id, dist3(hub.pos, on.pos) * R.openingCost, { openingId: on.opening.id });
      }
    }
  }

  /* ---- 5. hub ↔ pathway vertices ---- */
  const pwNodes = Array.from(g.nodes.values()).filter((n) => n.kind === 'pathway');
  for (const hub of hubs) {
    let linked = 0;
    const candidates = pwNodes
      .map((n) => ({ n, d: dist3(n.pos, hub.pos) }))
      .filter((c) => c.d < 30)
      .sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (linked >= 4 && c.d > 10) break;
      const inside = pointInPolygon({ x: c.n.pos.x, z: c.n.pos.z }, hub.space.boundary);
      if (!inside && c.d > 14) continue;
      const hit = segmentBlocked(project, rev, hub.pos, c.n.pos, { allowDoors: true, ignoreSlabs: !inside });
      if (hit.blocked) continue;
      g.link(hub.id, c.n.id, c.d * (inside ? 0.8 : R.freeAirCost * 0.6), {});
      linked++;
      if (linked >= 6) break;
    }
  }

  /* ---- 5b. opening ↔ nearby containment ----
     A cable leaving a room through a penetration should reach the tray
     directly, not detour via the room-centre hub. */
  for (const on of openingNodes) {
    const cands = pwNodes
      .map((n) => ({ n, d: dist3(n.pos, on.pos) }))
      .filter((c) => c.d < 14)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const c of cands) {
      const hit = segmentBlocked(project, rev, on.pos, c.n.pos, { allowDoors: true, ignoreSlabs: true });
      if (hit.blocked && hit.wallId !== on.wall.id) continue;
      g.link(on.id, c.n.id, c.d * 0.9, {});
    }
  }

  /* ---- 6. stair voids link levels ---- */
  for (const st of project.stairs) {
    const from = levels.get(st.fromLevelId), to = levels.get(st.toLevelId);
    if (!from || !to) continue;
    const geom = stairGeometry(st, from.elevation, to.elevation);
    const c = polygonCentroid(geom.footprint);
    const lowY = from.elevation + Math.min(from.ceilingHeight, 2.6);
    const highY = to.elevation + Math.min(to.ceilingHeight, 2.6);
    const lowId = `st:${st.id}:lo`, highId = `st:${st.id}:hi`;
    g.add(lowId, { x: c.x, y: lowY, z: c.z }, 'stair', st.id);
    g.add(highId, { x: c.x, y: highY, z: c.z }, 'stair', st.id);
    g.link(lowId, highId, (highY - lowY) * 1.2, { stairId: st.id });
    for (const [nid, lvl] of [[lowId, from], [highId, to]]) {
      const hub = hubs.find((h) => h.level.id === lvl.id && pointInPolygon(c, h.space.boundary));
      if (hub) g.link(nid, hub.id, dist3(g.nodes.get(nid).pos, hub.pos) * 1.1, { stairId: st.id });
    }
  }

  gCache = { project, graph: g, hubBySpace, hubs, openingNodes, rev };
  gCacheRev = rev;
  return gCache;
}

export function invalidateRouteGraph() { gCache = null; gCacheRev = null; }

/* ------------------------------------------------------------------ */
/* Dijkstra                                                            */
/* ------------------------------------------------------------------ */

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    this.a.push(item);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].f < this.a[m].f) m = l;
        if (r < this.a.length && this.a[r].f < this.a[m].f) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
}

function dijkstra(graph, startId, goalId, extraAdj) {
  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const seen = new Set();
  const heap = new MinHeap();
  heap.push({ id: startId, f: 0 });
  const adjOf = (id) => (extraAdj.get(id) || []).concat(graph.adj.get(id) || []);

  while (heap.size) {
    const { id } = heap.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === goalId) break;
    const d = dist.get(id);
    for (const e of adjOf(id)) {
      const nd = d + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: id, meta: e.meta });
        heap.push({ id: e.to, f: nd });
      }
    }
  }
  if (!dist.has(goalId)) return null;
  const path = [];
  const metas = [];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (!p) return null;
    path.push(cur);
    metas.push(p.meta || {});
    cur = p.from;
  }
  path.push(startId);
  path.reverse();
  metas.reverse();
  return { path, metas, cost: dist.get(goalId) };
}

/* ------------------------------------------------------------------ */
/* public routing API                                                  */
/* ------------------------------------------------------------------ */

/**
 * Route a cable between two world points.
 * @returns {{ route:Array<{x,y,z}>, pathwayIds:string[], openingIds:string[],
 *             warnings:string[], cost:number, viaGraph:boolean }}
 */
export function routeBetween(project, rev, from, to, opts = {}) {
  const R = project.settings.routing;
  const { fromSpaceId = null, toSpaceId = null } = opts;
  const warnings = [];

  const direct = segmentBlocked(project, rev, from, to, { allowDoors: R.allowDoorRouting });
  if (!direct.blocked && dist3(from, to) < 3.5) {
    return { route: [clone(from), clone(to)], pathwayIds: [], openingIds: direct.openingIds, warnings, cost: dist3(from, to), viaGraph: false };
  }

  const gc = buildRouteGraph(project, rev);
  const g = gc.graph;
  const extra = new Map();
  const S = '__src__', T = '__dst__';
  g.add(S, clone(from), 'terminal', null);
  g.add(T, clone(to), 'terminal', null);
  extra.set(S, []);
  extra.set(T, []);

  const attach = (nodeId, pos, spaceId, otherEnd) => {
    const edges = [];
    const seenTargets = new Set();
    const hub = spaceId ? gc.hubBySpace.get(spaceId) : null;
    if (hub) {
      edges.push({ to: hub.id, cost: dropCost(pos, hub.pos, R), meta: { drop: true } });
      seenTargets.add(hub.id);
    }
    const near = Array.from(g.nodes.values())
      .filter((n) => (n.kind === 'pathway' || n.kind === 'opening' || n.kind === 'hub') && !seenTargets.has(n.id))
      .map((n) => ({ n, d: dist3(n.pos, pos) }))
      .filter((c) => c.d < 22)
      .sort((a, b) => a.d - b.d)
      .slice(0, 14);
    for (const c of near) {
      const hit = segmentBlocked(project, rev, pos, c.n.pos, { allowDoors: R.allowDoorRouting });
      if (hit.blocked) continue;
      const w = c.n.kind === 'pathway' ? R.dropCost : c.n.kind === 'opening' ? R.openingCost : R.freeAirCost * 0.7;
      edges.push({ to: c.n.id, cost: c.d * w, meta: { openingIds: hit.openingIds } });
      seenTargets.add(c.n.id);
    }
    // Last resort: a straight free-air run to the other terminal if legal.
    const straight = segmentBlocked(project, rev, pos, otherEnd, { allowDoors: R.allowDoorRouting });
    if (!straight.blocked && R.allowFreeAir) {
      edges.push({ to: nodeId === S ? T : S, cost: dist3(pos, otherEnd) * R.freeAirCost * 1.6, meta: { openingIds: straight.openingIds, freeAir: true } });
    }
    extra.set(nodeId, edges);
    // Make the attachment bidirectional for the search.
    for (const e of edges) {
      if (e.to === S || e.to === T) continue;
      if (!extra.has(e.to)) extra.set(e.to, []);
      extra.get(e.to).push({ to: nodeId, cost: e.cost, meta: e.meta });
    }
  };

  attach(S, from, fromSpaceId, to);
  attach(T, to, toSpaceId, from);

  const res = dijkstra(g, S, T, extra);
  g.nodes.delete(S); g.nodes.delete(T); g.adj.delete(S); g.adj.delete(T);

  if (!res) {
    warnings.push('NO_PATH: no legal physical route found — a direct run is shown. Add a pathway, cable penetration or shaft.');
    return { route: fallbackRoute(project, from, to), pathwayIds: [], openingIds: [], warnings, cost: Infinity, viaGraph: false };
  }

  const pts = res.path.map((id) => (id === S ? clone(from) : id === T ? clone(to) : clone(g.nodes.get(id).pos)));
  const pathwayIds = new Set();
  const openingIds = new Set();
  for (let i = 0; i < res.path.length; i++) {
    const n = g.nodes.get(res.path[i]);
    if (n && n.kind === 'pathway') {
      if (n.pathways) for (const pid of n.pathways) pathwayIds.add(pid);
      else if (n.ref) pathwayIds.add(n.ref);
    }
    if (n && n.kind === 'opening') openingIds.add(n.ref);
  }
  for (const m of res.metas) {
    if (m.pathwayId) pathwayIds.add(m.pathwayId);
    if (m.openingId) openingIds.add(m.openingId);
    if (m.openingIds) for (const o of m.openingIds) openingIds.add(o);
  }

  const route = simplifyPolyline(orthogonalise(pts), 0.02);
  return {
    route, pathwayIds: Array.from(pathwayIds), openingIds: Array.from(openingIds),
    warnings, cost: res.cost, viaGraph: true,
  };
}

function dropCost(a, b, R) {
  // Vertical drops/risers are cheap; horizontal free air is not.
  const dy = Math.abs(a.y - b.y);
  const horiz = Math.hypot(a.x - b.x, a.z - b.z);
  return dy * 0.9 + horiz * R.freeAirCost;
}

/**
 * Turn a graph path into cable-looking geometry: leave a device vertically,
 * travel horizontally, arrive vertically. Real installations look like this
 * and it makes lengths honest.
 */
function orthogonalise(pts) {
  if (pts.length < 2) return pts;
  const out = [clone(pts[0])];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    const dy = Math.abs(b.y - a.y);
    const horiz = Math.hypot(b.x - a.x, b.z - a.z);
    if (dy > 0.3 && horiz > 0.3) {
      // Rise first, then run — keeps cables out of the occupied volume.
      out.push({ x: a.x, y: b.y, z: a.z });
    }
    out.push(clone(b));
  }
  return out;
}

function fallbackRoute(project, from, to) {
  const y = Math.max(from.y, to.y) + 0.8;
  return [clone(from), { x: from.x, y, z: from.z }, { x: to.x, y, z: to.z }, clone(to)];
}

const clone = (p) => ({ x: p.x, y: p.y, z: p.z });

/** Physical length including per-type slack and termination service loops. */
export function cableLength(project, cable, route) {
  const pts = route || cable.route || [];
  const raw = polylineLength(pts);
  const type = project.cableTypes.find((t) => t.id === cable.typeId);
  const slack = cable.slack ?? type?.slack ?? project.settings.routing.defaultSlack ?? 1.08;
  const loops = (project.settings.routing.serviceLoop ?? 0) * 2;
  return raw * slack + loops;
}

export function rawRouteLength(route) { return polylineLength(route || []); }

/** Pathways a manually-drawn route happens to follow (within tolerance). */
export function detectPathwaysAlong(project, route, tol = 0.6) {
  const used = new Set();
  for (const pw of project.pathways) {
    const pts = pw.points || [];
    for (let i = 1; i < pts.length; i++) {
      for (const r of route) {
        const d = pointSegDist3(r, pts[i - 1], pts[i]);
        if (d < tol + (pw.width || 0.3) / 2) { used.add(pw.id); break; }
      }
      if (used.has(pw.id)) break;
    }
  }
  return Array.from(used);
}

function pointSegDist3(p, a, b) {
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
  const l2 = ax * ax + ay * ay + az * az;
  if (l2 < 1e-9) return dist3(p, a);
  let t = ((p.x - a.x) * ax + (p.y - a.y) * ay + (p.z - a.z) * az) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return dist3(p, { x: a.x + ax * t, y: a.y + ay * t, z: a.z + az * t });
}

/** Openings a manually-drawn route passes through. */
export function detectOpeningsAlong(project, rev, route) {
  const ids = new Set();
  for (let i = 1; i < route.length; i++) {
    const hit = segmentBlocked(project, rev, route[i - 1], route[i], { allowDoors: true });
    for (const o of hit.openingIds || []) ids.add(o);
  }
  return Array.from(ids);
}

/**
 * Does a route illegally cross building fabric?
 * A segment running inside installed containment is exempt — a cable in a
 * tray is compliant by definition, the tray's own sleeving is the record.
 */
export function validateRoute(project, rev, route) {
  const problems = [];
  for (let i = 1; i < route.length; i++) {
    if (segmentInContainment(project, route[i - 1], route[i])) continue;
    const hit = segmentBlocked(project, rev, route[i - 1], route[i], { allowDoors: true });
    if (hit.blocked) {
      problems.push({ segment: i, reason: hit.reason, wallId: hit.wallId, columnId: hit.columnId, slabId: hit.slabId });
    }
  }
  return problems;
}

function segmentInContainment(project, a, b, tol = 0.7) {
  for (const pw of project.pathways) {
    const pts = pw.points || [];
    const r = tol + (pw.width || 0.3) / 2;
    for (let i = 1; i < pts.length; i++) {
      if (pointSegDist3(a, pts[i - 1], pts[i]) <= r && pointSegDist3(b, pts[i - 1], pts[i]) <= r) return true;
    }
  }
  return false;
}
