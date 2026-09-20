/**
 * Generic building templates - a blank site and a plain two-storey office.
 * They exist to prove the engine is not Matam-shaped.
 */
import { createEmptyProject, makeLevel, makeSlab, makePathway } from '../schema.js';
import { rect } from '../../core/math.js';
import {
  addLevelFromRects, addDoor, addWindows, addTrayPenetrations, associateOpenings,
} from '../buildingKit.js';
export function buildBlank(ids, { name = 'New building' } = {}) {
  const project = createEmptyProject(ids, { name, buildingType: 'custom' });
  const l = makeLevel(ids, {
    id: 'LEVEL-01', name: 'Ground floor', shortName: 'G', index: 0,
    elevation: 0, height: 3.6, ceilingHeight: 3.0, slabThickness: 0.25,
  });
  project.levels.push(l);
  project.slabs.push(makeSlab(ids, {
    levelId: l.id, kind: 'floor', name: 'Ground slab',
    polygon: rect(0, 0, 30, 20), thickness: 0.3, topElevation: 0,
  }));
  project.placeholders = ['Empty site — draw walls and rooms in Building mode.'];
  return project;
}

export function buildOffice(ids, { name = 'Office building' } = {}) {
  const project = createEmptyProject(ids, { name, buildingType: 'office' });
  const bounds = { minX: 0, maxX: 30, minZ: 0, maxZ: 20 };
  const levels = [0, 1].map((i) => makeLevel(ids, {
    id: `LEVEL-0${i + 1}`, name: i === 0 ? 'Ground floor' : 'First floor',
    shortName: i === 0 ? 'G' : '1', index: i,
    elevation: i * 3.8, height: 3.8, ceilingHeight: 2.9, slabThickness: 0.25,
  }));
  project.levels.push(...levels);
  for (const lvl of levels) {
    const rects = [
      { id: `${lvl.id}-OFF1`, code: 'O1', name: `Office 1 (${lvl.shortName})`, kind: 'room', rect: { x: 0, z: 0, w: 10, d: 8 } },
      { id: `${lvl.id}-OFF2`, code: 'O2', name: `Office 2 (${lvl.shortName})`, kind: 'room', rect: { x: 10, z: 0, w: 10, d: 8 } },
      { id: `${lvl.id}-OFF3`, code: 'O3', name: `Office 3 (${lvl.shortName})`, kind: 'room', rect: { x: 20, z: 0, w: 10, d: 8 } },
      { id: `${lvl.id}-CORR`, code: 'C', name: `Corridor (${lvl.shortName})`, kind: 'corridor', rect: { x: 0, z: 8, w: 30, d: 2.5 } },
      { id: `${lvl.id}-MEET`, code: 'M', name: `Meeting room (${lvl.shortName})`, kind: 'room', rect: { x: 0, z: 10.5, w: 18, d: 9.5 } },
      { id: `${lvl.id}-PLANT`, code: 'P', name: `Comms room (${lvl.shortName})`, kind: 'plant', rect: { x: 18, z: 10.5, w: 12, d: 9.5 } },
    ];
    const built = addLevelFromRects(project, ids, lvl, rects, { bounds });
    for (const [x, z] of [[5, 8], [15, 8], [25, 8], [9, 10.5], [24, 10.5]]) {
      addDoor(project, ids, built.walls, { x, z }, { penetrationSill: lvl.ceilingHeight + 0.2 });
    }
    addWindows(project, ids, built.walls, {});
    project.slabs.push(makeSlab(ids, {
      levelId: lvl.id, kind: lvl.index === 0 ? 'floor' : 'floor', name: `${lvl.name} slab`,
      polygon: rect(0, 0, 30, 20), thickness: 0.25, topElevation: lvl.elevation,
    }));
    project.pathways.push(makePathway(ids, {
      name: `Tray ${lvl.shortName}`, kind: 'tray', levelId: lvl.id, capacity: 40,
      points: [{ x: 1, y: lvl.elevation + lvl.ceilingHeight + 0.15, z: 9.25 }, { x: 29, y: lvl.elevation + lvl.ceilingHeight + 0.15, z: 9.25 }],
    }));
  }
  project.slabs.push(makeSlab(ids, {
    levelId: levels[1].id, kind: 'roof', name: 'Roof slab',
    polygon: rect(0, 0, 30, 20), thickness: 0.25, topElevation: 7.6,
  }));
  for (const pw of project.pathways) addTrayPenetrations(project, ids, pw);
  associateOpenings(project);
  project.placeholders = ['Generic two-storey office — all dimensions are placeholders.'];
  return project;
}
