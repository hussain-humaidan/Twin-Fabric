/** Status bar: coordinates, active floor/room, tool, counts, save state. */
import { h, clear } from './dom.js';
import { state, bus, EV, setView } from '../core/store.js';
import { getLevel, getSpace, getDevice } from '../model/queries.js';
import { fmtLen } from '../core/util.js';

export function createStatusbar(container, ctx) {
  let message = null;

  function item(label, value, opts = {}) {
    return h('div', {
      class: `sb-item${opts.onClick ? ' click' : ''}${opts.warn ? ' sb-warn' : ''}`,
      title: opts.title || '',
      onclick: opts.onClick,
    }, label ? h('span', null, label) : null, value != null ? h('b', null, String(value)) : null);
  }

  function render() {
    const p = state.project;
    if (!p) return;
    clear(container);
    const v = state.view;
    const c = state.cursor;

    container.appendChild(item('', `X ${c.x?.toFixed(2) ?? '—'}  Y ${c.y?.toFixed(2) ?? '—'}  Z ${c.z?.toFixed(2) ?? '—'}`,
      { title: 'Cursor position in metres. +X east, +Y up, +Z south.' }));

    const lvl = v.activeLevelId ? getLevel(p, v.activeLevelId) : null;
    container.appendChild(item('Floor', lvl ? lvl.name : 'All floors',
      { onClick: () => setView({ isolateLevel: !v.isolateLevel }), title: 'Click to toggle isolate' }));

    const sp = c.spaceId ? getSpace(p, c.spaceId) : null;
    container.appendChild(item('Room', sp ? (sp.code ? `${sp.code} · ${sp.name}` : sp.name) : '—'));

    container.appendChild(item('Tool', v.tool));
    container.appendChild(item('Grid', `${v.grid.size} m${v.grid.snap ? ' snap' : ''}`,
      { onClick: () => setView({ grid: { ...v.grid, snap: !v.grid.snap } }) }));

    if (v.measure) {
      container.appendChild(item('Distance', fmtLen(v.measure.distance), { title: 'Measurement result' }));
    }

    const sel = state.selection[state.selection.length - 1];
    if (sel) {
      let label = sel.id;
      if (sel.kind === 'device') label = getDevice(p, sel.id)?.name || sel.id;
      if (sel.kind === 'space') label = getSpace(p, sel.id)?.name || sel.id;
      container.appendChild(item(sel.kind, label));
    }

    if (state.highlight.label) {
      container.appendChild(item('Trace', state.highlight.label, {
        onClick: () => ctx.clearHighlight(), title: 'Click to clear the highlight',
      }));
    }

    container.appendChild(h('div', { class: 'sb-item sb-spacer' }));

    const totalLen = p.cables.reduce((s, x) => s + (x.length || 0), 0);
    container.appendChild(item('', `${p.spaces.length} rooms`, { title: 'Rooms and spaces' }));
    container.appendChild(item('', `${p.devices.length} devices`));
    container.appendChild(item('', `${p.cables.length} cables · ${fmtLen(totalLen)}`));

    if (message) container.appendChild(item('', message));

    container.appendChild(item('', state.dirty ? 'unsaved' : 'saved', {
      warn: state.dirty,
      onClick: () => ctx.save(),
      title: state.dirty ? 'Click to save to this browser' : `Last saved ${state.savedAt ? new Date(state.savedAt).toLocaleTimeString() : '—'}`,
    }));
  }

  bus.on(EV.STATUS, (text) => { if (text !== null) message = text; render(); });
  bus.on(EV.VIEW, render);
  bus.on(EV.TOOL, render);
  bus.on(EV.PROJECT, render);
  bus.on(EV.SELECTION, render);
  bus.on(EV.DIRTY, render);
  render();
  return { render };
}
