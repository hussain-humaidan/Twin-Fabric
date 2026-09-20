# Twinfabric

**Open-source 3D digital twin and infrastructure planning platform.**
*This is the first vibe coded software and will be developed using vibe coding using Claude, ChatGPT and Gemini AI tools.*

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
| **Project** | one body of work | "Matam Infrastructure Project" |
| **Building** | the physical structure | "Matam", with an address |

A **template** fills a new project with geometry. Shipped templates are a
Matam, a generic two-storey office, and an empty site.
[`src/model/templates/matam.js`](src/model/templates/matam.js) is the only file
in the codebase that knows what a Matam is — the engine, the data model and
every engineering module are completely generic. Adding a school, warehouse,
studio or mosque is one module and one registry entry.

---

## Running it

### With Node

```bash
npm install
npm run dev          # http://localhost:8123
