/**
 * Matam Digital Twin — entry point.
 *
 * Boot order: load (or generate) the project document → put it in the store →
 * build the UI and the 3D scene on top of it.
 *
 * Coordinate system: Y up, +X east, +Z south, 1 unit = 1 metre.
 */
import { setProject, state, bus, EV, setView, toast } from './core/store.js';
import { invalidateIndex } from './model/queries.js';
import { createFromTemplate } from './model/templates/index.js';
import { loadProject, loadViewPrefs, storageBackend } from './persist/io.js';
import { makeIdFactory } from './core/util.js';
import { createApp } from './ui/app.js';
import { PRODUCT, NAMING } from './app.config.js';

function setBootMessage(text, error = false) {
  const el = document.getElementById('boot-sub');
  if (!el) return;
  el.textContent = text;
  el.className = `boot-sub${error ? ' boot-error' : ''}`;
}

async function boot() {
  try {
    setBootMessage('Loading project…');
    const loaded = await loadProject();
    let project = loaded.project;
    const bootWarnings = loaded.warnings || [];
    if (!project) {
      setBootMessage('Generating the building…');
      const ids = makeIdFactory({});
      project = createFromTemplate('matam', ids);
    }

    setProject(project, { label: 'Load' });
    invalidateIndex();

    const prefs = loadViewPrefs();
    if (prefs) setView(prefs, { silent: true });

    setBootMessage('Building the 3D scene…');
    // Let the boot text paint before the heavy scene build — but never depend
    // on rAF alone: it does not fire in a hidden or backgrounded tab, which
    // would leave the app stuck on the splash forever.
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 150);
    });

    const app = createApp();
    window.twinfabric = { state, bus, EV, app, PRODUCT };   // handy for the console
    window.matam = window.twinfabric;                        // legacy alias

    const setTitle = () => { document.title = NAMING.windowTitle(state.project); };
    setTitle();
    bus.on(EV.PROJECT, setTitle);

    for (const w of bootWarnings) toast(w, 'info', 6000);

    console.info(
      `%c${PRODUCT.name} ${PRODUCT.version}%c ready — %d levels, %d spaces, %d walls, %d devices, %d cables. Storage: %s`,
      'color:#ffb02e;font-weight:600', 'color:inherit',
      state.project.levels.length, state.project.spaces.length,
      state.project.walls.length, state.project.devices.length, state.project.cables.length,
      storageBackend()
    );
  } catch (err) {
    console.error(err);
    setBootMessage(`Failed to start: ${err.message}`, true);
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = false;
  }
}

boot();
