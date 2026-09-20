import { describe, it, expect } from 'vitest';
import {
  wallSegments, windowPanels, doorLeaves, openingWorld, wallFrame, stairGeometry,
} from '../src/logic/geometry.js';
import {
  polygonArea, polygonCentroid, pointInPolygon, segIntersect2,
  simplifyPolyline, polylineLength, rect,
} from '../src/core/math.js';
import { buildWallNetwork, locateOnWall } from '../src/logic/wallNetwork.js';
import { detectFaces } from '../src/logic/spaceDetect.js';

const wall = (over = {}) => ({
  id: 'W1', start: { x: 0, z: 0 }, end: { x: 10, z: 0 },
  height: 3, thickness: 0.2, baseOffset: 0, ...over,
});

describe('wall segmentation', () => {
  it('produces one solid segment for a wall with no openings', () => {
    const segs = wallSegments(wall(), [], 0);
    expect(segs).toHaveLength(1);
    expect(segs[0].size.w).toBeCloseTo(10);
    expect(segs[0].size.h).toBeCloseTo(3);
    expect(segs[0].size.d).toBeCloseTo(0.2);
    expect(segs[0].position.x).toBeCloseTo(5);
    expect(segs[0].position.y).toBeCloseTo(1.5);
  });

  it('cuts a door into piers plus a lintel, and never a sill', () => {
    const door = { id: 'D1', kind: 'door', offset: 5, width: 1, height: 2.1, sill: 0 };
    const segs = wallSegments(wall(), [door], 0);
    const parts = segs.map((s) => s.part).sort();
    expect(parts).toEqual(['lintel', 'pier', 'pier']);

    const piers = segs.filter((s) => s.part === 'pier');
    expect(piers.map((s) => +s.size.w.toFixed(3)).sort()).toEqual([4.5, 4.5]);

    const lintel = segs.find((s) => s.part === 'lintel');
    expect(lintel.size.w).toBeCloseTo(1);
    expect(lintel.size.h).toBeCloseTo(0.9);      // 3 - 2.1
    expect(lintel.position.y).toBeCloseTo(2.55); // midpoint of 2.1..3
  });

  it('cuts a window into piers, a sill and a lintel', () => {
    const win = { id: 'N1', kind: 'window', offset: 5, width: 2, height: 1.5, sill: 1 };
    const segs = wallSegments(wall(), [win], 0);
    const parts = segs.map((s) => s.part).sort();
    expect(parts).toEqual(['lintel', 'pier', 'pier', 'sill']);

    const sill = segs.find((s) => s.part === 'sill');
    expect(sill.size.h).toBeCloseTo(1);
    const lintel = segs.find((s) => s.part === 'lintel');
    expect(lintel.size.h).toBeCloseTo(0.5);      // 3 - (1 + 1.5)
  });

  it('handles several openings in one wall', () => {
    const openings = [
      { id: 'D1', kind: 'door', offset: 2, width: 1, height: 2.1, sill: 0 },
      { id: 'P1', kind: 'penetration', offset: 6, width: 0.4, height: 0.3, sill: 2.5 },
    ];
    const segs = wallSegments(wall(), openings, 0);
    // 3 piers, a lintel over the door, and a sill + lintel around the penetration
    expect(segs.filter((s) => s.part === 'pier')).toHaveLength(3);
    expect(segs.filter((s) => s.part === 'lintel')).toHaveLength(2);
    expect(segs.filter((s) => s.part === 'sill')).toHaveLength(1);
  });

  it('offsets vertically by the level elevation and the wall base offset', () => {
    const segs = wallSegments(wall({ baseOffset: 0.5 }), [], 10);
    expect(segs[0].position.y).toBeCloseTo(10 + 0.5 + 1.5);
  });

  it('orients segments along the wall axis', () => {
    const segs = wallSegments(wall({ end: { x: 0, z: 10 } }), [], 0);
    // wall running +Z: angle = PI/2, rotationY = -PI/2
    expect(segs[0].rotationY).toBeCloseTo(-Math.PI / 2);
    expect(segs[0].position.x).toBeCloseTo(0);
    expect(segs[0].position.z).toBeCloseTo(5);
  });
});

describe('opening geometry', () => {
  it('places a window panel at its sill midpoint', () => {
    const win = { id: 'N1', kind: 'window', offset: 4, width: 2, height: 1.5, sill: 1 };
    const [panel] = windowPanels(wall(), [win], 0);
    expect(panel.position.x).toBeCloseTo(4);
    expect(panel.position.y).toBeCloseTo(1.75);  // 1 + 1.5/2
    expect(panel.size.w).toBeCloseTo(2);
  });

  it('only makes leaves for doors', () => {
    const openings = [
      { id: 'D1', kind: 'door', offset: 3, width: 1, height: 2.1, sill: 0 },
      { id: 'N1', kind: 'window', offset: 7, width: 1, height: 1, sill: 1 },
    ];
    expect(doorLeaves(wall(), openings, 0)).toHaveLength(1);
    expect(windowPanels(wall(), openings, 0)).toHaveLength(1);
  });

  it('reports the world aperture of an opening', () => {
    const pen = { id: 'P1', kind: 'penetration', offset: 6, width: 0.4, height: 0.3, sill: 2.5 };
    const w = openingWorld(wall(), pen, 0);
    expect(w.centre.x).toBeCloseTo(6);
    expect(w.centre.y).toBeCloseTo(2.65);
    expect(w.yMin).toBeCloseTo(2.5);
    expect(w.yMax).toBeCloseTo(2.8);
    expect(w.halfWidth).toBeCloseTo(0.2);
  });
});

describe('wall frame', () => {
  it('measures length and bearing', () => {
    const f = wallFrame(wall({ end: { x: 3, z: 4 } }));
    expect(f.length).toBeCloseTo(5);
    expect(f.angle).toBeCloseTo(Math.atan2(4, 3));
    expect(f.dir.x).toBeCloseTo(0.6);
    expect(f.dir.z).toBeCloseTo(0.8);
  });
});

describe('stairs', () => {
  it('generates whole risers that exactly span the level change', () => {
    const stair = {
      origin: { x: 0, z: 0 }, rotation: 0, width: 1.4,
      treadDepth: 0.28, riserHeight: 0.175, landingDepth: 1.4, flights: 2,
    };
    const g = stairGeometry(stair, 0, 3.5);
    expect(g.rise).toBeCloseTo(3.5);
    expect(g.treadCount).toBe(20);              // 3.5 / 0.175
    expect(g.riser).toBeCloseTo(0.175);
    expect(g.steps).toHaveLength(20);
    expect(g.landings).toHaveLength(1);
    // the top step's upper face reaches the destination level
    const top = Math.max(...g.steps.map((s) => s.position.y + s.size.h / 2));
    expect(top).toBeCloseTo(3.5);
  });

  it('makes a single straight flight when asked', () => {
    const stair = {
      origin: { x: 0, z: 0 }, rotation: 0, width: 1.2,
      treadDepth: 0.3, riserHeight: 0.2, landingDepth: 1, flights: 1,
    };
    const g = stairGeometry(stair, 0, 3);
    expect(g.landings).toHaveLength(0);
    expect(g.steps).toHaveLength(15);
  });
});

describe('polygon maths', () => {
  it('computes area and centroid of a rectangle', () => {
    const r = rect(0, 0, 10, 6);
    expect(Math.abs(polygonArea(r))).toBeCloseTo(60);
    const c = polygonCentroid(r);
    expect(c.x).toBeCloseTo(5);
    expect(c.z).toBeCloseTo(3);
  });

  it('tests point containment', () => {
    const r = rect(0, 0, 10, 6);
    expect(pointInPolygon({ x: 5, z: 3 }, r)).toBe(true);
    expect(pointInPolygon({ x: 15, z: 3 }, r)).toBe(false);
    expect(pointInPolygon({ x: 5, z: -1 }, r)).toBe(false);
  });

  it('finds proper segment intersections', () => {
    const hit = segIntersect2({ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit.point.x).toBeCloseTo(5);
    expect(hit.point.z).toBeCloseTo(5);
    expect(segIntersect2({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 5 }, { x: 1, z: 5 })).toBeNull();
  });

  it('measures and simplifies polylines', () => {
    const pts = [
      { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 4 },
    ];
    expect(polylineLength(pts)).toBeCloseTo(14);
    // the collinear middle point is removed, the corner survives
    const simple = simplifyPolyline(pts);
    expect(simple).toHaveLength(3);
    expect(polylineLength(simple)).toBeCloseTo(14);
  });
});

describe('wall network', () => {
  it('gives two adjacent rooms one shared wall, not two', () => {
    const specs = buildWallNetwork([
      { x: 0, z: 0, w: 10, d: 6 },
      { x: 10, z: 0, w: 10, d: 6 },
    ]);
    const shared = specs.filter((s) => Math.abs(s.start.x - 10) < 1e-6 && Math.abs(s.end.x - 10) < 1e-6);
    expect(shared).toHaveLength(1);
  });

  it('splits a long wall where a partition meets it', () => {
    const specs = buildWallNetwork([
      { x: 0, z: 0, w: 10, d: 6 },
      { x: 10, z: 0, w: 10, d: 6 },
    ]);
    // the z = 0 line is covered by two rooms, so it emits two segments split at x = 10
    const southern = specs.filter((s) => Math.abs(s.start.z) < 1e-6 && Math.abs(s.end.z) < 1e-6);
    expect(southern).toHaveLength(2);
    expect(southern.every((s) => Math.abs(s.end.x - s.start.x - 10) < 1e-6)).toBe(true);
  });

  it('marks the envelope exterior and the partition interior', () => {
    const specs = buildWallNetwork([
      { x: 0, z: 0, w: 10, d: 6 },
      { x: 10, z: 0, w: 10, d: 6 },
    ]);
    const shared = specs.find((s) => Math.abs(s.start.x - 10) < 1e-6 && Math.abs(s.end.x - 10) < 1e-6);
    expect(shared.type).toBe('interior');
    const west = specs.find((s) => Math.abs(s.start.x) < 1e-6 && Math.abs(s.end.x) < 1e-6);
    expect(west.type).toBe('exterior');
  });

  it('locates a point on a wall and reports the offset along it', () => {
    const walls = [{ id: 'W1', start: { x: 0, z: 0 }, end: { x: 10, z: 0 } }];
    const hit = locateOnWall(walls, { x: 4, z: 0.1 });
    expect(hit).not.toBeNull();
    expect(hit.wall.id).toBe('W1');
    expect(hit.offset).toBeCloseTo(4);
    // too far away
    expect(locateOnWall(walls, { x: 4, z: 3 })).toBeNull();
  });
});

describe('room detection from wall geometry', () => {
  const asWalls = (specs) => specs.map((s, i) => ({ id: `W${i}`, ...s }));

  it('finds one room in a closed rectangle', () => {
    const faces = detectFaces(asWalls(buildWallNetwork([{ x: 0, z: 0, w: 10, d: 6 }])));
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(60);
  });

  it('finds two rooms either side of a shared partition', () => {
    const faces = detectFaces(asWalls(buildWallNetwork([
      { x: 0, z: 0, w: 10, d: 6 },
      { x: 10, z: 0, w: 10, d: 6 },
    ])));
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => Math.round(f.area)).sort((a, b) => a - b)).toEqual([60, 60]);
  });

  it('finds four rooms in a 2 x 2 grid', () => {
    const faces = detectFaces(asWalls(buildWallNetwork([
      { x: 0, z: 0, w: 5, d: 5 }, { x: 5, z: 0, w: 5, d: 5 },
      { x: 0, z: 5, w: 5, d: 5 }, { x: 5, z: 5, w: 5, d: 5 },
    ])));
    expect(faces).toHaveLength(4);
    expect(faces.every((f) => Math.abs(f.area - 25) < 0.01)).toBe(true);
  });

  it('ignores an open shape that encloses nothing', () => {
    const walls = [
      { id: 'A', start: { x: 0, z: 0 }, end: { x: 10, z: 0 } },
      { id: 'B', start: { x: 10, z: 0 }, end: { x: 10, z: 6 } },
    ];
    expect(detectFaces(walls)).toHaveLength(0);
  });
});
