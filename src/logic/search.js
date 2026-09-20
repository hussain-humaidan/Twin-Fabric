/**
 * Global search across every entity in the twin.
 * "TV-H1-01" finds a device, "SDI" lists every SDI cable,
 * "Hall 3" focuses the space, "Kiloview" lists all Kiloview units.
 */
import { fuzzyScore } from '../core/util.js';
import { getLevel, getSpace, getCableType, getDevice } from '../model/queries.js';

const KIND_ICON = {
  device: '▢', cable: '∿', space: '▣', level: '▤', rack: '▥',
  pathway: '═', wall: '│', opening: '⌷', stair: '⌆', column: '▪', cableType: '◈',
};

export function buildSearchIndex(project) {
  const records = [];

  for (const l of project.levels) {
    records.push({ kind: 'level', id: l.id, title: l.name, sub: `Level ${l.index} · ${l.elevation.toFixed(2)} m`, terms: [l.name, l.shortName, l.id, 'floor', 'level'] });
  }

  for (const s of project.spaces) {
    const lvl = getLevel(project, s.levelId);
    records.push({
      kind: 'space', id: s.id, title: s.name,
      sub: `${s.code || s.kind} · ${lvl?.name || ''}`,
      terms: [s.name, s.code, s.id, s.kind, s.group, lvl?.name],
    });
  }

  for (const d of project.devices) {
    const s = d.spaceId ? getSpace(project, d.spaceId) : null;
    records.push({
      kind: 'device', id: d.id, title: d.name,
      sub: `${d.id} · ${s?.name || 'unplaced'}${d.rackId ? ` · ${d.rackId}` : ''}`,
      terms: [d.name, d.id, d.model, d.manufacturer, d.typeId, d.category, s?.name, s?.code,
        d.attributes?.hostname, d.attributes?.ip, d.attributes?.mac, ...(d.tags || [])],
    });
  }

  for (const c of project.cables) {
    const t = getCableType(project, c.typeId);
    const a = c.from ? getDevice(project, c.from.deviceId) : null;
    const b = c.to ? getDevice(project, c.to.deviceId) : null;
    records.push({
      kind: 'cable', id: c.id, title: c.name || c.id,
      sub: `${t?.name || c.typeId} · ${a?.name || '?'} → ${b?.name || '?'}`,
      terms: [c.id, c.name, c.label, t?.name, t?.id, c.signal, c.status, a?.name, b?.name, a?.id, b?.id],
    });
  }

  for (const r of project.racks) {
    const s = r.spaceId ? getSpace(project, r.spaceId) : null;
    records.push({ kind: 'rack', id: r.id, title: r.name, sub: `${r.id} · ${s?.name || ''} · ${r.rackUnits}U`, terms: [r.name, r.id, s?.name] });
  }

  for (const p of project.pathways) {
    records.push({ kind: 'pathway', id: p.id, title: p.name, sub: `${p.kind} · ${p.id}`, terms: [p.name, p.id, p.kind, 'tray', 'conduit', 'shaft'] });
  }

  for (const t of project.cableTypes) {
    records.push({ kind: 'cableType', id: t.id, title: t.name, sub: `${t.signal} · filter all ${t.name} cables`, terms: [t.name, t.id, t.signal, t.category, t.family] });
  }

  for (const o of project.openings) {
    records.push({ kind: 'opening', id: o.id, title: o.name || `${o.kind} ${o.id}`, sub: `${o.kind} · ${o.id}`, terms: [o.id, o.name, o.kind] });
  }

  for (const w of project.walls) {
    if (!w.name) continue;
    records.push({ kind: 'wall', id: w.id, title: w.name, sub: w.id, terms: [w.name, w.id] });
  }

  return records;
}

export function search(records, query, { limit = 60, kinds = null } = {}) {
  const q = query.trim();
  if (!q) return [];
  const out = [];
  for (const r of records) {
    if (kinds && !kinds.includes(r.kind)) continue;
    let best = -1;
    for (const term of r.terms) {
      if (!term) continue;
      const s = fuzzyScore(q, term);
      if (s > best) best = s;
    }
    if (best > 0) out.push({ ...r, score: best, icon: KIND_ICON[r.kind] || '·' });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return out.slice(0, limit);
}

/** Filter helpers used by the inventory views. */
export function filterCables(project, {
  text = '', typeIds = null, signals = null, statuses = null,
  levelId = null, spaceId = null, deviceId = null, scenarioId = null,
} = {}) {
  const t = text.trim().toLowerCase();
  return project.cables.filter((c) => {
    if (typeIds && !typeIds.includes(c.typeId)) return false;
    if (signals && !signals.includes(c.signal)) return false;
    if (statuses && !statuses.includes(c.status)) return false;
    if (scenarioId && c.scenarioId !== scenarioId) return false;
    if (deviceId && c.from?.deviceId !== deviceId && c.to?.deviceId !== deviceId) return false;
    if (spaceId) {
      const a = c.from ? getDevice(project, c.from.deviceId) : null;
      const b = c.to ? getDevice(project, c.to.deviceId) : null;
      if (a?.spaceId !== spaceId && b?.spaceId !== spaceId) return false;
    }
    if (levelId) {
      const a = c.from ? getDevice(project, c.from.deviceId) : null;
      const b = c.to ? getDevice(project, c.to.deviceId) : null;
      if (a?.levelId !== levelId && b?.levelId !== levelId) return false;
    }
    if (t) {
      const a = c.from ? getDevice(project, c.from.deviceId) : null;
      const b = c.to ? getDevice(project, c.to.deviceId) : null;
      const hay = `${c.id} ${c.name} ${c.label} ${c.typeId} ${c.signal} ${c.status} ${a?.name || ''} ${b?.name || ''}`.toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
}

export function filterDevices(project, {
  text = '', categories = null, typeIds = null, statuses = null,
  levelId = null, spaceId = null, rackId = null, scenarioId = null,
} = {}) {
  const t = text.trim().toLowerCase();
  return project.devices.filter((d) => {
    if (categories && !categories.includes(d.category)) return false;
    if (typeIds && !typeIds.includes(d.typeId)) return false;
    if (statuses && !statuses.includes(d.status)) return false;
    if (levelId && d.levelId !== levelId) return false;
    if (spaceId && d.spaceId !== spaceId) return false;
    if (rackId && d.rackId !== rackId) return false;
    if (scenarioId && d.scenarioId !== scenarioId) return false;
    if (t) {
      const hay = `${d.id} ${d.name} ${d.model} ${d.manufacturer} ${d.category} ${d.typeId} ${d.attributes?.ip || ''} ${d.attributes?.hostname || ''}`.toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
}
