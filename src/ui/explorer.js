/**
 * Building explorer — the floor / room / equipment tree.
 * Clicking a level isolates and frames it; clicking a room focuses the camera.
 */
import { h, clear, badge, btn } from './dom.js';
import { state, bus, EV, select, setView, focusOn, isSelected } from '../core/store.js';
import {
  spacesOfLevel, devicesInSpace, levelOrder, spaceArea, getLevel,
} from '../model/queries.js';
import { fmtArea } from '../core/util.js';

const KIND_ICON = {
  hall: '▣', room: '▢', 'clerk-room': '▢', corridor: '═', lobby: '◫',
  stair: '⌆', shaft: '║', plant: '⚙', 'roof-zone': '◻', external: '◌',
};
const GROUP_LABEL = { clerks: 'Clerks area' };

export function createExplorer(container) {
  const collapsed = new Set();      // node keys that are collapsed
  const showDevices = { value: true };

  function toggle(key, render) {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    render();
  }

  function row({ key, depth, icon, name, code, selected, onClick, onContext, expandable, extra, dim }) {
    const el = h('div', {
      class: `tree-row${selected ? ' sel' : ''}${dim ? ' off' : ''}`,
      style: { paddingLeft: `${4 + depth * 12}px` },
      onclick: onClick,
      oncontextmenu: (e) => { e.preventDefault(); onContext?.(e); },
    },
    h('span', {
      class: 'tw',
      onclick: expandable ? (e) => { e.stopPropagation(); expandable(); } : null,
    }, expandable ? (collapsed.has(key) ? '▶' : '▼') : ''),
    h('span', { class: 'ic' }, icon),
    h('span', { class: 'nm', title: name }, name),
    code ? h('span', { class: 'cd' }, code) : null,
    extra || null);
    return el;
  }

  function render() {
    const p = state.project;
    if (!p) return;
    clear(container);

    const head = h('div', { class: 'lib-search' },
      h('div', { class: 'row' },
        h('span', { class: 'grow', style: { fontSize: '11px', color: 'var(--muted)' } }, p.building.name),
        btn(showDevices.value ? 'Hide equipment' : 'Show equipment', () => {
          showDevices.value = !showDevices.value; render();
        }, { class: 'sm ghost' })));
    container.appendChild(head);

    const tree = h('div', { class: 'tree' });
    container.appendChild(tree);

    for (const level of levelOrder(p)) {
      const lkey = `L:${level.id}`;
      const st = state.view.levelState[level.id] || 'visible';
      const eye = h('span', {
        class: 'eye',
        title: `Visibility: ${st} — click to cycle visible → ghost → hidden`,
        onclick: (e) => {
          e.stopPropagation();
          const next = st === 'visible' ? 'ghost' : st === 'ghost' ? 'hidden' : 'visible';
          setView({ levelState: { ...state.view.levelState, [level.id]: next } });
        },
      }, st === 'visible' ? '◉' : st === 'ghost' ? '◎' : '○');

      tree.appendChild(row({
        key: lkey, depth: 0, icon: '▤',
        name: level.name,
        code: `${level.elevation.toFixed(2)} m`,
        selected: isSelected('level', level.id),
        dim: st === 'hidden',
        expandable: () => toggle(lkey, render),
        extra: eye,
        onClick: () => {
          select('level', level.id);
          setView({ activeLevelId: level.id });
          focusOn('level', level.id);
        },
        onContext: (e) => bus.emit('ctx:level', { x: e.clientX, y: e.clientY, levelId: level.id }),
      }));
      if (collapsed.has(lkey)) continue;

      /* group spaces: ungrouped first, then named groups */
      const spaces = spacesOfLevel(p, level.id);
      const groups = new Map();
      for (const s of spaces) {
        const g = s.group || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(s);
      }
      const order = ['hall', 'room', 'clerk-room', 'lobby', 'corridor', 'plant', 'stair', 'shaft', 'roof-zone', 'external'];
      const sortSpaces = (list) => list.slice().sort((a, b) => {
        const d = order.indexOf(a.kind) - order.indexOf(b.kind);
        return d !== 0 ? d : (a.code || a.name).localeCompare(b.code || b.name, undefined, { numeric: true });
      });

      const renderSpace = (s, depth) => {
        const devices = devicesInSpace(p, s.id);
        const skey = `S:${s.id}`;
        tree.appendChild(row({
          key: skey, depth, icon: KIND_ICON[s.kind] || '▢',
          name: s.name, code: s.code,
          selected: isSelected('space', s.id),
          expandable: showDevices.value && devices.length ? () => toggle(skey, render) : null,
          extra: devices.length ? h('span', { class: 'cd' }, String(devices.length)) : null,
          onClick: () => { select('space', s.id); focusOn('space', s.id); },
          onContext: (e) => bus.emit('ctx:space', { x: e.clientX, y: e.clientY, spaceId: s.id }),
        }));
        if (!showDevices.value || collapsed.has(skey)) return;
        for (const d of devices) {
          tree.appendChild(row({
            key: `D:${d.id}`, depth: depth + 1, icon: '·',
            name: d.name, code: d.id,
            selected: isSelected('device', d.id),
            dim: d.status === 'planned' || d.status === 'removed',
            onClick: () => { select('device', d.id); focusOn('device', d.id); },
            onContext: (e) => bus.emit('ctx:device', { x: e.clientX, y: e.clientY, deviceId: d.id }),
          }));
        }
      };

      for (const s of sortSpaces(groups.get('') || [])) renderSpace(s, 1);

      for (const [g, list] of groups) {
        if (!g) continue;
        const gkey = `G:${level.id}:${g}`;
        tree.appendChild(row({
          key: gkey, depth: 1, icon: '▦',
          name: GROUP_LABEL[g] || g, code: `${list.length}`,
          expandable: () => toggle(gkey, render),
          onClick: () => toggle(gkey, render),
        }));
        if (collapsed.has(gkey)) continue;
        for (const s of sortSpaces(list)) renderSpace(s, 2);
      }

      /* racks + pathways on this level */
      const racks = p.racks.filter((r) => r.levelId === level.id);
      if (racks.length) {
        const rkey = `R:${level.id}`;
        tree.appendChild(row({
          key: rkey, depth: 1, icon: '▥', name: 'Racks', code: String(racks.length),
          expandable: () => toggle(rkey, render), onClick: () => toggle(rkey, render),
        }));
        if (!collapsed.has(rkey)) {
          for (const r of racks) {
            tree.appendChild(row({
              key: `RK:${r.id}`, depth: 2, icon: '▥', name: r.name, code: `${r.rackUnits}U`,
              selected: isSelected('rack', r.id),
              onClick: () => { select('rack', r.id); focusOn('rack', r.id); },
            }));
          }
        }
      }
      const paths = p.pathways.filter((pw) => pw.levelId === level.id);
      if (paths.length) {
        const pkey = `P:${level.id}`;
        tree.appendChild(row({
          key: pkey, depth: 1, icon: '═', name: 'Pathways', code: String(paths.length),
          expandable: () => toggle(pkey, render), onClick: () => toggle(pkey, render),
        }));
        if (!collapsed.has(pkey)) {
          for (const pw of paths) {
            tree.appendChild(row({
              key: `PW:${pw.id}`, depth: 2, icon: '═', name: pw.name, code: pw.kind,
              selected: isSelected('pathway', pw.id),
              onClick: () => { select('pathway', pw.id); focusOn('pathway', pw.id); },
            }));
          }
        }
      }
    }

    /* risers that span levels */
    const risers = state.project.pathways.filter((pw) => !pw.levelId);
    if (risers.length) {
      tree.appendChild(row({ key: 'RISERS', depth: 0, icon: '║', name: 'Vertical risers', code: String(risers.length) }));
      for (const pw of risers) {
        tree.appendChild(row({
          key: `PW:${pw.id}`, depth: 1, icon: '║', name: pw.name, code: pw.kind,
          selected: isSelected('pathway', pw.id),
          onClick: () => { select('pathway', pw.id); focusOn('pathway', pw.id); },
        }));
      }
    }

    const lvl = state.view.activeLevelId ? getLevel(p, state.view.activeLevelId) : null;
    if (lvl) {
      const area = spacesOfLevel(p, lvl.id).reduce((s, sp) => s + spaceArea(sp), 0);
      tree.appendChild(h('div', { class: 'hint', style: { padding: '10px 10px 0' } },
        `${lvl.name}: ${spacesOfLevel(p, lvl.id).length} spaces · ${fmtArea(area)}`));
    }
  }

  bus.on(EV.PROJECT, render);
  bus.on(EV.SELECTION, render);
  bus.on(EV.VIEW, render);
  render();

  return { render, badge };
}
