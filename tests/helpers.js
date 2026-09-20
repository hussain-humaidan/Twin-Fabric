/**
 * Test fixtures.
 *
 * Builds the smallest project that still exercises real behaviour: two rooms
 * either side of one wall, with a door and a cable penetration in it.
 *
 *        z
 *        ^            wall at z = 6, from x = 0 to x = 10
 *   6    +-----------+-----------+
 *        |   ROOM A  |           |   door       centred x = 3, 0.0 .. 2.1 m
 *        |           |           |   penetration centred x = 7, 2.6 .. 2.9 m
 *   0    +-----------+-----------+
 *        0                      10  -> x
 */
import { makeIdFactory } from '../src/core/util.js';
import {
  createEmptyProject, makeLevel, makeWall, makeOpening, makeSlab,
  makeSpace, makePathway, makeDevice, makePort, makeCable, makeColumn,
} from '../src/model/schema.js';
import { rect } from '../src/core/math.js';

export function ids() {
  return makeIdFactory({});
}

/** Two 10 x 6 rooms sharing a wall at z = 6, in a 10 x 12 envelope. */
export function twoRoomProject() {
  const f = ids();
  const p = createEmptyProject(f, { name: 'Test project', buildingName: 'Test building' });

  const level = makeLevel(f, {
    id: 'LEVEL-01', name: 'Ground', shortName: 'G', index: 0,
    elevation: 0, height: 3.5, ceilingHeight: 2.8, slabThickness: 0.3, hasCeiling: true,
  });
  p.levels.push(level);

  const wallHeight = level.height - level.slabThickness;   // 3.2
  const mk = (x1, z1, x2, z2, type = 'interior') => makeWall(f, {
    levelId: level.id, start: { x: x1, z: z1 }, end: { x: x2, z: z2 },
    height: wallHeight, thickness: 0.2, type,
  });

  // envelope
  const south = mk(0, 0, 10, 0, 'exterior');
  const north = mk(0, 12, 10, 12, 'exterior');
  const west = mk(0, 0, 0, 12, 'exterior');
  const east = mk(10, 0, 10, 12, 'exterior');
  // the shared partition under test
  const mid = mk(0, 6, 10, 6, 'interior');
  p.walls.push(south, north, west, east, mid);

  p.openings.push(makeOpening(f, {
    wallId: mid.id, kind: 'door', offset: 3, width: 1.0, height: 2.1, sill: 0,
  }));
  p.openings.push(makeOpening(f, {
    wallId: mid.id, kind: 'penetration', offset: 7, width: 0.4, height: 0.3, sill: 2.6,
  }));

  p.spaces.push(makeSpace(f, {
    id: 'ROOM-A', code: 'A', name: 'Room A', levelId: level.id, kind: 'room',
    boundary: rect(0, 0, 10, 6),
  }));
  p.spaces.push(makeSpace(f, {
    id: 'ROOM-B', code: 'B', name: 'Room B', levelId: level.id, kind: 'room',
    boundary: rect(0, 6, 10, 6),
  }));

  p.slabs.push(makeSlab(f, {
    levelId: level.id, kind: 'floor', polygon: rect(0, 0, 10, 12),
    thickness: 0.3, topElevation: 0,
  }));

  // Associate the openings with the two rooms so the router can use them.
  for (const o of p.openings) { o.spaceA = 'ROOM-A'; o.spaceB = 'ROOM-B'; }

  return { project: p, ids: f, level, wall: mid, walls: { south, north, west, east, mid } };
}

/** Adds a tray running along the ceiling void through both rooms. */
export function addTray(p, f, { y = 2.75 } = {}) {
  const pw = makePathway(f, {
    name: 'Tray 1', kind: 'tray', levelId: 'LEVEL-01', capacity: 4, width: 0.3, height: 0.1,
    points: [{ x: 7, y, z: 2 }, { x: 7, y, z: 6 }, { x: 7, y, z: 10 }],
  });
  p.pathways.push(pw);
  return pw;
}

/**
 * A source -> converter -> sink chain, which is the shape that matters:
 * the converter declares SDI IN -> HDMI OUT so tracing crosses it.
 */
export function chainProject() {
  const { project: p, ids: f } = twoRoomProject();

  const mkPort = (name, connector, direction, signals, extra = {}) =>
    makePort(f, { name, connector, direction, signals, verified: true, ...extra });

  const source = makeDevice(f, {
    id: 'SRC-001', name: 'Source', typeId: 'generic', spaceId: 'ROOM-A', levelId: 'LEVEL-01',
    position: { x: 2, y: 1, z: 2 },
    ports: [
      mkPort('SDI OUT', 'BNC', 'out', ['video']),
      mkPort('AC IN', 'IEC_C14', 'in', ['power']),
    ],
  });
  const conv = makeDevice(f, {
    id: 'CONV-001', name: 'SDI to HDMI', typeId: 'bmd-sdi-hdmi', spaceId: 'ROOM-B', levelId: 'LEVEL-01',
    position: { x: 8, y: 1, z: 9 },
    ports: [
      mkPort('SDI IN', 'BNC', 'in', ['video']),
      mkPort('HDMI OUT', 'HDMI', 'out', ['video', 'audio']),
    ],
    passthrough: 'declared',
  });
  conv.links = [{ from: conv.ports[0].id, to: conv.ports[1].id }];

  const sink = makeDevice(f, {
    id: 'TV-001', name: 'Display', typeId: 'tv', spaceId: 'ROOM-B', levelId: 'LEVEL-01',
    position: { x: 9, y: 2, z: 11 },
    ports: [
      mkPort('HDMI IN', 'HDMI', 'in', ['video', 'audio']),
      mkPort('ETH', 'RJ45', 'bidir', ['network']),
    ],
  });
  p.devices.push(source, conv, sink);

  const sdi = makeCable(f, {
    id: 'CABLE-SDI-001', typeId: 'CT-SDI', signal: 'video',
    from: { deviceId: source.id, portId: source.ports[0].id },
    to: { deviceId: conv.id, portId: conv.ports[0].id },
    route: [{ x: 2, y: 1, z: 2 }, { x: 8, y: 1, z: 9 }],
    status: 'installed',
  });
  const hdmi = makeCable(f, {
    id: 'CABLE-HDMI-001', typeId: 'CT-HDMI', signal: 'video',
    from: { deviceId: conv.id, portId: conv.ports[1].id },
    to: { deviceId: sink.id, portId: sink.ports[0].id },
    route: [{ x: 8, y: 1, z: 9 }, { x: 9, y: 2, z: 11 }],
    status: 'installed',
  });
  p.cables.push(sdi, hdmi);

  return { project: p, ids: f, source, conv, sink, sdi, hdmi };
}

export { makeColumn };
