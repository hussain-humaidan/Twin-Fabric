/**
 * Signal / power / network path tracing.
 *
 * Traversal follows direction: out of a source port, along a cable, into a
 * destination port, then *through* the device according to its declared
 * internal continuity, and out again. That is what makes
 *   Kiloview ──SDI──▶ Blackmagic SDI→HDMI ──HDMI──▶ TV
 * a single traceable chain rather than three unrelated cables.
 */
import { getDevice, cablesOfDevice, cablesOfPort } from '../model/queries.js';

/** Ports a signal arriving at `port` can leave the device by. */
export function internalOutputs(device, port) {
  if (device.passthrough === 'none') return [];
  if (device.passthrough === 'declared') {
    const outs = [];
    for (const l of device.links || []) {
      if (l.from === port.id) {
        const p = device.ports.find((x) => x.id === l.to);
        if (p) outs.push(p);
      }
    }
    return outs;
  }
  // auto: any input feeds every output that shares a signal class
  return device.ports.filter(
    (p) => p.id !== port.id
      && (p.direction === 'out' || p.direction === 'bidir')
      && sharesSignal(p, port)
  );
}

/** Ports that could have fed `port` from inside the device. */
export function internalInputs(device, port) {
  if (device.passthrough === 'none') return [];
  if (device.passthrough === 'declared') {
    const ins = [];
    for (const l of device.links || []) {
      if (l.to === port.id) {
        const p = device.ports.find((x) => x.id === l.from);
        if (p) ins.push(p);
      }
    }
    return ins;
  }
  return device.ports.filter(
    (p) => p.id !== port.id
      && (p.direction === 'in' || p.direction === 'bidir')
      && sharesSignal(p, port)
  );
}

function sharesSignal(a, b) {
  const sa = a.signals || [], sb = b.signals || [];
  if (!sa.length || !sb.length) return true;
  return sa.some((s) => sb.includes(s));
}

const liveCable = (c) => c.status !== 'removed';

/**
 * Walk the signal graph from a device.
 * @param {'downstream'|'upstream'} direction
 * @returns {{root, nodes:Set<string>, cables:Set<string>, devices:Set<string>, depth:number}}
 */
export function trace(project, deviceId, {
  direction = 'downstream', maxDepth = 12, signals = null, startPortId = null,
} = {}) {
  const root = getDevice(project, deviceId);
  if (!root) return null;
  const cables = new Set();
  const devices = new Set([root.id]);

  const buildNode = (device, viaCable, viaPortIn, depth, visited) => {
    const node = { device, cable: viaCable, port: viaPortIn, children: [], depth };
    if (depth >= maxDepth) { node.truncated = true; return node; }

    const seedPorts = viaPortIn
      ? (direction === 'downstream' ? internalOutputs(device, viaPortIn) : internalInputs(device, viaPortIn))
      : device.ports.filter((p) => (direction === 'downstream'
        ? (p.direction === 'out' || p.direction === 'bidir')
        : (p.direction === 'in' || p.direction === 'bidir')));

    const filtered = startPortId && depth === 0
      ? seedPorts.filter((p) => p.id === startPortId)
      : seedPorts;

    for (const port of filtered) {
      for (const cable of cablesOfPort(project, port.id)) {
        if (!liveCable(cable)) continue;
        if (signals && !signals.includes(cable.signal)) continue;
        const nearEnd = direction === 'downstream' ? cable.from : cable.to;
        const farEnd = direction === 'downstream' ? cable.to : cable.from;
        if (!nearEnd || !farEnd) continue;
        // Only follow the cable in its declared direction.
        if (nearEnd.portId !== port.id) continue;
        const nextDevice = getDevice(project, farEnd.deviceId);
        if (!nextDevice) continue;
        const visitKey = `${cable.id}:${farEnd.portId}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);
        cables.add(cable.id);
        devices.add(nextDevice.id);
        const farPort = nextDevice.ports.find((p) => p.id === farEnd.portId) || null;
        node.children.push(buildNode(nextDevice, cable, farPort, depth + 1, visited));
      }
    }
    return node;
  };

  const rootNode = buildNode(root, null, null, 0, new Set());
  return { root: rootNode, cables, devices, direction };
}

/** Both directions at once — what the device detail panel shows. */
export function traceBoth(project, deviceId, opts = {}) {
  const down = trace(project, deviceId, { ...opts, direction: 'downstream' });
  const up = trace(project, deviceId, { ...opts, direction: 'upstream' });
  const cables = new Set([...(down?.cables || []), ...(up?.cables || [])]);
  const devices = new Set([...(down?.devices || []), ...(up?.devices || [])]);
  return { down, up, cables, devices };
}

/**
 * Find a concrete signal chain between two devices (TRACE PATH).
 * BFS over the directional signal graph; returns the shortest legal chain.
 */
export function findPath(project, srcDeviceId, dstDeviceId, { signals = null, maxDepth = 16 } = {}) {
  const src = getDevice(project, srcDeviceId);
  const dst = getDevice(project, dstDeviceId);
  if (!src || !dst) return null;

  // Queue entries: { deviceId, portId (arrival port, null at source), steps[] }
  const queue = [{ deviceId: src.id, portId: null, steps: [] }];
  const seen = new Set([`${src.id}:`]);

  while (queue.length) {
    const cur = queue.shift();
    if (cur.steps.length > maxDepth) continue;
    const device = getDevice(project, cur.deviceId);
    if (!device) continue;

    if (device.id === dst.id && cur.steps.length) {
      return {
        found: true,
        steps: cur.steps,
        cables: new Set(cur.steps.map((s) => s.cable.id)),
        devices: new Set([src.id, ...cur.steps.map((s) => s.toDevice.id)]),
      };
    }

    const arrival = cur.portId ? device.ports.find((p) => p.id === cur.portId) : null;
    const outs = arrival
      ? internalOutputs(device, arrival)
      : device.ports.filter((p) => p.direction === 'out' || p.direction === 'bidir');

    for (const port of outs) {
      for (const cable of cablesOfPort(project, port.id)) {
        if (!liveCable(cable)) continue;
        if (signals && !signals.includes(cable.signal)) continue;
        if (!cable.from || !cable.to) continue;
        if (cable.from.portId !== port.id) continue;
        const nextDevice = getDevice(project, cable.to.deviceId);
        if (!nextDevice) continue;
        const key = `${nextDevice.id}:${cable.to.portId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({
          deviceId: nextDevice.id,
          portId: cable.to.portId,
          steps: [...cur.steps, {
            fromDevice: device, fromPort: port, cable,
            toDevice: nextDevice, toPort: nextDevice.ports.find((p) => p.id === cable.to.portId) || null,
          }],
        });
      }
    }
  }
  return { found: false, steps: [], cables: new Set(), devices: new Set() };
}

/** Upstream power chain: device ← PDU ← UPS ← board. */
export function powerChain(project, deviceId) {
  return trace(project, deviceId, { direction: 'upstream', signals: ['power'], maxDepth: 10 });
}

/** Flatten a trace tree to a linear list of chain rows for the UI. */
export function flattenChain(node, out = [], depth = 0) {
  if (!node) return out;
  out.push({ device: node.device, cable: node.cable, port: node.port, depth });
  for (const c of node.children) flattenChain(c, out, depth + 1);
  return out;
}

/** Directly connected neighbours of a device (for highlighting). */
export function neighbours(project, deviceId) {
  const cables = cablesOfDevice(project, deviceId).filter(liveCable);
  const devices = new Set();
  for (const c of cables) {
    if (c.from) devices.add(c.from.deviceId);
    if (c.to) devices.add(c.to.deviceId);
  }
  devices.delete(deviceId);
  return { cables: new Set(cables.map((c) => c.id)), devices };
}

/* ------------------------------------------------------------------ */
/* topology views                                                      */
/* ------------------------------------------------------------------ */

const NET_ROOTS = ['router', 'fibre-switch', 'switch'];

/** Build a network tree rooted at routers, then switches. */
export function networkTopology(project) {
  const netCables = project.cables.filter((c) => (c.signal === 'network' || c.signal === 'kvm') && liveCable(c));
  const adj = new Map();
  const addEdge = (a, b, cable) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, cable });
  };
  for (const c of netCables) {
    if (!c.from || !c.to) continue;
    addEdge(c.from.deviceId, c.to.deviceId, c);
    addEdge(c.to.deviceId, c.from.deviceId, c);
  }

  const rank = (d) => {
    const i = NET_ROOTS.indexOf(d.typeId);
    return i === -1 ? NET_ROOTS.length : i;
  };
  const candidates = project.devices
    .filter((d) => adj.has(d.id))
    .sort((a, b) => rank(a) - rank(b) || (adj.get(b.id)?.length || 0) - (adj.get(a.id)?.length || 0));

  const visited = new Set();
  const roots = [];
  for (const rootDev of candidates) {
    if (visited.has(rootDev.id)) continue;
    const build = (id, cable, depth) => {
      visited.add(id);
      const device = getDevice(project, id);
      const node = { device, cable, children: [], depth };
      for (const e of adj.get(id) || []) {
        if (visited.has(e.to)) continue;
        node.children.push(build(e.to, e.cable, depth + 1));
      }
      return node;
    };
    roots.push(build(rootDev.id, null, 0));
  }
  const orphans = project.devices.filter((d) => !adj.has(d.id) && hasNetworkPort(d));
  return { roots, orphans };
}

function hasNetworkPort(d) {
  return d.ports.some((p) => (p.signals || []).includes('network'));
}

/** Power distribution tree rooted at boards / UPS. */
export function powerTopology(project) {
  const cables = project.cables.filter((c) => c.signal === 'power' && liveCable(c));
  const children = new Map();
  const hasParent = new Set();
  for (const c of cables) {
    if (!c.from || !c.to) continue;
    if (!children.has(c.from.deviceId)) children.set(c.from.deviceId, []);
    children.get(c.from.deviceId).push({ to: c.to.deviceId, cable: c });
    hasParent.add(c.to.deviceId);
  }
  const rootIds = Array.from(new Set([...children.keys()])).filter((id) => !hasParent.has(id));
  const visited = new Set();
  const build = (id, cable, depth) => {
    visited.add(id);
    const node = { device: getDevice(project, id), cable, children: [], depth };
    for (const e of children.get(id) || []) {
      if (visited.has(e.to)) continue;
      node.children.push(build(e.to, e.cable, depth + 1));
    }
    return node;
  };
  return { roots: rootIds.map((id) => build(id, null, 0)) };
}
