/** Keyboard shortcuts. */
import {
  state, setTool, setView, undo, redo, focusOn, toast, clearHighlight, clearSelection,
} from '../core/store.js';
import * as A from '../model/actions.js';
import { isDialogOpen } from './dialogs.js';

export const SHORTCUTS = [
  ['A', 'Add equipment (focus library)'],
  ['C', 'Add cable'],
  ['M', 'Measure'],
  ['W', 'Draw wall (Building mode)'],
  ['B', 'Create room (Building mode)'],
  ['D', 'Add door (Building mode)'],
  ['P', 'Draw cable tray'],
  ['F', 'Focus selection'],
  ['G', 'Toggle grid'],
  ['R', 'Rotate selection 15°'],
  ['X', 'X-ray view'],
  ['H', 'Toggle ceilings'],
  ['L', 'Toggle labels'],
  ['I', 'Isolate current floor'],
  ['Shift+W', 'First-person walkthrough'],
  ['Delete', 'Delete selection'],
  ['Esc', 'Cancel tool / clear selection'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+K or /', 'Search'],
  ['Ctrl+S', 'Save'],
  ['1…5', 'Camera presets'],
];

export function installShortcuts(ctx) {
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); ctx.save(); return; }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); ctx.openSearch(); return; }
    if (mod) return;
    if (isDialogOpen()) return;

    const sel = state.selection[state.selection.length - 1];

    switch (e.key) {
      case '/': e.preventDefault(); ctx.openSearch(); break;
      case 'a': case 'A': ctx.focusLibrary(); break;
      case 'c': case 'C': setTool(state.view.tool === 'cable' ? 'select' : 'cable', { manualRoute: false }); break;
      case 'm': case 'M': setTool(state.view.tool === 'measure' ? 'select' : 'measure'); break;
      case 'w': if (e.shiftKey) ctx.toggleWalk(); else if (state.view.mode === 'building') setTool('wall'); break;
      case 'W': ctx.toggleWalk(); break;
      case 'b': case 'B': if (state.view.mode === 'building') setTool('room'); break;
      case 'd': case 'D': if (state.view.mode === 'building') setTool('door'); break;
      case 'p': case 'P': setTool('pathway'); break;
      case 'f': case 'F': if (sel) focusOn(sel.kind, sel.id); break;
      case 'g': case 'G': setView({ grid: { ...state.view.grid, show: !state.view.grid.show } }); break;
      case 'h': case 'H': setView({ layers: { ...state.view.layers, ceilings: !state.view.layers.ceilings } }); break;
      case 'l': case 'L': setView({ labels: { ...state.view.labels, show: !state.view.labels.show } }); break;
      case 'x': case 'X': setView({ viewMode: state.view.viewMode === 'xray' ? 'normal' : 'xray' }); break;
      case 'i': case 'I':
        if (state.view.activeLevelId) setView({ isolateLevel: !state.view.isolateLevel });
        else toast('Select a floor first.', 'warn');
        break;
      case 'r': case 'R':
        if (sel?.kind === 'device') {
          const d = state.project.devices.find((x) => x.id === sel.id);
          if (d) A.updateEntity('device', d.id, { rotation: (d.rotation || 0) + Math.PI / 12 });
        } else if (sel?.kind === 'rack') {
          const r = state.project.racks.find((x) => x.id === sel.id);
          if (r) A.updateEntity('rack', r.id, { rotation: (r.rotation || 0) + Math.PI / 12 });
        }
        break;
      case 'Delete': case 'Backspace':
        if (sel) { A.deleteEntity(sel.kind, sel.id); clearSelection(); }
        break;
      case 'Escape':
        if (state.highlight.cables.size || state.highlight.devices.size) clearHighlight();
        break;
      case '1': ctx.viewport.setPreset('persp'); ctx.refreshTopbar(); break;
      case '2': ctx.viewport.setPreset('top'); ctx.refreshTopbar(); break;
      case '3': ctx.viewport.setPreset('front'); ctx.refreshTopbar(); break;
      case '4': ctx.viewport.setPreset('side'); ctx.refreshTopbar(); break;
      case '5': ctx.viewport.setPreset('iso'); ctx.refreshTopbar(); break;
      default: break;
    }
  });
}
