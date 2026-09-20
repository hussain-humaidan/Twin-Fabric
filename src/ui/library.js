/**
 * Device library — click a card to arm placement, then click in the 3D view.
 * Cards are also HTML5 drag sources so equipment can be dragged into the model.
 */
import { h, clear, badge } from './dom.js';
import { CATALOG, CATEGORY_ORDER, CATEGORY_COLOR } from '../model/catalog.js';
import { state, bus, EV, setTool, setMode } from '../core/store.js';
import { fuzzyScore } from '../core/util.js';

const BUILDING_TOOLS = [
  { tool: 'wall', label: 'Wall', icon: '│', hint: 'Draw walls point to point' },
  { tool: 'room', label: 'Room', icon: '▢', hint: 'Drag a rectangle — floor, walls, ceiling, room record' },
  { tool: 'hall', label: 'Hall', icon: '▣', hint: 'Drag a large enclosed space' },
  { tool: 'door', label: 'Door', icon: '⌷', hint: 'Cut a door into a wall' },
  { tool: 'window', label: 'Window', icon: '▭', hint: 'Cut a window into a wall' },
  { tool: 'penetration', label: 'Cable hole', icon: '◦', hint: 'Cable penetration — cables may route through it' },
  { tool: 'column', label: 'Column', icon: '▪', hint: 'Structural column — blocks cable routes' },
  { tool: 'pathway', label: 'Cable tray', icon: '═', hint: 'Draw containment the router will prefer' },
];

export function createLibrary(container) {
  let query = '';

  function render() {
    clear(container);
    const mode = state.view.mode;

    const search = h('input', {
      type: 'text', placeholder: 'Filter library…', value: query,
      oninput: (e) => { query = e.target.value; renderBody(); },
    });
    search.addEventListener('keydown', (e) => e.stopPropagation());
    container.appendChild(h('div', { class: 'lib-search' }, search));

    const body = h('div');
    container.appendChild(body);

    function renderBody() {
      clear(body);

      /* ---- building elements (always available, switches to Building mode) ---- */
      body.appendChild(h('div', { class: 'section' },
        h('div', { class: 'section-head', style: { cursor: 'default' } },
          h('h3', null, 'Building elements'),
          mode !== 'building' ? h('span', { class: 'count' }, 'switches mode') : null),
        h('div', { class: 'lib-grid' },
          BUILDING_TOOLS.filter((t) => match(t.label)).map((t) => h('div', {
            class: `lib-item${state.view.tool === t.tool ? ' armed' : ''}`,
            title: t.hint,
            onclick: () => {
              if (state.view.mode !== 'building') setMode('building');
              setTool(state.view.tool === t.tool ? 'select' : t.tool);
            },
          },
          h('div', { class: 'sw', style: { background: '#5b9dd9' } }),
          h('div', { class: 'nm' }, `${t.icon} ${t.label}`))))));

      /* ---- equipment ---- */
      for (const cat of CATEGORY_ORDER) {
        const items = CATALOG.filter((c) => c.category === cat && match(`${c.name} ${c.id} ${c.manufacturer || ''}`));
        if (!items.length) continue;
        body.appendChild(h('div', { class: 'section' },
          h('div', { class: 'section-head', style: { cursor: 'default' } },
            h('h3', null, cat), h('span', { class: 'count' }, String(items.length))),
          h('div', { class: 'lib-grid' }, items.map((item) => card(item)))));
      }

      if (!body.children.length) body.appendChild(h('div', { class: 'empty' }, 'No matches.'));
    }

    function match(text) {
      if (!query.trim()) return true;
      return fuzzyScore(query.trim(), text) > 0;
    }

    function card(item) {
      const armed = state.view.tool === 'device' && state.toolState.templateId === item.id;
      const el = h('div', {
        class: `lib-item${armed ? ' armed' : ''}`,
        draggable: 'true',
        title: `${item.name}\n${item.ports?.length || 0} default ports · ${item.mounting} mounted${item.verifiedSpec === false ? '\nPLACEHOLDER port list — editable' : ''}`,
        onclick: () => {
          if (armed) setTool('select');
          else setTool('device', { templateId: item.id });
        },
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'copy';
          setTool('device', { templateId: item.id });
        },
      },
      h('div', { class: 'sw', style: { background: CATEGORY_COLOR[item.category] || '#8d9aab' } }),
      h('div', { class: 'nm' }, item.name),
      h('div', { class: 'mt' }, item.verifiedSpec === false ? 'PLACEHOLDER' : `${item.mounting}`));
      return el;
    }

    renderBody();
  }

  bus.on(EV.TOOL, render);
  bus.on(EV.VIEW, render);
  render();
  return { render, badge };
}
