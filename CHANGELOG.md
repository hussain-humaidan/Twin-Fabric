# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-09-20

The release that turned a 3D visualisation into an editor, and a Mall-specific
tool into a platform.

### Added

**Cable route editing**
- Draggable waypoint handles on the selected cable. Shift drags height,
  right-click deletes, mid-segment handles insert. Dropping a handle
  recalculates length, re-detects containment and openings, and re-runs
  collision validation.
- Numeric X/Y/Z editing per waypoint in the inspector.
- Route authority: `auto`, `semi`, `manual`, `locked`. Automatic routes
  regenerate; semi-automatic routes keep the engineer's waypoints and only
  re-anchor their ends when a device moves; manual and locked are never
  touched by a bulk re-route. Editing a waypoint promotes `auto` to `semi`
  automatically, so the router stops overwriting a design once one exists.

**Project audit**
- Six-category audit (architecture, equipment, cables, pathways, power,
  network) with expandable, clickable findings and a text export. Detects
  invalid port pairings, routes through building fabric, cables past their
  practical length limit, rack conflicts, unpowered and unpatched devices,
  duplicate IP addresses, over-capacity containment, and outstanding
  placeholders.

**Building editing**
- Wall length and bearing are editable and move the wall's end point.
- Numeric room resize that moves the actual walls. A shared partition moves
  for both rooms, and every room on the level re-derives its boundary from the
  geometry afterwards.
- Live warnings when a new cable pushes containment past 85% or over capacity.

**Platform**
- `src/app.config.js` — product identity in one place.
- Application / project / building are now three distinct names.
- Every document records `application`, `schema` and an incrementing
  `projectVersion`.
- Template registry. Building templates are modules; the platform never refers
  to one by name.

**Storage and format**
- `.twinfabric` container format: a readable header (name, building, counts,
  provenance) over the document, so a file can be identified without parsing
  it. Bare pre-container documents still load.
- IndexedDB as the primary store, with automatic one-time migration from
  localStorage and a localStorage fallback for private windows.
- Named copies can be listed and deleted from the open dialog.

**Project scaffolding**
- Vite, Vitest, ESLint and TypeScript configuration; CI running lint,
  typecheck, test and build, with a GitHub Pages demo deploy.
- Domain type declarations in `src/types/twinfabric.d.ts`.
- Test suite covering geometry, collision, routing, connections and
  persistence.
- Released under the GNU AGPL v3.0, with `CONTRIBUTING.md`, `SECURITY.md`
  and `CODE_OF_CONDUCT.md`.

### Changed

- `templates.js` (706 lines) split into `buildingKit.js` (generic
  constructors) and `templates/{index,mall,generic}.js`. `templates/mall.js`
  is now the only file that knows what a Mall is.
- Renamed to **Twinfabric**.
- Autosave is asynchronous and flushes on `visibilitychange`/`pagehide`
  rather than `beforeunload`, which cannot complete an IndexedDB write.

### Fixed

- Boot overlay never hid: the author stylesheet outranked the user-agent
  `[hidden]` rule.
- Every dialog rendered a literal "null": `Element.append()` stringifies
  non-Node arguments.
- App never started in a hidden or backgrounded tab: boot awaited
  `requestAnimationFrame`, which does not fire there.
- Viewport went blank after any resize: `renderer.setSize(w, h, false)`
  resized the drawing buffer but left the canvas CSS box stale.
- A freshly generated project was never persisted, because the autosave
  listener was registered after boot emitted its change event.
- Resizing a room left the neighbouring room's boundary stale.

## [0.1.0] — 2026-09-20

Initial working version.

### Added

- Parametric building engine: walls generated from `(start, end, height,
  thickness)` and split into piers, sills and lintels around openings; slabs
  as extruded polygons with real voids; stairs, columns, doors, windows and
  cable penetrations as first-class objects.
- Room detection from wall geometry via planar half-edge face traversal.
- Physically-aware cable router: navigation graph over pathway vertices,
  opening nodes, space ceiling-void hubs and stair voids, with Dijkstra and
  per-pathway cost weights. A cable cannot pass through a solid wall.
- Directional cable model with connector/direction/signal validation and
  declared internal continuity, so a converter is a traceable hop.
- Signal, power and network path tracing; 2D logical map and connection
  diagrams generated from the 3D data.
- Device library with configurable port templates, explicitly flagged where
  the real hardware specification is unknown.
- Scenario layers, status filters, cable type filters, X-ray, cutaway,
  per-level isolation and first-person walkthrough.
- Equipment, cable, port and room schedules as CSV.
- Mall building template: 5 halls, 3 rooms, 10 upper rooms, 2 clerks halls,
  11 clerk rooms, roof with plant and mast zones.

[Unreleased]: https://github.com/hussain-humaidan/Twin-Fabric/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/hussain-humaidan/Twin-Fabric/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hussain-humaidan/Twin-Fabric/releases/tag/v0.1.0
