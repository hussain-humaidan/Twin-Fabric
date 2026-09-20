import { describe, it, expect } from 'vitest';
import { validateConnection, validateLength, auditProject } from '../src/logic/validate.js';
import { trace, traceBoth, findPath, internalOutputs, networkTopology, powerTopology } from '../src/logic/trace.js';
import { familiesCompatible, connectorFamily, suggestCableType } from '../src/model/signals.js';
import { invalidateIndex } from '../src/model/queries.js';
import { chainProject, twoRoomProject } from './helpers.js';

const port = (over = {}) => ({
  id: 'P1', name: 'Port', connector: 'HDMI', direction: 'out',
  signals: ['video'], exclusive: true, verified: true, ...over,
});
const dev = (id, ports) => ({ id, name: id, verifiedSpec: true, ports, passthrough: 'auto', links: [] });

describe('connector compatibility', () => {
  it('matches by family, not by exact connector', () => {
    expect(familiesCompatible(connectorFamily('HDMI'), connectorFamily('MINIHDMI'))).toBe(true);
    expect(familiesCompatible(connectorFamily('XLR3M'), connectorFamily('XLR3F'))).toBe(true);
    expect(familiesCompatible(connectorFamily('HDMI'), connectorFamily('RJ45'))).toBe(false);
  });

  it('bridges the pairs that genuinely mate', () => {
    expect(familiesCompatible('fibre-lc', 'sfp')).toBe(true);
    expect(familiesCompatible('iec', 'mains')).toBe(true);
  });

  it('treats a custom connector as unknown rather than incompatible', () => {
    expect(familiesCompatible('custom', 'rj45')).toBe(true);
  });
});

describe('connection validation', () => {
  it('accepts SDI OUT into SDI IN', () => {
    const { project } = twoRoomProject();
    const src = { device: dev('A', []), port: port({ connector: 'BNC', direction: 'out' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', connector: 'BNC', direction: 'in' }) };
    const v = validateConnection(project, src, dst, 'CT-SDI');
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('rejects HDMI OUT into an Ethernet port', () => {
    const { project } = twoRoomProject();
    const src = { device: dev('A', []), port: port({ connector: 'HDMI', direction: 'out' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', connector: 'RJ45', direction: 'in', signals: ['network'] }) };
    const v = validateConnection(project, src, dst, 'CT-HDMI');
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/cannot mate/i);
  });

  it('rejects an input used as a source', () => {
    const { project } = twoRoomProject();
    const src = { device: dev('A', []), port: port({ direction: 'in' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', direction: 'in' }) };
    const v = validateConnection(project, src, dst, 'CT-HDMI');
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/INPUT/);
  });

  it('rejects two outputs wired together', () => {
    const { project } = twoRoomProject();
    const src = { device: dev('A', []), port: port({ direction: 'out' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', direction: 'out' }) };
    const v = validateConnection(project, src, dst, 'CT-HDMI');
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/OUTPUT/);
  });

  it('rejects a cable type that does not fit the ports', () => {
    const { project } = twoRoomProject();
    const src = { device: dev('A', []), port: port({ connector: 'BNC', direction: 'out' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', connector: 'BNC', direction: 'in' }) };
    const v = validateConnection(project, src, dst, 'CT-ETH');
    expect(v.ok).toBe(false);
  });

  it('allows bidirectional ports in either role', () => {
    const { project } = twoRoomProject();
    const a = { device: dev('A', []), port: port({ connector: 'RJ45', direction: 'bidir', signals: ['network'] }) };
    const b = { device: dev('B', []), port: port({ id: 'P2', connector: 'RJ45', direction: 'bidir', signals: ['network'] }) };
    expect(validateConnection(project, a, b, 'CT-ETH').ok).toBe(true);
  });

  it('warns rather than errors when a port is already occupied', () => {
    const { project, source, conv } = chainProject();
    invalidateIndex();
    const v = validateConnection(project,
      { device: source, port: source.ports[0] },
      { device: conv, port: conv.ports[0] },
      'CT-SDI');
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/already carries/);
  });

  it('warns about placeholder hardware specs', () => {
    const { project } = twoRoomProject();
    const src = { device: { ...dev('A', []), verifiedSpec: false }, port: port({ connector: 'BNC', direction: 'out' }) };
    const dst = { device: dev('B', []), port: port({ id: 'P2', connector: 'BNC', direction: 'in' }) };
    const v = validateConnection(project, src, dst, 'CT-SDI');
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/PLACEHOLDER/);
  });

  it('flags a run past the practical limit for its type', () => {
    const { project } = twoRoomProject();
    // HDMI has a 15 m soft limit
    expect(validateLength(project, { typeId: 'CT-HDMI', length: 40 })).toMatch(/exceeds/);
    expect(validateLength(project, { typeId: 'CT-HDMI', length: 5 })).toBeNull();
    // coax has no limit
    expect(validateLength(project, { typeId: 'CT-COAX', length: 400 })).toBeNull();
  });

  it('suggests a cable type that fits both ends', () => {
    const { project } = twoRoomProject();
    const a = port({ connector: 'BNC', direction: 'out', signals: ['video'] });
    const b = port({ id: 'P2', connector: 'BNC', direction: 'in', signals: ['video'] });
    expect(suggestCableType(project, a, b).family).toBe('bnc');
  });
});

describe('signal continuity through devices', () => {
  it('follows a declared converter mapping', () => {
    const { conv } = chainProject();
    const outs = internalOutputs(conv, conv.ports[0]);
    expect(outs.map((p) => p.name)).toEqual(['HDMI OUT']);
  });

  it('stops dead at a device declared as an endpoint', () => {
    const { conv } = chainProject();
    conv.passthrough = 'none';
    expect(internalOutputs(conv, conv.ports[0])).toHaveLength(0);
  });

  it('feeds every matching output when continuity is automatic', () => {
    const d = dev('X', [
      port({ id: 'in1', direction: 'in', signals: ['video'] }),
      port({ id: 'o1', direction: 'out', signals: ['video'] }),
      port({ id: 'o2', direction: 'out', signals: ['video'] }),
      port({ id: 'o3', direction: 'out', signals: ['power'] }),
    ]);
    const outs = internalOutputs(d, d.ports[0]);
    expect(outs.map((p) => p.id).sort()).toEqual(['o1', 'o2']);
  });
});

describe('path tracing', () => {
  it('traces source to display across a converter', () => {
    const { project, source, sink } = chainProject();
    invalidateIndex();
    const res = findPath(project, source.id, sink.id);
    expect(res.found).toBe(true);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].cable.id).toBe('CABLE-SDI-001');
    expect(res.steps[1].cable.id).toBe('CABLE-HDMI-001');
    expect(res.cables.size).toBe(2);
  });

  it('will not trace backwards against cable direction', () => {
    const { project, source, sink } = chainProject();
    invalidateIndex();
    expect(findPath(project, sink.id, source.id).found).toBe(false);
  });

  it('collects the whole chain downstream of the source', () => {
    const { project, source } = chainProject();
    invalidateIndex();
    const t = trace(project, source.id, { direction: 'downstream' });
    expect(t.devices.has('CONV-001')).toBe(true);
    expect(t.devices.has('TV-001')).toBe(true);
    expect(t.cables.size).toBe(2);
  });

  it('collects the whole chain upstream of the display', () => {
    const { project, sink } = chainProject();
    invalidateIndex();
    const t = trace(project, sink.id, { direction: 'upstream' });
    expect(t.devices.has('SRC-001')).toBe(true);
  });

  it('reports both directions at once', () => {
    const { project, conv } = chainProject();
    invalidateIndex();
    const both = traceBoth(project, conv.id);
    expect(both.devices.has('SRC-001')).toBe(true);
    expect(both.devices.has('TV-001')).toBe(true);
  });

  it('ignores removed cables', () => {
    const { project, source, sdi } = chainProject();
    sdi.status = 'removed';
    invalidateIndex();
    const t = trace(project, source.id, { direction: 'downstream' });
    expect(t.cables.size).toBe(0);
  });

  it('does not loop forever on a cycle', () => {
    const { project, source, sink, ids: f } = chainProject();
    void f;
    // wire the display's network port back toward the source
    project.cables.push({
      id: 'CABLE-LOOP', typeId: 'CT-ETH', signal: 'network',
      from: { deviceId: sink.id, portId: sink.ports[1].id },
      to: { deviceId: source.id, portId: source.ports[1].id },
      route: [], routeMode: 'auto', pathwayIds: [], openingIds: [],
      length: 1, slack: null, status: 'installed', scenarioId: 'SCENARIO-PERMANENT',
      color: null, label: '', installDate: '', warnings: [], notes: '', name: '',
    });
    invalidateIndex();
    const t = trace(project, source.id, { direction: 'downstream', maxDepth: 20 });
    expect(t).not.toBeNull();
  });
});

describe('topology', () => {
  it('builds a power tree rooted at the supply', () => {
    const { project } = chainProject();
    invalidateIndex();
    const tree = powerTopology(project);
    expect(Array.isArray(tree.roots)).toBe(true);
  });

  it('lists network devices that are not patched', () => {
    const { project } = chainProject();
    invalidateIndex();
    const topo = networkTopology(project);
    expect(topo.orphans.some((d) => d.id === 'TV-001')).toBe(true);
  });
});

describe('project audit', () => {
  it('reports categories with counts', () => {
    const { project } = chainProject();
    invalidateIndex();
    const report = auditProject(project);
    const ids = report.categories.map((c) => c.id);
    expect(ids).toEqual(['architecture', 'equipment', 'cables', 'pathways', 'power', 'network']);
    expect(typeof report.counts.ok).toBe('number');
  });

  it('counts a valid chain as valid connections', () => {
    const { project } = chainProject();
    invalidateIndex();
    const cables = auditProject(project).categories.find((c) => c.id === 'cables');
    expect(cables.checks.some((c) => c.level === 'ok' && /2 valid connections/.test(c.message))).toBe(true);
  });

  it('catches an invalid pairing', () => {
    const { project, hdmi, sink } = chainProject();
    // point the HDMI cable at the display's Ethernet port
    hdmi.to = { deviceId: sink.id, portId: sink.ports[1].id };
    invalidateIndex();
    const cables = auditProject(project).categories.find((c) => c.id === 'cables');
    expect(cables.checks.some((c) => c.level === 'error' && /invalid port pairing/.test(c.message))).toBe(true);
  });

  it('catches duplicate IP addresses', () => {
    const { project, source, sink } = chainProject();
    source.attributes.ip = '10.0.0.5';
    sink.attributes.ip = '10.0.0.5';
    invalidateIndex();
    const net = auditProject(project).categories.find((c) => c.id === 'network');
    expect(net.checks.some((c) => c.level === 'error' && /duplicate IP/.test(c.message))).toBe(true);
  });

  it('catches an over-capacity pathway', () => {
    const { project } = chainProject();
    project.pathways.push({
      id: 'PATH-TINY', name: 'Tiny tray', kind: 'tray', levelId: 'LEVEL-01',
      points: [{ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }],
      width: 0.05, height: 0.02, capacity: 1, costFactor: null,
      status: 'installed', locked: false, notes: '', placeholder: false,
    });
    for (const c of project.cables) c.pathwayIds = ['PATH-TINY'];
    invalidateIndex();
    const pw = auditProject(project).categories.find((c) => c.id === 'pathways');
    expect(pw.checks.some((c) => c.level === 'error' && /over capacity/.test(c.message))).toBe(true);
  });
});
