# Twinfabric

**Open-source 3D digital twin and infrastructure planning platform.**

A lightweight game-engine-style building editor with an AV, network and
electrical infrastructure management system built on top of it. Draw a
building out of real walls, slabs, doors and stairs; fill it with equipment;
then run cables that physically cannot pass through a solid wall.

The name is deliberate: *building fabric* is the architectural term for the
walls, slabs and roof; *fabric* is the networking term for an interconnect.
Twinfabric is about both, and about the relationship between them.

> **Status: pre-1.0.** The engine and the data model are solid and tested. The
> browser-facing layers are verified by hand rather than automated tests. See
> [Known limits](#known-limits).

---

## What it does

- **Builds a real building.** Walls are parametric — `start`, `end`, `height`,
  `thickness` — and the mesh is generated from those with piers, sills and
  lintels cut around every opening. Slabs are extruded polygons with real
  voids for stairwells and risers. Doors, windows, cable penetrations, stairs
  and columns are first-class objects.
- **Detects rooms from the geometry.** A planar half-edge face traversal finds
  the enclosed cycles in the wall network. Move a wall, re-detect, and both
  rooms either side update.
- **Routes cables physically.** The router builds a navigation graph from the
  building itself — containment, openings that admit cables, ceiling voids,
  stair voids — and runs Dijkstra with per-pathway cost weights. A cable
  prefers tray → corridor → riser over free air, and cannot cross a wall
  except through an opening it actually fits through.
- **Understands signal direction.** A cable runs source port → destination
  port. A converter declares that SDI IN becomes HDMI OUT, so
  `Kiloview → converter → display` traces as one chain. Wiring an output to
  an output, or HDMI to RJ45, is refused with an explanation.
- **Audits the project.** Invalid pairings, routes through building fabric,
  runs past their practical length, rack conflicts, unpowered devices,
  duplicate IPs, over-capacity trays, outstanding placeholders.

## Platform, project, building

Three things, three names, never conflated:

| Level | What it is | Example |
| --- | --- | --- |
| **Application** | the software | Twinfabric 0.2.0 |
| **Project** | one body of work | "Mall Infrastructure Project" |
| **Building** | the physical structure | "Mall", with an address |

A **template** fills a new project with geometry. Shipped templates are a
Mall, a generic two-storey office, and an empty site.
[`src/model/templates/mall.js`](src/model/templates/mall.js) is the only file
in the codebase that knows what a Mall is — the engine, the data model and
every engineering module are completely generic. Adding a school, warehouse,
studio or mosque is one module and one registry entry.

---

## Running it

### With Node

```bash
npm install
npm run dev          # http://localhost:8123
```

### With nothing installed

Twinfabric still runs with no toolchain at all. `index.html` carries an import
map pointing `three` at a CDN, so any static file server works:

```bash
python -m http.server 8080
```

On Windows with nothing installed, a dependency-free server is included:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open `http://localhost:8123/`.

Opening `index.html` directly from disk does **not** work — browsers refuse to
load ES modules over `file://`, and the page says so if you try.

---

## Quick start

1. **Look around.** Drag to orbit, right-drag to pan, wheel to zoom. Press
   `X` for X-ray, or use the Floor selector and Isolate to work on one level.
2. **Edit the building.** In Building mode, drag a rectangle with the Room
   tool — you get a floor, four walls, a ceiling and the room record. Click a
   wall to cut a door, a window or a cable penetration.
3. **Place equipment.** Drag from the Library, or click a card and click in
   the model. Wall-mounted items snap to the wall face, ceiling items to the
   ceiling.
4. **Run a cable.** Press **ADD CABLE**, click the source device, pick its
   output port, click the destination, pick its input port. The route is
   generated through the building. Invalid pairings are refused.
5. **Shape the route.** Select the cable and drag the amber waypoint handles.
   Length, containment, openings and collisions all recalculate on drop.
6. **Check your work.** Inventory ▸ Project audit.

### Keyboard

```
A add equipment      C add cable        M measure      F focus selection
W draw wall          B create room      D add door     P draw tray
G grid               X x-ray            H ceilings     L labels
I isolate floor      R rotate 15 deg    Shift+W walk   Delete delete
Ctrl+Z undo          Ctrl+Shift+Z redo  Ctrl+K search  Ctrl+S save
1-5 camera presets   Esc cancel tool
```

---

## Coordinate system and scale

```
1 unit = 1 metre
Y  = up
+X = east      -X = west
+Z = south     -Z = north
```

Everything is real-world scale, because cable length is a number somebody has
to order against.

---

## PLACEHOLDER values

**Nothing in the shipped Mall template is survey data.** The footprint, floor
heights, wall thicknesses, door sizes, tray routes and stair geometry are
structured, named placeholders so they can be replaced field by field without
touching code. The inspector lists every outstanding one; individual entities
carry a `PLACEHOLDER` badge.

The same applies to hardware. Where the exact specification is unknown — the
Kiloview N50, the Blackmagic converters, the TVs, projectors, PCs and KVM —
the port list is a **configurable placeholder**, flagged `verifiedSpec: false`
and badged in the UI. Ports are fully editable: add, remove, rename, change
connector, direction and signal class, then tick "Spec verified". No routing,
validation or tracing logic depends on those defaults being right.

An honest placeholder is useful. An invented specification is a liability,
because somebody will order cable against it.

---

## Project file format

A saved project is a `.twinfabric` JSON container: a readable header over the
document, so a file can be identified without parsing tens of thousands of
entities.

```json
{
  "kind": "twinfabric.project",
  "formatVersion": 1,
  "application": { "name": "Twinfabric", "version": "0.2.0" },
  "schema": { "version": 3 },
  "meta": {
    "name": "Mall Infrastructure Project",
    "building": "Mall",
    "projectVersion": 12,
    "counts": { "levels": 3, "spaces": 44, "devices": 15, "cables": 18, "cableLength": 591.09 }
  },
  "document": { "levels": [], "walls": [], "devices": [], "cables": [] }
}
```

Projects are stored in the browser's **IndexedDB** and exported as files you
control. Bare documents from before the container existed still open.

Also exports CSV schedules for cables, equipment, ports and rooms.

---

## Architecture

Dependencies flow one way: `core → model → logic → three/ui`.

```
src/
├── app.config.js     product identity (renaming = editing this file)
├── core/             maths, state, utilities        no Three.js, no DOM
├── model/            the twin + templates           no Three.js, no DOM
├── logic/            geometry, collision, routing, tracing, validation
├── three/            rendering only
├── ui/               DOM only
└── persist/          IndexedDB, container format, CSV
```

`core`, `model`, `logic` and `persist` import **zero** Three.js and **zero**
DOM. That is what makes the engine testable, and what makes a future React
Three Fiber view layer a view-layer-only change.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, the routing
algorithm and the scaling strategy.

## Performance

Cables merge into one `LineSegments` geometry per cable type — roughly a dozen
draw calls for any number of cables. Equipment is instanced by primitive.
Every mutation declares which render scopes it invalidates, so selecting a
cable never rebuilds the architecture. Hidden cable types and floors are
excluded before geometry is generated, so hiding them genuinely removes the
cost.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The three most common contributions
are a new device, a new cable type and a new building template, and each is
one data entry plus a test.

```bash
npm run check    # lint + typecheck + test
```

## Known limits

- `src/three` and `src/ui` have no automated tests; they are verified by hand.
  A headless harness is the next testing task.
- TypeScript is scaffolded with domain types declared, but `checkJs` is off.
  The migration is incremental and described in CONTRIBUTING.
- Undo is snapshot-based (60 steps). A patch journal is the planned upgrade.
- Rack elevation is a list, not a 2D rack drawing.
- No DXF/IFC/PDF floor plan import yet. The data model leaves room for it:
  a building is levels + walls + slabs + openings, so an importer only has to
  emit those.
- PDF reports are not implemented; CSV schedules are.

## Roadmap

**0.3** — headless render tests, incremental TypeScript conversion, patch-based
undo, cable bundle grouping.
**0.4** — floor plan import (DXF, then IFC), rack elevation drawings, PDF
reports.
**0.5** — stress testing at 10,000+ cables, accessibility pass, browser matrix.
**1.0** — stable project format and a documented plugin surface for community
device libraries and templates.

## Security

A completed project describes a real building's layout, equipment locations,
network topology and power distribution. Treat exports the way you would treat
as-built drawings. See [SECURITY.md](SECURITY.md).

## Licence

[GNU Affero General Public License v3.0](LICENSE).

Copyright © 2026 Hussain Humaidan and Twinfabric contributors.

The AGPL's network clause (§13) matters for this project specifically, because
Twinfabric is a web application: **if you modify Twinfabric and let other
people use your modified version over a network** — hosting it for your
organisation, embedding it in a product, offering it as a service — **you must
offer those users the corresponding source of your modified version.**

Using it unmodified, or modifying it for your own internal use without letting
others interact with it remotely, does not trigger that obligation.

Contributions are accepted under the same licence.
