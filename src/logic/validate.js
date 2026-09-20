/**
 * Port connection validation.
 *
 * A cable is directional: SOURCE port → CABLE → DESTINATION port.
 * The rules below are what make "HDMI OUT → Ethernet" an error while
 * "SDI OUT → SDI IN" and "SDI OUT → converter → HDMI IN" are valid chains.
 */
import { CONNECTORS, connectorFamily, familiesCompatible } from '../model/signals.js';
import { cablesOfPort, getCableType } from '../model/queries.js';

export const SEVERITY = { ERROR: 'error', WARNING: 'warning', OK: 'ok' };

/**
 * @param {object} project
 * @param {{device, port}} src
 * @param {{device, port}} dst
 * @param {string} cableTypeId
 * @returns {{ok:boolean, severity:string, errors:string[], warnings:string[]}}
 */
export function validateConnection(project, src, dst, cableTypeId, { ignoreCableId = null } = {}) {
  const errors = [];
  const warnings = [];

  if (!src?.port || !dst?.port) {
    return { ok: false, severity: SEVERITY.ERROR, errors: ['Both a source and a destination port are required.'], warnings };
  }
  if (src.port.id === dst.port.id) {
    return { ok: false, severity: SEVERITY.ERROR, errors: ['A port cannot be connected to itself.'], warnings };
  }

  /* ---- direction ---- */
  const sd = src.port.direction, dd = dst.port.direction;
  if (sd === 'in') {
    errors.push(`Source "${src.port.name}" is an INPUT. A cable runs source → destination; pick an OUT or bidirectional port.`);
  }
  if (dd === 'out') {
    errors.push(`Destination "${dst.port.name}" is an OUTPUT. Two outputs cannot be connected together.`);
  }

  /* ---- connector family ---- */
  const fa = connectorFamily(src.port.connector);
  const fb = connectorFamily(dst.port.connector);
  if (!familiesCompatible(fa, fb)) {
    const la = CONNECTORS[src.port.connector]?.label || src.port.connector;
    const lb = CONNECTORS[dst.port.connector]?.label || dst.port.connector;
    errors.push(`Invalid connection: ${la} cannot mate with ${lb}. Insert a converter between them.`);
  } else if (fa === 'custom' || fb === 'custom') {
    warnings.push('One end uses a custom/unknown connector — compatibility was not verified.');
  }

  /* ---- cable type ---- */
  const type = cableTypeId ? getCableType(project, cableTypeId) : null;
  if (type) {
    if (!familiesCompatible(type.family, fa) || !familiesCompatible(type.family, fb)) {
      errors.push(`Cable type "${type.name}" terminates in ${type.family.toUpperCase()} and does not fit these ports.`);
    }
    const sSig = src.port.signals || [];
    const dSig = dst.port.signals || [];
    if (sSig.length && !sSig.includes(type.signal)) {
      warnings.push(`Source port is not declared to carry ${type.signal}.`);
    }
    if (dSig.length && !dSig.includes(type.signal)) {
      warnings.push(`Destination port is not declared to carry ${type.signal}.`);
    }
  }

  /* ---- signal overlap ---- */
  const shared = (src.port.signals || []).filter((s) => (dst.port.signals || []).includes(s));
  if ((src.port.signals || []).length && (dst.port.signals || []).length && !shared.length) {
    warnings.push('These ports declare no signal class in common.');
  }

  /* ---- occupancy ---- */
  const srcUsed = cablesOfPort(project, src.port.id).filter((c) => c.id !== ignoreCableId && c.status !== 'removed');
  const dstUsed = cablesOfPort(project, dst.port.id).filter((c) => c.id !== ignoreCableId && c.status !== 'removed');
  if (src.port.exclusive !== false && srcUsed.length) {
    warnings.push(`Source port already carries ${srcUsed.length} cable(s) (${srcUsed.map((c) => c.id).join(', ')}).`);
  }
  if (dst.port.exclusive !== false && dstUsed.length) {
    warnings.push(`Destination port already carries ${dstUsed.length} cable(s) (${dstUsed.map((c) => c.id).join(', ')}).`);
  }

  /* ---- same device ---- */
  if (src.device && dst.device && src.device.id === dst.device.id) {
    warnings.push('Both ends are on the same device — check this is intentional (loop-through).');
  }

  /* ---- unverified spec ---- */
  if (src.device?.verifiedSpec === false || dst.device?.verifiedSpec === false) {
    warnings.push('One or both devices still use PLACEHOLDER port definitions — confirm the real hardware I/O.');
  }

  const severity = errors.length ? SEVERITY.ERROR : warnings.length ? SEVERITY.WARNING : SEVERITY.OK;
  return { ok: !errors.length, severity, errors, warnings };
}

/** Check a cable's declared length against the cable type's limit. */
export function validateLength(project, cable) {
  const type = getCableType(project, cable.typeId);
  if (!type?.maxLength) return null;
  if ((cable.length || 0) > type.maxLength) {
    return `${cable.length.toFixed(1)} m exceeds the ${type.maxLength} m practical limit for ${type.name}. Add an extender, repeater or fibre link.`;
  }
  return null;
}

/**
 * Whole-project audit, grouped the way an engineer reads a snag list.
 *
 * Returns categories of checks, each check either passing or carrying the
 * specific entities that failed it, so every line is clickable.
 */
export function auditProject(project) {
  const categories = [];
  const deviceIds = new Set(project.devices.map((d) => d.id));
  const cat = (id, label) => {
    const c = { id, label, checks: [] };
    categories.push(c);
    return {
      ok: (message) => c.checks.push({ level: 'ok', message, items: [] }),
      flag: (level, message, items) => {
        if (!items.length) return;
        c.checks.push({ level, message: message.replace('{n}', String(items.length)), items });
      },
    };
  };

  /* ---------------- architecture ---------------- */
  {
    const a = cat('architecture', 'Architecture');
    const noBoundary = project.spaces.filter((s) => !s.boundary?.length)
      .map((s) => ({ kind: 'space', id: s.id, label: s.name }));
    const zeroWalls = project.walls
      .filter((w) => Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z) < 0.05)
      .map((w) => ({ kind: 'wall', id: w.id, label: w.id }));
    const placeholderDims = [
      ...project.levels.filter((l) => l.placeholder).map((l) => ({ kind: 'level', id: l.id, label: l.name })),
      ...project.spaces.filter((s) => s.placeholder).map((s) => ({ kind: 'space', id: s.id, label: s.name })),
    ];
    const oversizeOpenings = project.openings.filter((o) => {
      const w = project.walls.find((x) => x.id === o.wallId);
      if (!w) return false;
      return o.width > Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z)
          || o.sill + o.height > w.height + 0.01;
    }).map((o) => ({ kind: 'opening', id: o.id, label: `${o.kind} ${o.id}` }));
    const orphanOpenings = project.openings
      .filter((o) => !project.walls.some((w) => w.id === o.wallId))
      .map((o) => ({ kind: 'opening', id: o.id, label: o.id }));

    if (!noBoundary.length) a.ok(`All ${project.spaces.length} rooms enclosed`);
    a.flag('warning', '{n} rooms have no boundary — run Detect rooms', noBoundary);
    if (!zeroWalls.length && project.walls.length) a.ok(`${project.walls.length} walls, none degenerate`);
    a.flag('error', '{n} walls have zero length', zeroWalls);
    a.flag('error', '{n} openings do not fit their wall', oversizeOpenings);
    a.flag('error', '{n} openings reference a deleted wall', orphanOpenings);
    a.flag('info', '{n} placeholder dimensions still to confirm', placeholderDims);
  }

  /* ---------------- equipment ---------------- */
  {
    const a = cat('equipment', 'Equipment');
    const unverified = project.devices.filter((d) => d.verifiedSpec === false)
      .map((d) => ({ kind: 'device', id: d.id, label: d.name }));
    const unplaced = project.devices.filter((d) => !d.spaceId)
      .map((d) => ({ kind: 'device', id: d.id, label: d.name }));
    const overfilled = [];
    for (const r of project.racks) {
      const used = project.devices.filter((d) => d.rackId === r.id);
      const top = used.reduce((m, d) => Math.max(m, (d.rackU || 0) + (d.rackUnits || 1) - 1), 0);
      if (top > r.rackUnits) overfilled.push({ kind: 'rack', id: r.id, label: `${r.name} (needs ${top}U of ${r.rackUnits}U)` });
      const seen = new Map();
      for (const d of used) {
        for (let u = d.rackU || 0; u < (d.rackU || 0) + (d.rackUnits || 1); u++) {
          if (seen.has(u)) overfilled.push({ kind: 'device', id: d.id, label: `${d.name} overlaps ${seen.get(u)} at U${u}` });
          seen.set(u, d.name);
        }
      }
    }
    a.ok(`${project.devices.length} devices in ${project.racks.length} rack(s)`);
    a.flag('warning', '{n} devices are outside every room', unplaced);
    a.flag('error', '{n} rack conflicts', overfilled);
    a.flag('info', '{n} devices still on PLACEHOLDER hardware specs', unverified);
  }

  /* ---------------- cables ---------------- */
  {
    const a = cat('cables', 'Cables');
    const broken = [];
    const noRoute = [];
    const collides = [];
    const tooLong = [];
    const invalidPairs = [];
    let valid = 0;

    for (const c of project.cables) {
      if (!c.from || !c.to || !deviceIds.has(c.from.deviceId) || !deviceIds.has(c.to.deviceId)) {
        broken.push({ kind: 'cable', id: c.id, label: `${c.id} — endpoint missing` });
        continue;
      }
      if (!c.route || c.route.length < 2) noRoute.push({ kind: 'cable', id: c.id, label: c.id });
      if ((c.warnings || []).length) collides.push({ kind: 'cable', id: c.id, label: `${c.id} — ${c.warnings[0]}` });
      const lenIssue = validateLength(project, c);
      if (lenIssue) tooLong.push({ kind: 'cable', id: c.id, label: `${c.id} — ${lenIssue}` });

      const src = project.devices.find((d) => d.id === c.from.deviceId);
      const dst = project.devices.find((d) => d.id === c.to.deviceId);
      const sp = src?.ports.find((x) => x.id === c.from.portId);
      const dp = dst?.ports.find((x) => x.id === c.to.portId);
      if (!sp || !dp) {
        broken.push({ kind: 'cable', id: c.id, label: `${c.id} — port missing` });
        continue;
      }
      const v = validateConnection(project, { device: src, port: sp }, { device: dst, port: dp }, c.typeId, { ignoreCableId: c.id });
      if (!v.ok) invalidPairs.push({ kind: 'cable', id: c.id, label: `${c.id} — ${v.errors[0]}` });
      else valid++;
    }

    a.ok(`${valid} valid connections`);
    a.flag('error', '{n} cables have a missing endpoint or port', broken);
    a.flag('error', '{n} cables are an invalid port pairing', invalidPairs);
    a.flag('warning', '{n} cables have no physical route', noRoute);
    a.flag('warning', '{n} cable routes pass through building fabric', collides);
    a.flag('warning', '{n} cables exceed the recommended length for their type', tooLong);
  }

  /* ---------------- pathways ---------------- */
  {
    const a = cat('pathways', 'Pathways');
    const over = [];
    const nearly = [];
    for (const pw of project.pathways) {
      const used = project.cables.filter((c) => (c.pathwayIds || []).includes(pw.id) && c.status !== 'removed');
      const ratio = pw.capacity ? used.length / pw.capacity : 0;
      const area = used.reduce((s, c) => {
        const t = project.cableTypes.find((x) => x.id === c.typeId);
        const dia = t?.diameter || 0.006;
        return s + Math.PI * (dia / 2) ** 2;
      }, 0);
      const fill = ((pw.width || 0.3) * (pw.height || 0.1)) ? area / ((pw.width || 0.3) * (pw.height || 0.1)) : 0;
      const worst = Math.max(ratio, fill);
      const label = `${pw.name} — ${used.length}/${pw.capacity} ways, ${(fill * 100).toFixed(0)}% fill`;
      if (worst > 1) over.push({ kind: 'pathway', id: pw.id, label });
      else if (worst > 0.8) nearly.push({ kind: 'pathway', id: pw.id, label });
    }
    a.ok(`${project.pathways.length} pathways`);
    a.flag('error', '{n} pathways are over capacity', over);
    a.flag('warning', '{n} pathways are above 80% utilisation', nearly);
  }

  /* ---------------- power ---------------- */
  {
    const a = cat('power', 'Power');
    const unpowered = project.devices.filter((d) => {
      const needsPower = d.ports.some((p) => p.direction !== 'out' && (p.signals || []).includes('power'));
      if (!needsPower) return false;
      return !project.cables.some((c) => c.signal === 'power' && c.to?.deviceId === d.id && c.status !== 'removed');
    }).map((d) => ({ kind: 'device', id: d.id, label: d.name }));
    const powered = project.devices.filter((d) => d.ports.some((p) => (p.signals || []).includes('power'))).length - unpowered.length;
    a.ok(`${Math.max(0, powered)} devices have a traced power source`);
    a.flag('warning', '{n} devices have a power input but no power cable', unpowered);
  }

  /* ---------------- network ---------------- */
  {
    const a = cat('network', 'Network');
    const ipMap = new Map();
    for (const d of project.devices) {
      const ip = (d.attributes?.ip || '').trim();
      if (!ip) continue;
      if (!ipMap.has(ip)) ipMap.set(ip, []);
      ipMap.get(ip).push(d);
    }
    const dupes = [];
    for (const [ip, list] of ipMap) {
      if (list.length > 1) for (const d of list) dupes.push({ kind: 'device', id: d.id, label: `${d.name} — duplicate IP ${ip}` });
    }
    const unpatched = project.devices.filter((d) => {
      const hasNet = d.ports.some((p) => (p.signals || []).includes('network'));
      if (!hasNet) return false;
      return !project.cables.some((c) => (c.signal === 'network')
        && (c.from?.deviceId === d.id || c.to?.deviceId === d.id) && c.status !== 'removed');
    }).map((d) => ({ kind: 'device', id: d.id, label: d.name }));
    const noIp = project.devices.filter((d) => d.ports.some((p) => (p.signals || []).includes('network')) && !(d.attributes?.ip || '').trim())
      .map((d) => ({ kind: 'device', id: d.id, label: d.name }));

    if (!dupes.length) a.ok('No duplicate IP addresses');
    a.flag('error', '{n} duplicate IP addresses', dupes);
    a.flag('warning', '{n} network devices are not patched to anything', unpatched);
    a.flag('info', '{n} network devices have no IP recorded', noIp);
  }

  const counts = { error: 0, warning: 0, info: 0, ok: 0 };
  for (const c of categories) for (const ch of c.checks) counts[ch.level] = (counts[ch.level] || 0) + 1;
  return { categories, counts };
}
