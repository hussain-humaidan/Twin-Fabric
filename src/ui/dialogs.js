/** Modals, context menus, toasts and the port picker. */
import { h, clear, btn, badge, checkbox } from './dom.js';
import { CONNECTORS } from '../model/signals.js';
import { cablesOfPort, getCableType } from '../model/queries.js';
import { state } from '../core/store.js';
import { validateConnection } from '../logic/validate.js';

const overlayRoot = () => document.getElementById('overlay-root');
const menuRoot = () => document.getElementById('menu-root');
const toastRoot = () => document.getElementById('toast-root');

/* ---------------- toasts ---------------- */

export function showToast({ message, kind = 'info', ms = 3400 }) {
  const el = h('div', { class: `toast ${kind}`, html: message });
  toastRoot().appendChild(el);
  const t = setTimeout(() => el.remove(), ms);
  el.addEventListener('click', () => { clearTimeout(t); el.remove(); });
}

/* ---------------- dialogs ---------------- */

let openCount = 0;

export function openDialog({ title, body, footer, size = 'md', onClose, tools = null }) {
  const overlay = h('div', { class: 'overlay' });
  const dialog = h('div', { class: `dialog ${size}` });
  const bodyEl = h('div', { class: 'dialog-body' });

  const close = () => {
    overlay.remove();
    openCount--;
    window.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  // Native append() stringifies non-Nodes, so a bare null becomes the text
  // "null" in the dialog. Filter before appending.
  dialog.append(...[
    h('div', { class: 'dialog-head' },
      h('h2', null, title),
      h('button', { class: 'btn ghost', onclick: close, title: 'Close (Esc)' }, '✕')),
    tools ? h('div', { class: 'dialog-tools' }, tools) : null,
    bodyEl,
    footer ? h('div', { class: 'dialog-foot' }, footer) : null,
  ].filter(Boolean));
  if (body) bodyEl.append(...[body].flat().filter(Boolean));
  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlayRoot().appendChild(overlay);
  openCount++;
  window.addEventListener('keydown', onKey, true);

  return { close, bodyEl, dialog, setBody(...c) { clear(bodyEl); bodyEl.append(...c.flat().filter(Boolean)); } };
}

export function isDialogOpen() { return openCount > 0; }

export function confirmDialog(message, { title = 'Confirm', danger = false, confirmLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const d = openDialog({
      title, size: 'sm',
      body: h('div', null, h('p', { style: { margin: '0 0 4px' } }, message)),
      footer: [
        btn('Cancel', () => { d.close(); resolve(false); }),
        btn(confirmLabel, () => { d.close(); resolve(true); }, { class: danger ? 'danger' : 'primary' }),
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog(label, initial = '', { title = 'Rename', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, placeholder });
    const d = openDialog({
      title, size: 'sm',
      body: h('div', { class: 'field wide' }, h('label', null, label), input),
      footer: [
        btn('Cancel', () => { d.close(); resolve(null); }),
        btn('OK', () => { const v = input.value; d.close(); resolve(v); }, { class: 'primary' }),
      ],
      onClose: () => resolve(null),
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = input.value; d.close(); resolve(v); }
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ---------------- context menu ---------------- */

export function contextMenu(x, y, items, { title = null } = {}) {
  closeContextMenu();
  const menu = h('div', { class: 'ctx' });
  if (title) menu.appendChild(h('div', { class: 'ctx-title' }, title));
  for (const it of items) {
    if (it === '-') { menu.appendChild(h('div', { class: 'ctx-sep' })); continue; }
    menu.appendChild(h('div', {
      class: `ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}`,
      onclick: () => { closeContextMenu(); it.onClick?.(); },
    }, h('span', null, it.label), it.key ? h('span', { class: 'k' }, it.key) : null));
  }
  menuRoot().appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  setTimeout(() => {
    window.addEventListener('mousedown', closeContextMenu, { once: true });
    window.addEventListener('blur', closeContextMenu, { once: true });
  }, 0);
}

export function closeContextMenu() { clear(menuRoot()); }

/* ---------------- port picker ---------------- */

/**
 * Choose a port on a device when creating a cable.
 * Shows direction, connector, current occupancy and — when the other end is
 * already known — live validation for every candidate.
 */
export function pickPort(device, role, otherPort = null) {
  return new Promise((resolve) => {
    const p = state.project;
    const wanted = role === 'source' ? ['out', 'bidir'] : ['in', 'bidir'];
    let showAll = false;
    let chosen = null;

    const listEl = h('div', { class: 'ports' });
    const render = () => {
      clear(listEl);
      const ports = device.ports.filter((pt) => showAll || wanted.includes(pt.direction));
      if (!ports.length) {
        listEl.appendChild(h('div', { class: 'empty' }, `No ${role === 'source' ? 'output' : 'input'} ports. Enable "show all" or add a port.`));
        return;
      }
      const groups = new Map();
      for (const pt of ports) {
        const g = pt.group || 'Ports';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(pt);
      }
      for (const [g, list] of groups) {
        listEl.appendChild(h('div', { class: 'hint', style: { margin: '6px 0 3px' } }, g));
        for (const pt of list) {
          const used = cablesOfPort(p, pt.id).filter((c) => c.status !== 'removed');
          let verdict = null;
          if (otherPort) {
            const a = role === 'source' ? { device, port: pt } : { device: otherPort.device, port: otherPort.port ?? otherPort };
            const b = role === 'source' ? { device: otherPort.device, port: otherPort.port ?? otherPort } : { device, port: pt };
            verdict = validateConnection(p, a, b, null);
          }
          const row = h('div', {
            class: `port ${pt.direction}${used.length ? ' linked' : ''}${chosen === pt.id ? ' sel' : ''}`,
            onclick: () => { chosen = pt.id; render(); },
            ondblclick: () => { chosen = pt.id; done(); },
          },
          h('span', { class: 'dir' }, pt.direction === 'out' ? '▶' : pt.direction === 'in' ? '◀' : '⇄'),
          h('span', { class: 'pn' }, pt.name,
            pt.verified === false ? h('span', { class: 'badge ph', style: { marginLeft: '6px' } }, 'PH') : null),
          h('span', { class: 'conn' }, CONNECTORS[pt.connector]?.label || pt.connector),
          verdict
            ? badge(verdict.ok ? (verdict.warnings.length ? 'check' : 'ok') : 'invalid', verdict.ok ? (verdict.warnings.length ? 'warn' : 'ok') : 'err')
            : h('span', { class: 'st', title: used.length ? `${used.length} cable(s)` : 'free' }));
          if (verdict && !verdict.ok) row.title = verdict.errors.join('\n');
          listEl.appendChild(row);
        }
      }
    };

    const done = () => {
      if (!chosen) return;
      d.close();
      resolve(chosen);
    };

    const d = openDialog({
      title: `Select ${role} port — ${device.name}`,
      size: 'sm',
      tools: [
        h('span', { class: 'idtag' }, device.id),
        device.verifiedSpec === false ? badge('PLACEHOLDER SPEC', 'ph') : null,
        h('span', { class: 'grow' }),
        checkbox('Show all ports', showAll, (v) => { showAll = v; render(); }),
      ],
      body: listEl,
      footer: [
        btn('Cancel', () => { d.close(); resolve(null); }),
        btn('Use this port', done, { class: 'primary' }),
      ],
      onClose: () => resolve(null),
    });
    render();
  });
}

/* ---------------- text dump (export) ---------------- */

export function showText(title, text, { filename = null, mime = 'text/plain' } = {}) {
  const ta = h('textarea', { style: { width: '100%', minHeight: '46vh', fontFamily: 'var(--mono)', fontSize: '11px' } });
  ta.value = text;
  ta.addEventListener('keydown', (e) => e.stopPropagation());
  const note = h('div', { class: 'hint', style: { marginBottom: '8px' } },
    'Select all and copy, or use the button below. Some browsers block downloads inside an embedded page — the text above is always available.');
  const d = openDialog({
    title, size: 'md',
    body: [note, ta],
    footer: [
      btn('Copy to clipboard', async () => {
        try {
          await navigator.clipboard.writeText(text);
          showToast({ message: 'Copied to clipboard.', kind: 'ok' });
        } catch {
          ta.select();
          document.execCommand?.('copy');
          showToast({ message: 'Copied (fallback).', kind: 'ok' });
        }
      }, { class: 'primary' }),
      filename ? btn(`Download ${filename}`, () => {
        try {
          const blob = new Blob([text], { type: mime });
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: filename });
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
          showToast({ message: 'Download started (if your browser allows it).', kind: 'info' });
        } catch {
          showToast({ message: 'Download blocked here — copy the text instead.', kind: 'warn' });
        }
      }) : null,
      btn('Close', () => d.close()),
    ],
  });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(0, 0); }, 30);
  return d;
}

export { getCableType };
