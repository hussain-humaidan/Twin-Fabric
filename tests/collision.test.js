import { describe, it, expect } from 'vitest';
import { segmentBlocked, groundHeightAt, resolveWalk } from '../src/logic/collision.js';
import { makeColumn } from '../src/model/schema.js';
import { twoRoomProject, ids } from './helpers.js';

/**
 * The single most important rule in the application: a cable may only cross a
 * wall through an opening that actually admits cables, at a height and offset
 * that fall inside that opening's aperture.
 */
describe('wall crossings', () => {
  let rev = 0;
  const next = () => ++rev;

  it('blocks a run straight through a solid part of a wall', () => {
    const { project } = twoRoomProject();
    const hit = segmentBlocked(project, next(),
      { x: 1, y: 1.5, z: 4 }, { x: 1, y: 1.5, z: 8 });
    expect(hit.blocked).toBe(true);
    expect(hit.reason).toBe('wall');
  });

  it('allows a run through the door aperture', () => {
    const { project } = twoRoomProject();
    // door is centred on x = 3, 1 m wide, 0 .. 2.1 m high
    const hit = segmentBlocked(project, next(),
      { x: 3, y: 1.0, z: 4 }, { x: 3, y: 1.0, z: 8 });
    expect(hit.blocked).toBe(false);
    expect(hit.openingIds).toHaveLength(1);
  });

  it('blocks a run at door offset but above the door head', () => {
    const { project } = twoRoomProject();
    const hit = segmentBlocked(project, next(),
      { x: 3, y: 2.6, z: 4 }, { x: 3, y: 2.6, z: 8 });
    expect(hit.blocked).toBe(true);
  });

  it('allows a run through the cable penetration', () => {
    const { project } = twoRoomProject();
    // penetration is centred on x = 7, 0.4 m wide, 2.6 .. 2.9 m high
    const hit = segmentBlocked(project, next(),
      { x: 7, y: 2.75, z: 4 }, { x: 7, y: 2.75, z: 8 });
    expect(hit.blocked).toBe(false);
  });

  it('blocks a run just outside the penetration aperture', () => {
    const { project } = twoRoomProject();
    const hit = segmentBlocked(project, next(),
      { x: 7.5, y: 2.75, z: 4 }, { x: 7.5, y: 2.75, z: 8 });
    expect(hit.blocked).toBe(true);
  });

  it('respects a sealed opening', () => {
    const { project } = twoRoomProject();
    const pen = project.openings.find((o) => o.kind === 'penetration');
    pen.cablePassable = false;
    const hit = segmentBlocked(project, next(),
      { x: 7, y: 2.75, z: 4 }, { x: 7, y: 2.75, z: 8 });
    expect(hit.blocked).toBe(true);
  });

  it('can be told to refuse door routing', () => {
    const { project } = twoRoomProject();
    const hit = segmentBlocked(project, next(),
      { x: 3, y: 1.0, z: 4 }, { x: 3, y: 1.0, z: 8 }, { allowDoors: false });
    expect(hit.blocked).toBe(true);
  });

  it('passes over a wall that does not reach that height', () => {
    const { project, walls } = twoRoomProject();
    walls.mid.height = 1.0;   // a low partition
    const hit = segmentBlocked(project, next(),
      { x: 1, y: 2.0, z: 4 }, { x: 1, y: 2.0, z: 8 });
    expect(hit.blocked).toBe(false);
  });

  it('does not block a run that stays inside one room', () => {
    const { project } = twoRoomProject();
    const hit = segmentBlocked(project, next(),
      { x: 1, y: 1.5, z: 1 }, { x: 9, y: 1.5, z: 5 });
    expect(hit.blocked).toBe(false);
  });
});

describe('columns', () => {
  it('blocks a run that crosses a structural column', () => {
    const { project, ids: f } = twoRoomProject();
    project.columns.push(makeColumn(f, {
      levelId: 'LEVEL-01', position: { x: 5, z: 3 }, shape: 'round', radius: 0.4,
    }));
    const hit = segmentBlocked(project, 101,
      { x: 1, y: 1.5, z: 3 }, { x: 9, y: 1.5, z: 3 });
    expect(hit.blocked).toBe(true);
    expect(hit.reason).toBe('column');
  });

  it('lets a run pass beside the column', () => {
    const { project, ids: f } = twoRoomProject();
    project.columns.push(makeColumn(f, {
      levelId: 'LEVEL-01', position: { x: 5, z: 3 }, shape: 'round', radius: 0.4,
    }));
    const hit = segmentBlocked(project, 102,
      { x: 1, y: 1.5, z: 1 }, { x: 9, y: 1.5, z: 1 });
    expect(hit.blocked).toBe(false);
  });
});

describe('slabs and level changes', () => {
  it('blocks a vertical run through an unpenetrated slab', () => {
    const { project } = twoRoomProject();
    project.slabs.push({
      id: 'SLAB-UP', name: 'Upper', levelId: 'LEVEL-01', kind: 'floor',
      polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 12 }, { x: 0, z: 12 }],
      holes: [], thickness: 0.3, topElevation: 3.5, materialId: 'MAT-CONCRETE',
      spaceId: null, locked: false, notes: '',
    });
    const hit = segmentBlocked(project, 201, { x: 5, y: 2, z: 3 }, { x: 5, y: 5, z: 3 });
    expect(hit.blocked).toBe(true);
    expect(hit.reason).toBe('slab');
  });

  it('allows a vertical run through a slab hole', () => {
    const { project } = twoRoomProject();
    project.slabs.push({
      id: 'SLAB-UP', name: 'Upper', levelId: 'LEVEL-01', kind: 'floor',
      polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 12 }, { x: 0, z: 12 }],
      holes: [[{ x: 4, z: 2 }, { x: 6, z: 2 }, { x: 6, z: 4 }, { x: 4, z: 4 }]],
      thickness: 0.3, topElevation: 3.5, materialId: 'MAT-CONCRETE',
      spaceId: null, locked: false, notes: '',
    });
    const hit = segmentBlocked(project, 202, { x: 5, y: 2, z: 3 }, { x: 5, y: 5, z: 3 });
    expect(hit.blocked).toBe(false);
  });

  it('allows a vertical run inside a riser shaft', () => {
    const { project } = twoRoomProject();
    project.slabs.push({
      id: 'SLAB-UP', name: 'Upper', levelId: 'LEVEL-01', kind: 'floor',
      polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 12 }, { x: 0, z: 12 }],
      holes: [], thickness: 0.3, topElevation: 3.5, materialId: 'MAT-CONCRETE',
      spaceId: null, locked: false, notes: '',
    });
    project.pathways.push({
      id: 'PATH-RISER', name: 'Riser', kind: 'shaft', levelId: null,
      points: [{ x: 5, y: 0.5, z: 3 }, { x: 5, y: 6, z: 3 }],
      width: 0.6, height: 0.6, capacity: 40, costFactor: null,
      status: 'installed', locked: false, notes: '', placeholder: false,
    });
    const hit = segmentBlocked(project, 203, { x: 5, y: 2, z: 3 }, { x: 5, y: 5, z: 3 });
    expect(hit.blocked).toBe(false);
  });
});

describe('walkthrough collision', () => {
  it('stands the walker on the floor slab', () => {
    const { project } = twoRoomProject();
    expect(groundHeightAt(project, 301, 5, 3, 2)).toBeCloseTo(0);
    // outside the slab there is no ground
    expect(groundHeightAt(project, 301, 50, 50, 2)).toBeNull();
  });

  it('pushes a walker out of a wall', () => {
    const { project } = twoRoomProject();
    const from = { x: 1, z: 5 };
    const to = { x: 1, z: 6 };          // straight into the partition at z = 6
    const solved = resolveWalk(project, 302, from, to, 1.7, 0.32);
    expect(solved.z).toBeLessThan(6 - 0.2 / 2);
  });

  it('lets a walker through a doorway', () => {
    const { project } = twoRoomProject();
    const from = { x: 3, z: 5.5 };
    const to = { x: 3, z: 6.2 };         // through the door at x = 3
    const solved = resolveWalk(project, 303, from, to, 1.7, 0.32);
    expect(solved.z).toBeCloseTo(6.2, 1);
  });
});

export { ids };
