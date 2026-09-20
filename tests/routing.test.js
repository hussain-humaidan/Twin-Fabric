import { describe, it, expect, beforeEach } from 'vitest';
import {
  routeBetween, cableLength, rawRouteLength, validateRoute,
  detectPathwaysAlong, invalidateRouteGraph,
} from '../src/logic/router.js';
import { twoRoomProject, addTray } from './helpers.js';

let rev = 1000;
const next = () => ++rev;

beforeEach(() => invalidateRouteGraph());

describe('physically-aware routing', () => {
  it('runs straight when the two ends are close and nothing is in the way', () => {
    const { project } = twoRoomProject();
    const res = routeBetween(project, next(),
      { x: 2, y: 1, z: 2 }, { x: 4, y: 1, z: 3 });
    expect(res.route).toHaveLength(2);
    expect(res.warnings).toHaveLength(0);
  });

  it('never returns a route that passes through solid fabric', () => {
    const { project } = twoRoomProject();
    const res = routeBetween(project, next(),
      { x: 1, y: 1, z: 2 }, { x: 1, y: 1, z: 10 },
      { fromSpaceId: 'ROOM-A', toSpaceId: 'ROOM-B' });
    expect(res.route.length).toBeGreaterThanOrEqual(2);
    if (res.warnings.length === 0) {
      // a real route was found, so every segment must be legal
      expect(validateRoute(project, next(), res.route)).toHaveLength(0);
    }
  });

  it('crosses between rooms through an opening and records which one', () => {
    const { project } = twoRoomProject();
    const res = routeBetween(project, next(),
      { x: 1, y: 1, z: 2 }, { x: 9, y: 1, z: 10 },
      { fromSpaceId: 'ROOM-A', toSpaceId: 'ROOM-B' });
    if (res.viaGraph) {
      expect(res.openingIds.length).toBeGreaterThan(0);
    }
  });

  it('prefers containment over free air', () => {
    const { project, ids: f } = twoRoomProject();
    const tray = addTray(project, f);
    const res = routeBetween(project, next(),
      { x: 7, y: 1, z: 2 }, { x: 7, y: 1, z: 10 },
      { fromSpaceId: 'ROOM-A', toSpaceId: 'ROOM-B' });
    expect(res.pathwayIds).toContain(tray.id);
  });

  it('reports when no legal path exists instead of quietly cheating', () => {
    const { project } = twoRoomProject();
    // seal the only two ways through the partition
    for (const o of project.openings) o.cablePassable = false;
    project.settings.routing.allowFreeAir = false;
    const res = routeBetween(project, next(),
      { x: 1, y: 1, z: 2 }, { x: 1, y: 1, z: 10 },
      { fromSpaceId: 'ROOM-A', toSpaceId: 'ROOM-B' });
    expect(res.warnings.join(' ')).toMatch(/NO_PATH/);
    // a route is still returned so the cable is visible and fixable
    expect(res.route.length).toBeGreaterThanOrEqual(2);
  });
});

describe('cable length', () => {
  const route = [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
    { x: 3, y: 4, z: 0 },
  ];

  it('measures the physical polyline', () => {
    expect(rawRouteLength(route)).toBeCloseTo(7);
  });

  it('applies the cable type slack and the service loops', () => {
    const { project } = twoRoomProject();
    project.settings.routing.serviceLoop = 0.5;
    const sdi = project.cableTypes.find((t) => t.id === 'CT-SDI');
    const len = cableLength(project, { typeId: 'CT-SDI', slack: null }, route);
    // 7 * slack + 2 service loops
    expect(len).toBeCloseTo(7 * sdi.slack + 1.0);
  });

  it('lets a cable override the slack factor', () => {
    const { project } = twoRoomProject();
    project.settings.routing.serviceLoop = 0;
    const len = cableLength(project, { typeId: 'CT-SDI', slack: 2 }, route);
    expect(len).toBeCloseTo(14);
  });

  it('returns zero for a route with no geometry', () => {
    const { project } = twoRoomProject();
    project.settings.routing.serviceLoop = 0;
    expect(cableLength(project, { typeId: 'CT-SDI', slack: 1 }, [])).toBeCloseTo(0);
  });
});

describe('route validation', () => {
  it('flags a hand-drawn route that goes through a wall', () => {
    const { project } = twoRoomProject();
    const problems = validateRoute(project, next(), [
      { x: 1, y: 1.5, z: 4 }, { x: 1, y: 1.5, z: 8 },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].reason).toBe('wall');
  });

  it('accepts a hand-drawn route through the door', () => {
    const { project } = twoRoomProject();
    const problems = validateRoute(project, next(), [
      { x: 3, y: 1, z: 4 }, { x: 3, y: 1, z: 8 },
    ]);
    expect(problems).toHaveLength(0);
  });

  it('exempts a segment that runs inside installed containment', () => {
    const { project, ids: f } = twoRoomProject();
    addTray(project, f);                       // runs x = 7, z = 2 .. 10 at y = 2.75
    const problems = validateRoute(project, next(), [
      { x: 7, y: 2.75, z: 2 }, { x: 7, y: 2.75, z: 10 },
    ]);
    expect(problems).toHaveLength(0);
  });
});

describe('containment detection', () => {
  it('notices when a route follows a tray', () => {
    const { project, ids: f } = twoRoomProject();
    const tray = addTray(project, f);
    const used = detectPathwaysAlong(project, [
      { x: 7, y: 2.75, z: 3 }, { x: 7, y: 2.75, z: 9 },
    ]);
    expect(used).toContain(tray.id);
  });

  it('does not claim a tray a route never touches', () => {
    const { project, ids: f } = twoRoomProject();
    addTray(project, f);
    const used = detectPathwaysAlong(project, [
      { x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 2 },
    ]);
    expect(used).toHaveLength(0);
  });
});
