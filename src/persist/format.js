/**
 * The .twinfabric project container.
 *
 * A saved project is a JSON container with a readable header and the document
 * underneath, so a tool (or a human, or a project browser) can learn what a
 * file is without parsing tens of thousands of entities:
 *
 *   {
 *     kind: "twinfabric.project",
 *     formatVersion: 1,
 *     application: { name, version },     what wrote it
 *     schema:      { version },           what shape the document is in
 *     meta:        { name, building, counts, ... },   the header
 *     document:    { levels, walls, devices, cables, ... }
 *   }
 *
 * Bare documents from before the container existed still load — `fromContainer`
 * accepts either shape, which is what makes the format safe to evolve.
 */
import { PRODUCT } from '../app.config.js';
import { SCHEMA_VERSION } from '../model/schema.js';

export const CONTAINER_KIND = 'twinfabric.project';
export const FORMAT_VERSION = 1;

/** Cheap, readable summary so a file can be identified without a full parse. */
export function summarise(project) {
  return {
    levels: project.levels?.length || 0,
    spaces: project.spaces?.length || 0,
    walls: project.walls?.length || 0,
    openings: project.openings?.length || 0,
    devices: project.devices?.length || 0,
    cables: project.cables?.length || 0,
    pathways: project.pathways?.length || 0,
    racks: project.racks?.length || 0,
    cableLength: +(project.cables || []).reduce((s, c) => s + (c.length || 0), 0).toFixed(2),
  };
}

export function toContainer(project) {
  return {
    kind: CONTAINER_KIND,
    formatVersion: FORMAT_VERSION,
    application: { name: PRODUCT.name, version: PRODUCT.version },
    schema: { version: SCHEMA_VERSION },
    meta: {
      id: project.id,
      name: project.name,
      building: project.building?.name || '',
      buildingType: project.buildingType,
      client: project.client || '',
      reference: project.reference || '',
      createdAt: project.createdAt,
      modifiedAt: project.modifiedAt,
      projectVersion: project.projectVersion || 1,
      units: project.units,
      coordinateSystem: project.coordinateSystem,
      counts: summarise(project),
    },
    document: project,
  };
}

/**
 * Accepts a container, or a bare project document from an older export.
 * @returns {{ok:boolean, project?:object, error?:string, warnings:string[], header?:object}}
 */
export function fromContainer(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Empty or unreadable document.', warnings };
  }

  // Container form.
  if (raw.kind === CONTAINER_KIND) {
    if (raw.formatVersion > FORMAT_VERSION) {
      warnings.push(`Container format v${raw.formatVersion} is newer than this build understands (v${FORMAT_VERSION}). Some fields may be ignored.`);
    }
    if (!raw.document) return { ok: false, error: 'Container has no document.', warnings };
    if (raw.application?.name && raw.application.name !== PRODUCT.name) {
      warnings.push(`Written by ${raw.application.name} ${raw.application.version || ''}.`.trim());
    }
    return { ok: true, project: raw.document, warnings, header: raw.meta || null };
  }

  // Bare document (pre-container export, or a hand-edited file).
  if (Array.isArray(raw.levels)) {
    warnings.push('Loaded a bare project document; it will be saved in the container format from now on.');
    return { ok: true, project: raw, warnings, header: null };
  }

  return { ok: false, error: 'Not a Twinfabric project: no container header and no "levels" array.', warnings };
}

/** True when this text looks like something we can open, without parsing it all. */
export function sniff(text) {
  const head = String(text || '').slice(0, 400);
  return head.includes(CONTAINER_KIND) || /"levels"\s*:/.test(head);
}
