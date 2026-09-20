# Twinfabric — architecture

## 0. Platform / project separation

The application is generic. A building type is data, not code paths:

```
Twinfabric (application)
   │
   ├── Project            one body of work, its own name, client, reference
   │    └── Building      the physical structure: levels, walls, slabs, spaces
   │         └── Infrastructure   racks, devices, ports, cables, pathways
   │
   ├── Templates          matam · office · blank · (community modules)
   └── Catalog            device definitions → device instances
```

`src/app.config.js` holds the product identity; renaming the product is editing
that one file. `src/model/templates/index.js` is the only thing the platform
imports — it never refers to a specific building type. Every saved document
records its provenance: `application: {name, version}`, `schema: {version}`,
and a `projectVersion` that increments on each save.

## 1. Technology stack, and why

| Layer | Choice |
| --- | --- |
| 3D | **Three.js r169**, ES modules from cdn.jsdelivr.net |
| App | **Plain ES modules**, no framework, no build step |
| State | Hand-written store with scoped change events and snapshot undo |
| Styling | Hand-written CSS with custom properties |
| Persistence | JSON document + `localStorage`, with a migration hook |

The brief asked for React + React Three Fiber + Drei + Zustand + Tailwind.
That stack needs a bundler and a JSX transform, and the machine this was built
on has no Node.js, npm or any JavaScript toolchain — so there is no way to
produce a runnable artifact from it here. The substitutions are one-for-one:

| Asked for | Used instead | Migration cost |
| --- | --- | --- |
| React + JSX | `src/ui/dom.js` (`h()` helper) + per-panel render functions | UI rewrite only |
| React Three Fiber | `src/three/*` imperative scene graph | View layer only |
| Drei | `OrbitControls`, `PointerLockControls` from three/addons + own helpers | None |
| Zustand | `src/core/store.js` — same shape: one state object, subscriptions, actions | Near-zero |
| Tailwind | `css/app.css` with design tokens | Cosmetic |

The important consequence: **the data model and all the logic are framework-free
and renderer-free.** `src/core`, `src/model`, `src/logic` and `src/persist`
import nothing but each other. Porting to React Three Fiber means rewriting
`src/three/*` and `src/ui/*` and leaving the building engine, router, tracer and
twin model exactly as they are.

---

## 2. Module map

Dependencies flow one way: `core → model → logic → three / ui`.

```
src/
├── core/
│   ├── math.js          vectors, polygons, segment intersection, coordinate system
│   ├── util.js          typed IDs, deep clone, event bus, formatting, fuzzy match
│   └── store.js         state, scoped commits, undo/redo, selection, view state
│
├── app.config.js        product identity — the one place the app names itself
│
├── model/               ← the digital twin (pure JSON, no Three.js, no DOM)
│   ├── schema.js        entity factories, enums, defaults, document shape
│   ├── signals.js       connectors, signal classes, cable-type registry
│   ├── catalog.js       device library + configurable port templates
│   ├── queries.js       indexes and derived lookups (rebuilt on change)
│   ├── actions.js       every legal mutation, each with its undo label + scope
│   ├── buildingKit.js   generic constructors: wall networks, doors, windows,
│   │                    tray penetrations, opening↔space association
│   └── templates/
│       ├── index.js     the registry — the platform only ever sees this
│       ├── matam.js     THE ONLY FILE THAT KNOWS WHAT A MATAM IS
│       └── generic.js   blank site, two-storey office
│
├── logic/               ← engineering (pure, testable, no Three.js, no DOM)
│   ├── geometry.js      walls→segments with openings, stairs, columns, trays
│   ├── wallNetwork.js   room rectangles → non-overlapping split wall network
│   ├── spaceDetect.js   planar half-edge face detection: rooms from walls
│   ├── collision.js     segment vs walls / slabs / columns; walk collision
│   ├── router.js        navigation graph + Dijkstra cable routing
│   ├── trace.js         directional signal / power / network path tracing
│   ├── validate.js      port compatibility, direction, length, project audit
│   └── search.js        global search index and inventory filters
│
├── three/               ← rendering only
│   ├── viewport.js      renderer, cameras, orbit + first-person nav, picking
│   ├── materials.js     shared material library, view modes, per-level ghosting
│   ├── builders.js      descriptors → BufferGeometry, canvas label textures
│   ├── scene.js         layer orchestration, visibility predicates, focus
│   ├── tools.js         every pointer interaction
│   └── layers/          architecture · infrastructure · cables · pathways
│                        · labels · overlays
│
├── ui/                  ← DOM only
│   ├── dom.js  dialogs.js  chain.js
│   ├── topbar.js  statusbar.js  explorer.js  library.js  filters.js
│   ├── inspector.js  views.js  shortcuts.js  app.js
│
├── persist/io.js        save/load/import/export/CSV + schema migration
└── main.js              boot
```

---

## 3. Data model

```
Building
 └── Level            elevation, floor-to-floor, ceiling height, slab thickness
      ├── Wall        start, end, height, thickness, material, type, baseOffset
      │    └── Opening  door | window | penetration | vent | service | archway
      │                 offset, width, height, sill, cablePassable, peoplePassable
      ├── Slab        floor | ceiling | roof — polygon + holes + thickness
      ├── Stair       from/to level, origin, rotation, tread, riser, landing, flights
      ├── Column      position, shape, size, structural
      └── Space       code, name, kind, group, boundary polygon, ceiling height
           ├── Rack   rack units, position, rotation
           └── Device typeId, position, rotation, size, mounting, status, scenario
                └── Port   connector, direction (in|out|bidir), signals[], exclusive
                     └── Cable  typeId, signal, from{device,port}, to{device,port},
                                route[], pathwayIds[], openingIds[], length, status
Pathway               tray | basket | conduit | duct | shaft | ceiling | floor | wall
                      3D polyline, width, height, capacity, cost factor
Scenario              permanent | future | event | test, with a base layer
```

Design decisions worth naming:

- **IDs are typed and readable** (`WALL-014`, `TV-003`, `CABLE-SDI-0021`,
  `ROOM-U05`), generated from per-prefix counters stored on the document, so
  they survive save/load and read well on a label.
- **Ports are embedded in devices**, not a separate collection. Referential
  integrity is free, and a cable references `{deviceId, portId}`.
- **Cables are directional.** `from` is the source port, `to` is the
  destination port. Nothing treats a cable as an undirected line.
- **Signal continuity is explicit.** A device declares `passthrough`:
  `auto` (every input feeds outputs sharing a signal class), `declared`
  (explicit `links[]` — how a converter says "SDI IN becomes HDMI OUT"), or
  `none` (endpoint, patch panel). This is what makes
  `Kiloview → converter → TV` one traceable chain.
- **Everything unverified is flagged**, not invented: `placeholder` on geometry,
  `verifiedSpec` on devices, `verified` on individual ports.

---

## 4. 3D scene architecture

Layers are independent and rebuild independently:

| Layer | Representation | Cost |
| --- | --- | --- |
| Architecture | one mesh per wall / slab / stair / column, grouped per level | ~250 meshes, culled |
| Equipment | two `InstancedMesh` (box, cylinder) with per-instance colour | 2 draw calls |
| Cables | merged `LineSegments`, one geometry per cable type | ~12 draw calls |
| Emphasis | tube + direction arrows, only for selected / traced cables | single digits |
| Pathways | one mesh per tray, coloured by utilisation | tens |
| Labels | pooled canvas sprites, distance-culled and budgeted | ≤150 sprites |

A wall is **not** a cube. `logic/geometry.js:wallSegments()` splits it into
piers, sills and lintels around its openings, and those boxes merge into one
geometry — so a door is a real hole with no CSG and no shader tricks.

Slabs are extruded polygons **with holes**, so a stairwell void and a riser
shaft are real voids that you can see and route through.

Floor isolation, ghosting and cutaway are all cheap: level visibility is a group
toggle, ghosting is an opacity write on that level's materials (materials are
keyed by level for exactly this reason), and cutaway is one clipping plane.

---

## 5. Cable system architecture

### The navigation graph

`logic/router.js:buildRouteGraph()` builds, from the building itself:

| Node | Where | Purpose |
| --- | --- | --- |
| pathway vertex | every tray / conduit / shaft polyline point | cheap travel |
| opening | doors, archways, penetrations that admit cables | legal wall crossings |
| space hub | room centroid, in the ceiling void | in-room distribution |
| stair void | top and bottom of each stair | vertical link between levels |

Edges are added only where `logic/collision.js:segmentBlocked()` says the
straight line is physically possible. Edge cost is length × a preference
weight — tray 0.35, shaft 0.40, conduit 0.45, ceiling 0.70, free air 2.4 — so
Dijkstra naturally produces *device → drop → tray → corridor → riser → tray →
drop → device* rather than a straight line through three walls.

### Collision

`segmentBlocked()` tests a 3D segment against:

- **walls** — 2D segment/segment intersection, then the crossing height against
  the wall's vertical extent, then against every opening's aperture. An opening
  only counts if `cablePassable` is true and the segment passes through its
  actual width and height.
- **slabs** — a level change is only legal through a slab hole, a stair void or
  within tolerance of a vertical shaft pathway.
- **columns** — 2D polygon crossing.

The same routine, with a different radius, resolves first-person walking, so the
walkthrough and the cable router agree about what a wall is.

### Length

`route` is the physical 3D polyline. Length is the sum of its segments ×
the cable type's slack factor + a service loop per termination. Every length in
the schedule is derived, never typed in.

### Validation

`logic/validate.js:validateConnection()` refuses, with an explanation:

- an input used as a source, or an output used as a destination;
- incompatible connector families (HDMI ↔ RJ45), with a bridge table for the
  pairs that genuinely mate (LC ↔ SFP cage, C13 ↔ wall socket);
- a cable type whose termination does not fit either port.

and warns about: occupied exclusive ports, signal classes with no overlap,
runs past the cable type's practical length, and devices still on placeholder
specs.

---

## 6. Scaling to thousands of cables

1. **Geometry merging.** Cables merge into one `LineSegments` per type. Ten
   thousand cables is still about a dozen draw calls. Picking maps a hit's
   vertex index back to a cable id through a parallel array.
2. **Scoped rebuilds.** Every mutation declares which caches it invalidates
   (`arch`, `spaces`, `devices`, `cables`, `pathways`, `racks`, `meta`,
   `routegraph`). Selecting a cable never rebuilds the architecture; moving a
   device never rebuilds the walls.
3. **Filter at build time.** Hidden cable types, signal classes, statuses,
   scenarios and floors are excluded before geometry is generated, so hiding
   HDMI genuinely removes that cost.
4. **Emphasis instead of detail.** Tubes and direction arrows exist only for the
   handful of cables that are selected or on a traced path.
5. **Label budget.** Labels are pooled, distance-culled and capped.
6. **Cached derived data.** The entity index, the collision index and the
   routing graph are each rebuilt only when a monotonic revision changes.
7. **Instanced equipment.** Devices are instanced by primitive with per-instance
   colour.

The known weak point is snapshot undo (`structuredClone` of the document per
step, capped at 60). At tens of thousands of entities that wants replacing with
a patch journal — the commit API is already shaped for it.

---

## 7. What the architecture deliberately leaves room for

The document is plain JSON behind a small action API, so none of this is
blocked: a real backend (replace `persist/io.js`), authentication and
permissions, multi-user editing (actions are already discrete, labelled and
scoped), version history (snapshots already exist), QR codes on equipment (IDs
are already stable and printable), maintenance and fault logs (entities take
arbitrary attributes), SNMP or live status feeds (device `status` is a field,
not a derived value), and CAD/BIM/LiDAR import (a building is levels + walls +
slabs + openings; an importer only has to emit those).
