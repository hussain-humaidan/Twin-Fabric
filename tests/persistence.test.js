import { describe, it, expect } from 'vitest';
import { toContainer, fromContainer, sniff, summarise, CONTAINER_KIND } from '../src/persist/format.js';
import { migrate, cableScheduleCSV, equipmentScheduleCSV, roomScheduleCSV, portScheduleCSV, exportFilename } from '../src/persist/io.js';
import { SCHEMA_VERSION } from '../src/model/schema.js';
import { invalidateIndex } from '../src/model/queries.js';
import { chainProject, twoRoomProject } from './helpers.js';

describe('.twinfabric container', () => {
  it('wraps a document with a readable header', () => {
    const { project } = chainProject();
    const c = toContainer(project);
    expect(c.kind).toBe(CONTAINER_KIND);
    expect(c.formatVersion).toBe(1);
    expect(c.schema.version).toBe(SCHEMA_VERSION);
    expect(c.application.name).toBe('Twinfabric');
    expect(c.meta.name).toBe(project.name);
    expect(c.meta.building).toBe(project.building.name);
    expect(c.meta.counts.devices).toBe(3);
    expect(c.meta.counts.cables).toBe(2);
    expect(c.document).toBe(project);
  });

  it('round-trips without losing entities', () => {
    const { project } = chainProject();
    const text = JSON.stringify(toContainer(project));
    const res = fromContainer(JSON.parse(text));
    expect(res.ok).toBe(true);
    expect(res.project.walls).toHaveLength(project.walls.length);
    expect(res.project.devices).toHaveLength(3);
    expect(res.project.cables).toHaveLength(2);
    expect(res.project.cables[0].from.portId).toBe(project.cables[0].from.portId);
  });

  it('still opens a bare pre-container document', () => {
    const { project } = twoRoomProject();
    const res = fromContainer(JSON.parse(JSON.stringify(project)));
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/bare project document/);
  });

  it('refuses something that is not a project', () => {
    expect(fromContainer({ hello: 'world' }).ok).toBe(false);
    expect(fromContainer(null).ok).toBe(false);
  });

  it('warns when the container is from a newer format', () => {
    const { project } = twoRoomProject();
    const c = toContainer(project);
    c.formatVersion = 99;
    const res = fromContainer(c);
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/newer/);
  });

  it('sniffs both shapes cheaply', () => {
    const { project } = twoRoomProject();
    expect(sniff(JSON.stringify(toContainer(project)))).toBe(true);
    expect(sniff(JSON.stringify(project))).toBe(true);
    expect(sniff('{"something":"else"}')).toBe(false);
  });

  it('summarises counts and total cable length', () => {
    const { project } = chainProject();
    const s = summarise(project);
    expect(s.devices).toBe(3);
    expect(s.cables).toBe(2);
    expect(typeof s.cableLength).toBe('number');
  });

  it('suggests a filesystem-safe filename', () => {
    expect(exportFilename({ name: 'Mall Infrastructure Project' }))
      .toBe('mall-infrastructure-project.twinfabric.json');
    expect(exportFilename({ name: '' })).toBe('project.twinfabric.json');
  });
});

describe('schema migration', () => {
  it('fills in collections a hand-edited document is missing', () => {
    const doc = { schemaVersion: 1, name: 'Old', levels: [], walls: [] };
    const p = migrate(doc);
    for (const key of ['slabs', 'openings', 'stairs', 'columns', 'spaces', 'pathways', 'racks', 'devices', 'cables', 'scenarios', 'cableTypes', 'materials']) {
      expect(Array.isArray(p[key])).toBe(true);
    }
    expect(p.settings.routing).toBeTruthy();
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('repairs cables written before route metadata existed', () => {
    const doc = {
      schemaVersion: 1, name: 'Old', levels: [], walls: [],
      cables: [{ id: 'CABLE-1', typeId: 'CT-SDI' }],
      devices: [{ id: 'D1', name: 'D1' }],
    };
    const p = migrate(doc);
    const c = p.cables[0];
    expect(c.route).toEqual([]);
    expect(c.pathwayIds).toEqual([]);
    expect(c.openingIds).toEqual([]);
    expect(c.warnings).toEqual([]);
    const d = p.devices[0];
    expect(d.ports).toEqual([]);
    expect(d.links).toEqual([]);
    expect(d.passthrough).toBe('auto');
  });

  it('defaults opening passability sensibly by kind', () => {
    const doc = {
      schemaVersion: 1, name: 'Old', levels: [], walls: [],
      openings: [{ id: 'O1', kind: 'door' }, { id: 'O2', kind: 'window' }],
    };
    const p = migrate(doc);
    expect(p.openings[0].cablePassable).toBe(true);
    expect(p.openings[0].peoplePassable).toBe(true);
    expect(p.openings[1].cablePassable).toBe(false);
    expect(p.openings[1].peoplePassable).toBe(false);
  });

  it('re-seeds id counters from the entities actually present', () => {
    const doc = {
      schemaVersion: 1, name: 'Old', levels: [], walls: [{ id: 'WALL-042' }],
    };
    const p = migrate(doc);
    expect(p.idCounters.WALL).toBeGreaterThanOrEqual(42);
  });
});

describe('CSV schedules', () => {
  it('writes a cable schedule with one header row and one row per cable', () => {
    const { project } = chainProject();
    invalidateIndex();
    const rows = cableScheduleCSV(project).split('\r\n');
    expect(rows).toHaveLength(3);                       // header + 2 cables
    expect(rows[0]).toMatch(/^Cable ID,Label,Type/);
    expect(rows[1]).toMatch(/CABLE-SDI-001/);
  });

  it('quotes fields that contain commas', () => {
    const { project } = chainProject();
    project.cables[0].notes = 'Rack room, corridor, riser';
    invalidateIndex();
    expect(cableScheduleCSV(project)).toContain('"Rack room, corridor, riser"');
  });

  it('marks unverified specs in the equipment schedule', () => {
    const { project } = chainProject();
    project.devices[0].verifiedSpec = false;
    invalidateIndex();
    expect(equipmentScheduleCSV(project)).toMatch(/PLACEHOLDER/);
  });

  it('writes one row per port', () => {
    const { project } = chainProject();
    invalidateIndex();
    const rows = portScheduleCSV(project).split('\r\n');
    const totalPorts = project.devices.reduce((s, d) => s + d.ports.length, 0);
    expect(rows).toHaveLength(totalPorts + 1);
  });

  it('reports room areas', () => {
    const { project } = chainProject();
    invalidateIndex();
    const csv = roomScheduleCSV(project);
    expect(csv).toMatch(/Room A/);
    expect(csv).toMatch(/60\.0/);                       // the 10 x 6 test room
  });
});
