/**
 * Matam building template.
 *
 * This is the ONLY file in the codebase that knows what a Matam is. It is one
 * entry in the template registry; the platform, the data model and every
 * engineering module are completely generic.
 *
 * EVERY DIMENSION HERE IS A PLACEHOLDER. They are structured, named and
 * editable so real survey figures can replace them field by field without
 * touching any code. project.placeholders lists what still needs confirming.
 */
import {
  createEmptyProject, makeLevel, makeWall, makeSlab, makeStair,
  makeColumn, makeSpace, makePathway, makeRack, makeCable, PLACEHOLDER,
} from '../schema.js';
import { instantiate } from '../catalog.js';
import { buildWallNetwork } from '../../logic/wallNetwork.js';
import { rect } from '../../core/math.js';
import { routeBetween, cableLength } from '../../logic/router.js';
import {
  addLevelFromRects, addDoor, addWindows, addTrayPenetrations,
  associateOpenings, spaceAtPoint,
} from '../buildingKit.js';

let templateRev = 900000;
const W = 60;   // PLACEHOLDER building width  (X, east–west)
const D = 40;   // PLACEHOLDER building depth  (Z, north–south)

export function buildMatam(ids) {
  const project = createEmptyProject(ids, {
    name: 'Matam Infrastructure Project',
    buildingName: 'Matam',
    buildingType: 'matam',
  });
  project.building.notes = 'All dimensions are PLACEHOLDER values pending survey. Edit any level, wall, room or opening in Building mode.';

  /* ---------------- levels ---------------- */
  const ground = makeLevel(ids, {
    id: 'LEVEL-01', name: 'Downstairs', shortName: 'G', index: 0, kind: 'floor',
    elevation: 0, height: 4.6, ceilingHeight: 4.0, slabThickness: 0.30, hasCeiling: true,
    notes: `${PLACEHOLDER} floor-to-floor 4.60 m, ceiling 4.00 m`,
  });
  const upper = makeLevel(ids, {
    id: 'LEVEL-02', name: 'Upstairs', shortName: 'U', index: 1, kind: 'floor',
    elevation: 4.6, height: 4.0, ceilingHeight: 3.4, slabThickness: 0.30, hasCeiling: true,
    notes: `${PLACEHOLDER} floor-to-floor 4.00 m, ceiling 3.40 m`,
  });
  const roof = makeLevel(ids, {
    id: 'LEVEL-03', name: 'Roof', shortName: 'R', index: 2, kind: 'roof',
    elevation: 8.6, height: 1.2, ceilingHeight: 1.1, slabThickness: 0.30, hasCeiling: false,
    notes: `${PLACEHOLDER} parapet 1.10 m`,
  });
  project.levels.push(ground, upper, roof);
  const bounds = { minX: 0, maxX: W, minZ: 0, maxZ: D };

  /* ---------------- ground floor ---------------- */
  const gRects = [
    { id: 'HALL-01', code: 'H1', name: 'Hall 1', kind: 'hall', rect: { x: 0, z: 0, w: 18, d: 16 } },
    { id: 'HALL-02', code: 'H2', name: 'Hall 2', kind: 'hall', rect: { x: 18, z: 0, w: 18, d: 16 } },
    { id: 'HALL-03', code: 'H3', name: 'Hall 3', kind: 'hall', rect: { x: 36, z: 0, w: 24, d: 16 } },
    { id: 'CORR-G1', code: 'CG', name: 'Ground corridor', kind: 'corridor', rect: { x: 0, z: 16, w: 60, d: 3 } },
    { id: 'HALL-04', code: 'H4', name: 'Hall 4', kind: 'hall', rect: { x: 0, z: 19, w: 22, d: 11 } },
    { id: 'HALL-05', code: 'H5', name: 'Hall 5', kind: 'hall', rect: { x: 22, z: 19, w: 22, d: 11 } },
    { id: 'ROOM-D1', code: 'D1', name: 'Room D1', kind: 'room', rect: { x: 44, z: 19, w: 16, d: 3.67 } },
    { id: 'ROOM-D2', code: 'D2', name: 'Room D2', kind: 'room', rect: { x: 44, z: 22.67, w: 16, d: 3.66 } },
    { id: 'ROOM-D3', code: 'D3', name: 'Room D3', kind: 'room', rect: { x: 44, z: 26.33, w: 16, d: 3.67 } },
    { id: 'STAIR-G', code: 'SG', name: 'Stair hall (ground)', kind: 'stair', rect: { x: 0, z: 30, w: 6, d: 10 } },
    { id: 'LOBBY-G', code: 'LG', name: 'Entrance lobby', kind: 'lobby', rect: { x: 6, z: 30, w: 48, d: 10 } },
    { id: 'RACKROOM', code: 'RR', name: 'Service / Rack room', kind: 'plant', rect: { x: 54, z: 30, w: 6, d: 10 } },
  ];
  const g = addLevelFromRects(project, ids, ground, gRects, { bounds });

  const gDoors = [
    [9, 16], [27, 16], [48, 16],            // halls 1–3 → corridor
    [11, 19], [33, 19],                      // halls 4–5 → corridor
    [52, 19],                                // D1 → corridor
    [44, 21], [44, 24.5], [44, 28],          // D1/D2/D3 → hall 5
    [11, 30], [33, 30],                      // halls 4/5 → lobby
    [52, 30],                                // D3 → lobby
    [6, 35],                                 // lobby → stair hall
    [54, 35],                                // lobby → rack room
  ];
  for (const [x, z] of gDoors) {
    addDoor(project, ids, g.walls, { x, z }, { penetrationSill: 3.95 });
  }
  addDoor(project, ids, g.walls, { x: 30, z: 40 }, { width: 2.2, height: 2.4, name: 'Main entrance', penetration: false });
  addWindows(project, ids, g.walls, { sill: 1.1, height: 1.9 });

  /* ---------------- upper floor ---------------- */
  const rowB = 57 / 5;
  const clerkW = 48 / 11;
  const uRects = [
    ...[0, 1, 2, 3, 4].map((i) => ({
      id: `ROOM-U0${i + 1}`, code: `U${i + 1}`, name: `Room U${i + 1}`, kind: 'room',
      rect: { x: i * 12, z: 0, w: 12, d: 10 },
    })),
    { id: 'CORR-U1', code: 'CU', name: 'Upper corridor', kind: 'corridor', rect: { x: 0, z: 10, w: 60, d: 3 } },
    ...[0, 1, 2, 3, 4].map((i) => ({
      id: `ROOM-U${String(i + 6).padStart(2, '0')}`, code: `U${i + 6}`, name: `Room U${i + 6}`, kind: 'room',
      rect: { x: i * rowB, z: 13, w: rowB, d: 10 },
    })),
    { id: 'CORR-U2', code: 'CU2', name: 'Clerks link corridor', kind: 'corridor', rect: { x: 57, z: 13, w: 3, d: 10 } },
    { id: 'CLERKHALL-01', code: 'CH1', name: 'Clerks Hall 1', kind: 'hall', group: 'clerks', rect: { x: 0, z: 23, w: 30, d: 7 } },
    { id: 'CLERKHALL-02', code: 'CH2', name: 'Clerks Hall 2', kind: 'hall', group: 'clerks', rect: { x: 30, z: 23, w: 30, d: 7 } },
    { id: 'STAIR-U', code: 'SU', name: 'Stair hall (upper)', kind: 'stair', rect: { x: 0, z: 30, w: 6, d: 10 } },
    { id: 'CORR-U3', code: 'CU3', name: 'Clerks corridor', kind: 'corridor', group: 'clerks', rect: { x: 6, z: 30, w: 48, d: 3 } },
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `CLERKROOM-${String(i + 1).padStart(2, '0')}`,
      code: `CR${i + 1}`, name: `Clerk Room ${i + 1}`, kind: 'clerk-room', group: 'clerks',
      rect: { x: 6 + i * clerkW, z: 33, w: clerkW, d: 7 },
    })),
    { id: 'RISER-U', code: 'RU', name: 'Riser / service (upper)', kind: 'plant', rect: { x: 54, z: 30, w: 6, d: 10 } },
  ];
  const u = addLevelFromRects(project, ids, upper, uRects, { bounds });

  const uDoors = [
    [6, 10], [18, 10], [30, 10], [42, 10], [54, 10],
    [rowB * 0.5, 13], [rowB * 1.5, 13], [rowB * 2.5, 13], [rowB * 3.5, 13], [rowB * 4.5, 13],
    [58.5, 13], [58.5, 23],
    [15, 30], [3, 30], [42, 30], [57, 30],
    [6, 35],
    ...Array.from({ length: 11 }, (_, i) => [6 + clerkW * (i + 0.5), 33]),
  ];
  for (const [x, z] of uDoors) {
    addDoor(project, ids, u.walls, { x, z }, { penetrationSill: 3.35, penetrationGap: 1.1 });
  }
  addWindows(project, ids, u.walls, { sill: 0.95, height: 1.5 });

  /* ---------------- roof ---------------- */
  const rRects = [
    { id: 'ROOF-DECK', code: 'RD', name: 'Roof deck', kind: 'roof-zone', rect: { x: 0, z: 0, w: W, d: D }, noCeiling: true },
  ];
  const r = addLevelFromRects(project, ids, roof, rRects, {
    bounds, exteriorThickness: 0.25, interiorThickness: 0.25, exteriorMaterial: 'MAT-CONCRETE',
  });
  for (const w of r.walls) { w.height = 1.1; w.type = 'exterior'; w.name = 'Parapet'; }

  // Roof zones — metadata regions for equipment placement, not walled rooms.
  project.spaces.push(
    makeSpace(ids, {
      id: 'ROOF-PLANT', code: 'RP', name: 'Roof plant zone', levelId: roof.id, kind: 'roof-zone',
      boundary: rect(40, 2, 16, 12), placeholder: true, notes: 'Suggested location for outdoor AV/IT plant.',
    }),
    makeSpace(ids, {
      id: 'ROOF-MAST', code: 'RM', name: 'Antenna / mast zone', levelId: roof.id, kind: 'roof-zone',
      boundary: rect(44, 18, 12, 10), placeholder: true, notes: 'Antennas, wireless links, satellite.',
    }),
    makeSpace(ids, {
      id: 'ROOF-ACCESS', code: 'RA', name: 'Roof access / stair head', levelId: roof.id, kind: 'stair',
      boundary: rect(0, 30, 6, 10), placeholder: true,
    }),
  );

  // Stair-head enclosure with a real door onto the deck.
  const headSpecs = buildWallNetwork([{ x: 0, z: 30, w: 6, d: 10 }], { bounds });
  const headWalls = headSpecs.map((s) => makeWall(ids, {
    levelId: roof.id, start: s.start, end: s.end, height: 2.4, thickness: 0.2,
    type: 'exterior', materialId: 'MAT-BLOCK', name: 'Stair head', placeholder: true,
  }));
  project.walls.push(...headWalls);
  addDoor(project, ids, headWalls, { x: 6, z: 35 }, { name: 'Roof access door', penetrationSill: 2.0, penetrationGap: 1.4 });

  /* ---------------- slabs ---------------- */
  const stairHole = rect(0.4, 31.2, 3.4, 5.6);
  const riserHole = rect(56.1, 35.1, 1.8, 1.8);

  project.slabs.push(
    makeSlab(ids, {
      levelId: ground.id, kind: 'floor', name: 'Ground floor slab',
      polygon: rect(0, 0, W, D), thickness: 0.35, topElevation: 0, materialId: 'MAT-CONCRETE',
    }),
    makeSlab(ids, {
      levelId: upper.id, kind: 'floor', name: 'Upper floor slab',
      polygon: rect(0, 0, W, D), holes: [stairHole, riserHole],
      thickness: ground.slabThickness, topElevation: upper.elevation, materialId: 'MAT-CONCRETE',
    }),
    makeSlab(ids, {
      levelId: roof.id, kind: 'roof', name: 'Roof deck slab',
      polygon: rect(0, 0, W, D), holes: [stairHole, riserHole],
      thickness: upper.slabThickness, topElevation: roof.elevation, materialId: 'MAT-ROOF',
    }),
  );

  /* ---------------- stairs ---------------- */
  project.stairs.push(
    makeStair(ids, {
      name: 'Main stair — ground to upper',
      fromLevelId: ground.id, toLevelId: upper.id,
      origin: { x: 2.0, z: 31.5 }, rotation: Math.PI / 2,
      width: 1.4, treadDepth: 0.28, riserHeight: 0.175, landingDepth: 1.4, flights: 2,
    }),
    makeStair(ids, {
      name: 'Roof stair — upper to roof',
      fromLevelId: upper.id, toLevelId: roof.id,
      origin: { x: 2.0, z: 31.5 }, rotation: Math.PI / 2,
      width: 1.4, treadDepth: 0.28, riserHeight: 0.175, landingDepth: 1.4, flights: 2,
    }),
  );

  /* ---------------- columns ---------------- */
  const colPts = [[9, 8], [27, 8], [48, 8], [11, 24.5], [33, 24.5], [30, 35]];
  for (const [x, z] of colPts) {
    for (const lvl of [ground, upper]) {
      project.columns.push(makeColumn(ids, {
        levelId: lvl.id, position: { x, z }, shape: 'round', radius: 0.3,
        materialId: 'MAT-CONCRETE', structural: true,
      }));
    }
  }

  /* ---------------- pathways ---------------- */
  const gTrayY = ground.elevation + ground.ceilingHeight + 0.15;   // 4.15
  const uTrayY = upper.elevation + upper.ceilingHeight + 0.15;     // 8.15
  const roofY = roof.elevation + 0.4;

  project.pathways.push(
    makePathway(ids, {
      name: 'Tray G-A — ground corridor', kind: 'tray', levelId: ground.id,
      width: 0.4, height: 0.1, capacity: 60,
      // Vertices every ~10 m so drops from nearby rooms are short and honest.
      points: [
        { x: 2, y: gTrayY, z: 17.5 }, { x: 10, y: gTrayY, z: 17.5 }, { x: 20, y: gTrayY, z: 17.5 },
        { x: 30, y: gTrayY, z: 17.5 }, { x: 40, y: gTrayY, z: 17.5 }, { x: 50, y: gTrayY, z: 17.5 },
        { x: 57, y: gTrayY, z: 17.5 }, { x: 57, y: gTrayY, z: 26 }, { x: 57, y: gTrayY, z: 36 },
      ],
      placeholder: true,
    }),
    makePathway(ids, {
      name: 'Tray G-B — lobby spine', kind: 'tray', levelId: ground.id,
      width: 0.3, height: 0.1, capacity: 40,
      points: [{ x: 8, y: gTrayY, z: 35 }, { x: 53, y: gTrayY, z: 35 }, { x: 57, y: gTrayY, z: 36 }],
      placeholder: true,
    }),
    makePathway(ids, {
      name: 'Tray U-A — upper corridor', kind: 'tray', levelId: upper.id,
      width: 0.4, height: 0.1, capacity: 60,
      points: [
        { x: 2, y: uTrayY, z: 11.5 }, { x: 12, y: uTrayY, z: 11.5 }, { x: 24, y: uTrayY, z: 11.5 },
        { x: 36, y: uTrayY, z: 11.5 }, { x: 48, y: uTrayY, z: 11.5 }, { x: 58.5, y: uTrayY, z: 11.5 },
        { x: 58.5, y: uTrayY, z: 18 }, { x: 57, y: uTrayY, z: 26 }, { x: 57, y: uTrayY, z: 36 },
      ],
      placeholder: true,
    }),
    makePathway(ids, {
      name: 'Tray U-B — clerks corridor', kind: 'tray', levelId: upper.id,
      width: 0.3, height: 0.1, capacity: 40,
      points: [
        { x: 8, y: uTrayY, z: 31.5 }, { x: 18, y: uTrayY, z: 31.5 }, { x: 28, y: uTrayY, z: 31.5 },
        { x: 38, y: uTrayY, z: 31.5 }, { x: 48, y: uTrayY, z: 31.5 }, { x: 53, y: uTrayY, z: 31.5 },
        { x: 57, y: uTrayY, z: 36 },
      ],
      placeholder: true,
    }),
    makePathway(ids, {
      name: 'Riser 1 — main vertical shaft', kind: 'shaft', levelId: null,
      width: 0.6, height: 0.6, capacity: 120,
      points: [
        { x: 57, y: 0.4, z: 36 }, { x: 57, y: gTrayY, z: 36 },
        { x: 57, y: uTrayY, z: 36 }, { x: 57, y: roofY, z: 36 },
      ],
      placeholder: true,
      notes: 'Main riser between ground rack room, upper riser and roof.',
    }),
    makePathway(ids, {
      name: 'Tray R-A — roof route', kind: 'tray', levelId: roof.id,
      width: 0.3, height: 0.1, capacity: 30,
      points: [{ x: 57, y: roofY, z: 36 }, { x: 57, y: roofY, z: 24 }, { x: 50, y: roofY, z: 23 }, { x: 48, y: roofY, z: 8 }],
      placeholder: true,
    }),
  );

  for (const pw of project.pathways) addTrayPenetrations(project, ids, pw);
  associateOpenings(project);
  seedInfrastructure(project, ids, ground, upper);

  project.placeholders = [
    'Building footprint 60.00 × 40.00 m',
    'Downstairs: 5 halls + 3 rooms, floor-to-floor 4.60 m, ceiling 4.00 m',
    'Upstairs: 10 rooms + 2 clerks halls + 11 clerk rooms, floor-to-floor 4.00 m, ceiling 3.40 m',
    'Roof: parapet 1.10 m, stair-head enclosure 2.40 m',
    'All wall thicknesses (exterior 0.30 m, interior 0.15 m)',
    'All door / window / penetration sizes and positions',
    'Stair geometry (0.28 m tread, 0.175 m riser, 1.40 m wide, half-landing)',
    'Cable tray routes, sizes and capacities',
    'Kiloview N50 port list — confirm the real I/O',
    'Blackmagic converter port lists — confirm the exact models',
    'TV / projector / PC / KVM port lists',
  ];
  return project;
}

/* ------------------------------------------------------------------ */
/* seed infrastructure — a small, real, traceable example              */
/* ------------------------------------------------------------------ */

function seedInfrastructure(project, ids, ground, upper) {
  const rev = ++templateRev;
  const place = (dev, x, y, z, mounting, rotation = 0) => {
    dev.position = { x, y, z };
    dev.rotation = rotation;
    dev.mounting = mounting;
    const lvl = y >= upper.elevation ? upper : ground;
    dev.levelId = lvl.id;
    dev.spaceId = spaceAtPoint(project, lvl.id, { x, z })?.id || null;
    project.devices.push(dev);
    return dev;
  };
  const portByName = (dev, name) => dev.ports.find((p) => p.name === name);

  /* rack room */
  const rack = makeRack(ids, {
    name: 'Rack 01', spaceId: 'RACKROOM', levelId: ground.id,
    position: { x: 56.9, y: 0, z: 36.5 }, rotation: 0, rackUnits: 42,
  });
  project.racks.push(rack);

  const inRack = (dev, u) => {
    dev.rackId = rack.id; dev.rackU = u; dev.mounting = 'rack';
    dev.levelId = ground.id; dev.spaceId = 'RACKROOM';
    dev.position = { x: rack.position.x, y: rack.baseHeight + (u - 1) * 0.04445, z: rack.position.z };
    project.devices.push(dev);
    return dev;
  };

  const pdu = inRack(instantiate(ids, 'pdu', { name: 'Rack 01 PDU' }), 1);
  const ups = inRack(instantiate(ids, 'ups', { name: 'Rack 01 UPS' }), 3);
  const sw = inRack(instantiate(ids, 'switch', { name: 'Core switch', attributes: { hostname: 'sw-core-01', ip: '', mgmtVlan: '', portCount: '24' } }), 24);
  const kvm = inRack(instantiate(ids, 'kvm-switch', { name: 'KVM switch' }), 22);
  const kvmc = inRack(instantiate(ids, 'kvm-console', { name: 'KVM console' }), 21);
  const klv = inRack(instantiate(ids, 'kiloview-n50', { name: 'Kiloview N50 — Hall 1 feed' }), 19);

  const db = place(instantiate(ids, 'distribution-board', { name: 'Distribution board — ground' }), 59.6, 1.4, 33.5, 'wall', Math.PI / 2);
  const skt2 = place(instantiate(ids, 'socket', { name: 'Rack room socket' }), 54.3, 0.4, 36, 'wall', Math.PI / 2);

  /* Hall 1 */
  const tv = place(instantiate(ids, 'tv', { name: 'Hall 1 main TV' }), 9, 2.3, 0.25, 'wall', 0);
  const bmdOut = place(instantiate(ids, 'bmd-sdi-hdmi', { name: 'Hall 1 SDI→HDMI converter' }), 10.6, 2.3, 0.35, 'wall', 0);
  const pc = place(instantiate(ids, 'pc', { name: 'Hall 1 control PC', attributes: { hostname: 'matam-h1-pc', ip: '', mac: '', os: '', vlan: '' } }), 3.5, 0.25, 5.5, 'floor', 0);
  const bmdIn = place(instantiate(ids, 'bmd-hdmi-sdi', { name: 'Hall 1 HDMI→SDI converter' }), 3.5, 0.75, 5.0, 'desk', 0);
  const ktx = place(instantiate(ids, 'kvm-tx', { name: 'Hall 1 KVM transmitter' }), 4.2, 0.75, 5.0, 'desk', 0);
  const skt1 = place(instantiate(ids, 'socket', { name: 'Hall 1 AV socket' }), 8.2, 0.4, 0.2, 'wall', 0);

  /* a planned, not-yet-installed display — demonstrates scenario + status */
  const tv2 = place(instantiate(ids, 'tv', { name: 'Hall 2 TV (planned)' }), 27, 2.3, 0.25, 'wall', 0);
  tv2.status = 'planned';
  tv2.scenarioId = 'SCENARIO-FUTURE';

  const link = (src, srcPort, dst, dstPort, typeId, opts = {}) => {
    const sp = portByName(src, srcPort), dp = portByName(dst, dstPort);
    if (!sp || !dp) return null;
    const from = anchorOf(project, src, sp);
    const to = anchorOf(project, dst, dp);
    const res = routeBetween(project, rev, from, to, {
      fromSpaceId: src.spaceId, toSpaceId: dst.spaceId,
    });
    const cable = makeCable(ids, {
      id: ids.next(`CABLE-${typeId.replace('CT-', '')}`),
      typeId,
      signal: project.cableTypes.find((t) => t.id === typeId)?.signal || 'data',
      from: { deviceId: src.id, portId: sp.id },
      to: { deviceId: dst.id, portId: dp.id },
      route: res.route, pathwayIds: res.pathwayIds, openingIds: res.openingIds,
      warnings: res.warnings, status: opts.status || 'installed',
      scenarioId: opts.scenarioId || 'SCENARIO-PERMANENT',
      notes: opts.notes || '',
    });
    cable.length = cableLength(project, cable, cable.route);
    project.cables.push(cable);
    return cable;
  };

  // Video chain — exactly the Hall 1 example: Kiloview → converter → TV.
  link(klv, 'SDI OUT 1', bmdOut, 'SDI IN', 'CT-SDI', { notes: 'Rack room → Hall 1 over the corridor tray and riser.' });
  link(bmdOut, 'HDMI OUT', tv, 'HDMI IN 1', 'CT-HDMI', { notes: 'Short local HDMI at the display.' });
  // Return feed — PC → converter → Kiloview.
  link(pc, 'HDMI OUT 1', bmdIn, 'HDMI IN', 'CT-HDMI');
  link(bmdIn, 'SDI OUT 1', klv, 'SDI IN 1', 'CT-SDI');
  // Network
  link(sw, 'GE 1', pc, 'ETH 1', 'CT-ETH');
  link(sw, 'GE 2', klv, 'ETH 1 (NDI)', 'CT-ETH');
  // KVM path — PC → transmitter → KVM switch → console.
  link(pc, 'HDMI OUT 2', ktx, 'HDMI IN', 'CT-HDMI');
  link(pc, 'USB 1', ktx, 'USB IN', 'CT-USB');
  link(ktx, 'LINK OUT', kvm, 'CPU 1', 'CT-KVM');
  link(kvm, 'CONSOLE 1', kvmc, 'KVM IN', 'CT-KVM');
  // Power
  link(db, 'WAY 1', skt2, 'CIRCUIT IN', 'CT-MAINS');
  link(skt2, 'OUTLET', ups, 'AC IN', 'CT-AC');
  link(ups, 'OUT 1', pdu, 'AC IN', 'CT-AC');
  link(pdu, 'C13 1', sw, 'AC IN', 'CT-AC');
  link(pdu, 'C13 2', kvm, 'AC IN', 'CT-AC');
  link(db, 'WAY 2', skt1, 'CIRCUIT IN', 'CT-MAINS');
  link(skt1, 'OUTLET', tv, 'AC IN', 'CT-AC');
  // Planned future run to the Hall 2 display.
  const planned = link(klv, 'SDI OUT 1', tv2, 'HDMI IN 1', 'CT-SDI', {
    status: 'planned', scenarioId: 'SCENARIO-FUTURE',
    notes: 'PLANNED. Placeholder endpoint — a converter will be needed at the display.',
  });
  if (planned) planned.warnings = [...(planned.warnings || []), 'Planned run: SDI cannot terminate directly on an HDMI input — add a converter.'];
}

/** Local copy of the port anchor rule (queries.js index is not built yet). */
function anchorOf(project, device, port) {
  let base = device.position;
  if (device.rackId) {
    const rack = project.racks.find((r) => r.id === device.rackId);
    if (rack) {
      const u = device.rackU ?? 1;
      base = {
        x: rack.position.x,
        y: rack.position.y + rack.baseHeight + (u - 1) * 0.04445 + (device.rackUnits * 0.04445) / 2,
        z: rack.position.z,
      };
    }
  }
  const idx = Math.max(0, device.ports.indexOf(port));
  const n = Math.max(1, device.ports.length);
  const s = device.size;
  const spread = n > 1 ? ((idx / (n - 1)) - 0.5) * Math.min(s.w * 0.8, 0.9) : 0;
  const local = { x: spread, y: -s.h * 0.15, z: s.d * 0.5 };
  const c = Math.cos(device.rotation || 0), si = Math.sin(device.rotation || 0);
  return {
    x: base.x + local.x * c - local.z * si,
    y: base.y + local.y,
    z: base.z + local.x * si + local.z * c,
  };
}
