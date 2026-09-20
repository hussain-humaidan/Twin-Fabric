# Contributing to Twinfabric

Thanks for considering it. This document covers how the project is put
together, how to run it, and the three things most contributions turn out to
be: a new device, a new cable type, or a new building template.

## Development setup

```bash
git clone https://github.com/hussain-humaidan/Twin-Fabric
cd Twin-Fabric
npm install
npm run dev          # http://localhost:8123
```

Checks, all of which CI runs:

```bash
npm run lint
npm run typecheck
npm run test
npm run check        # all three
```

### Running with no toolchain at all

Twinfabric deliberately still works with nothing installed. `index.html`
carries an import map pointing `three` at a CDN, so any static file server
runs the app straight from a checkout:

```bash
python -m http.server 8080
# or, on Windows with nothing installed at all:
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Vite rewrites bare specifiers before the browser consults the import map, so
both paths coexist. **Please do not break the zero-install path.** A lot of the
people this tool is for work on locked-down facilities machines.

## Code structure

Dependencies flow one way: `core → model → logic → three/ui`.

| Directory | Rule |
| --- | --- |
| `src/core` | Maths, state container, utilities. No Three.js, no DOM. |
| `src/model` | The twin: schema, catalog, queries, actions, templates. **No Three.js, no DOM.** |
| `src/logic` | Engineering: geometry, collision, routing, tracing, validation. **Pure functions.** |
| `src/three` | Rendering only. Reads the model, never mutates it. |
| `src/ui` | DOM only. All mutations go through `src/model/actions.js`. |
| `src/persist` | Storage, container format, CSV. |

Two rules matter more than the rest:

1. **Nothing in `core`, `model`, `logic` or `persist` may import Three.js or
   touch the DOM.** That is what keeps the engine testable and what makes a
   future React Three Fiber view layer a view-layer-only change.
2. **The UI never mutates the document directly.** Every change goes through an
   action in `src/model/actions.js`, which snapshots for undo and declares
   which render scopes it invalidates.

## Adding a device

Devices are data. Add an entry to `CATALOG` in
[`src/model/catalog.js`](src/model/catalog.js):

```js
{
  id: 'acme-switch-24',
  name: 'Acme 24-port switch',
  idPrefix: 'SW',
  category: 'Network',
  shape: 'box',
  size: { w: 0.44, h: 0.044, d: 0.3 },   // metres
  mounting: 'rack',
  rackUnits: 1,
  verifiedSpec: true,                     // false if the ports are a guess
  portGenerator: {                        // for repeated ports
    count: 24,
    template: { name: 'GE', connector: 'RJ45', direction: 'bidir', signals: ['network'] },
  },
  ports: [
    p('SFP+ 1', 'SFP', 'bidir', ['network'], { group: 'Uplink' }),
    AC_IN(),
  ],
}
```

**If you do not know the real port list, set `verifiedSpec: false`.** The UI
badges those devices as PLACEHOLDER and the audit lists them. An honest
placeholder is useful; an invented spec is a liability, because somebody will
order cable against it.

For a converter, declare the internal signal continuity so path tracing can
cross it:

```js
passthrough: 'declared',
linkByName: [['SDI IN', 'HDMI OUT']],
```

## Adding a cable type

Add to `DEFAULT_CABLE_TYPES` in [`src/model/signals.js`](src/model/signals.js).
`family` is what decides compatibility — two ports mate when their connector
families match, and a cable fits when its family matches both ends.

```js
{
  id: 'CT-DANTE', name: 'Dante (Cat6A)', signal: 'audio', family: 'rj45',
  color: '#7de0a8', category: 'Audio',
  diameter: 0.0065,      // metres, used for tray fill
  maxLength: 100,        // soft limit -> warning, not an error
  slack: 1.10,
}
```

If your connector is not in `CONNECTORS`, add it there first. Add a
`FAMILY_BRIDGES` entry only for pairs that genuinely mate physically.

## Adding a building template

Write a module in `src/model/templates/` exporting `build(ids, opts)` that
returns a project document, then add one entry to the registry in
[`src/model/templates/index.js`](src/model/templates/index.js).

Use the constructors in [`src/model/buildingKit.js`](src/model/buildingKit.js)
rather than making geometry by hand — `addLevelFromRects` handles the wall
network (shared walls, split junctions), ceilings and spaces in one call.

Mark every dimension you are not certain about: set `placeholder: true` on the
entity and add a line to `project.placeholders`.

## Tests

```bash
npm run test
```

Tests live in `tests/` and cover the pure layers, which is where the
engineering risk is:

| File | Covers |
| --- | --- |
| `geometry.test.js` | wall segmentation around openings, stairs, polygons, wall networks, room detection |
| `collision.test.js` | wall/slab/column crossings, opening apertures, walkthrough collision |
| `routing.test.js` | pathway preference, legality of generated routes, cable length, containment detection |
| `connections.test.js` | connector compatibility, direction rules, tracing through converters, project audit |
| `persistence.test.js` | container format, schema migration, CSV schedules |

Anything touching `src/three` or `src/ui` needs a browser and is not covered
yet; a headless harness is on the roadmap. If you change rendering, say what
you checked by hand in the PR.

**A new engineering rule needs a test.** Routing, collision and validation are
the parts people will trust with real cable orders.

## TypeScript migration

The codebase is JSDoc-annotated JavaScript. `tsconfig.json` has
`checkJs: false` on purpose — flipping it on in one go blocks CI on day one.
The path is:

1. `src/types/twinfabric.d.ts` declares the domain model — **done**.
2. Add `// @ts-check` to individual files and fix what it reports, innermost
   layer first: `core` → `model` → `logic` → `persist` → `three` → `ui`.
3. Rename to `.ts` once a directory is clean.

Pull requests that convert one module and leave it type-clean are very welcome.
A single PR that rewrites everything is not.

## Pull requests

- One logical change per PR.
- `npm run check` passes.
- Say what you tested by hand if it touches rendering or interaction.
- Screenshots or a short clip for anything visual.

By submitting a contribution you agree it is licensed under the project's
licence, the [GNU AGPL v3.0](LICENSE). There is no CLA.

Worth knowing if you plan to deploy a fork: the AGPL's §13 network clause
means that if you modify Twinfabric and let others use it over a network, you
have to offer them the source of your modified version.

## Reporting issues

Include: what you did, what you expected, what happened, browser and OS. For
anything involving geometry or routing, **export the project**
(Project ▸ Export project) and attach it — it is a single JSON file and it makes
the problem reproducible in seconds.

Do not attach a real building's infrastructure export to a public issue if it
contains information you would not publish. See [SECURITY.md](SECURITY.md).
