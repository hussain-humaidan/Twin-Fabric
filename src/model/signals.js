/**
 * Signal domain: connectors, signal classes and the default cable-type registry.
 *
 * Nothing here is hard-coded into rendering — cable types live on the project
 * document (project.cableTypes) so colours, names and new types are editable
 * at runtime. These are only the factory defaults.
 */

/** Signal classes. A cable carries exactly one; a port may accept several. */
export const SIGNALS = {
  video:   { id: 'video',   label: 'Video',   color: '#6fc2ff' },
  audio:   { id: 'audio',   label: 'Audio',   color: '#7de0a8' },
  network: { id: 'network', label: 'Network', color: '#c6a2ff' },
  power:   { id: 'power',   label: 'Power',   color: '#ff9a52' },
  control: { id: 'control', label: 'Control', color: '#f0e07a' },
  kvm:     { id: 'kvm',     label: 'KVM',     color: '#ff7ec9' },
  data:    { id: 'data',    label: 'Data',    color: '#9fb4c8' },
};
export const SIGNAL_IDS = Object.keys(SIGNALS);

/**
 * Physical connector types.
 * `family` is what actually decides whether two ports can mate.
 * `signals` is what that connector can legitimately carry — used for warnings,
 * not hard errors, because converters and embedded audio blur the lines.
 */
export const CONNECTORS = {
  HDMI:      { id: 'HDMI',      label: 'HDMI',            family: 'hdmi',    signals: ['video', 'audio'] },
  MINIHDMI:  { id: 'MINIHDMI',  label: 'Mini HDMI',       family: 'hdmi',    signals: ['video', 'audio'] },
  DP:        { id: 'DP',        label: 'DisplayPort',     family: 'dp',      signals: ['video', 'audio'] },
  MINIDP:    { id: 'MINIDP',    label: 'Mini DisplayPort',family: 'dp',      signals: ['video', 'audio'] },
  VGA:       { id: 'VGA',       label: 'VGA (DE-15)',     family: 'vga',     signals: ['video'] },
  DVI:       { id: 'DVI',       label: 'DVI',             family: 'dvi',     signals: ['video'] },
  BNC:       { id: 'BNC',       label: 'BNC',             family: 'bnc',     signals: ['video', 'control'] },
  FTYPE:     { id: 'FTYPE',     label: 'F-Type',          family: 'coax-rf', signals: ['video'] },
  RCA:       { id: 'RCA',       label: 'RCA / Phono',     family: 'rca',     signals: ['video', 'audio'] },
  RJ45:      { id: 'RJ45',      label: 'RJ45',            family: 'rj45',    signals: ['network', 'kvm', 'control', 'data'] },
  SFP:       { id: 'SFP',       label: 'SFP/SFP+ cage',   family: 'sfp',     signals: ['network'] },
  LC:        { id: 'LC',        label: 'LC (fibre)',      family: 'fibre-lc',signals: ['network', 'video'] },
  SC:        { id: 'SC',        label: 'SC (fibre)',      family: 'fibre-sc',signals: ['network'] },
  XLR3M:     { id: 'XLR3M',     label: 'XLR 3-pin male',  family: 'xlr',     signals: ['audio'] },
  XLR3F:     { id: 'XLR3F',     label: 'XLR 3-pin female',family: 'xlr',     signals: ['audio'] },
  TRS:       { id: 'TRS',       label: 'TRS 6.35 / 3.5',  family: 'trs',     signals: ['audio'] },
  SPEAKON:   { id: 'SPEAKON',   label: 'speakON',         family: 'speakon', signals: ['audio'] },
  TOSLINK:   { id: 'TOSLINK',   label: 'TOSLINK',         family: 'toslink', signals: ['audio'] },
  USBA:      { id: 'USBA',      label: 'USB-A',           family: 'usb',     signals: ['data', 'kvm'] },
  USBB:      { id: 'USBB',      label: 'USB-B',           family: 'usb',     signals: ['data', 'kvm'] },
  USBC:      { id: 'USBC',      label: 'USB-C',           family: 'usb',     signals: ['data', 'video', 'kvm'] },
  IEC_C13:   { id: 'IEC_C13',   label: 'IEC C13 (outlet)',family: 'iec',     signals: ['power'] },
  IEC_C14:   { id: 'IEC_C14',   label: 'IEC C14 (inlet)', family: 'iec',     signals: ['power'] },
  SCHUKO:    { id: 'SCHUKO',    label: 'Mains socket',    family: 'mains',   signals: ['power'] },
  TERMINAL:  { id: 'TERMINAL',  label: 'Terminal / gland',family: 'terminal',signals: ['power'] },
  DC_BARREL: { id: 'DC_BARREL', label: 'DC barrel',       family: 'dc',      signals: ['power'] },
  PHOENIX:   { id: 'PHOENIX',   label: 'Phoenix / euroblock', family: 'phoenix', signals: ['audio', 'control', 'power'] },
  DB9:       { id: 'DB9',       label: 'DE-9 (RS-232)',   family: 'db9',     signals: ['control'] },
  CUSTOM:    { id: 'CUSTOM',    label: 'Custom / unknown',family: 'custom',  signals: SIGNAL_IDS.slice() },
};
export const CONNECTOR_IDS = Object.keys(CONNECTORS);

/** Families that may legitimately mate even though their ids differ. */
const FAMILY_BRIDGES = [
  ['fibre-lc', 'sfp'],   // an LC patch lead plugs into an SFP module
  ['fibre-sc', 'sfp'],
  ['iec', 'mains'],      // a C13 lead into a wall socket via moulded plug
];

export function familiesCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === 'custom' || b === 'custom') return true;
  return FAMILY_BRIDGES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

export function connectorFamily(connectorId) {
  return CONNECTORS[connectorId]?.family || 'custom';
}

export const DIRECTIONS = { in: 'in', out: 'out', bidir: 'bidir' };

/* ------------------------------------------------------------------ */
/* default cable-type registry                                         */
/* ------------------------------------------------------------------ */

/**
 * @typedef CableType
 * @property {string} id
 * @property {string} name
 * @property {string} signal            one of SIGNAL_IDS
 * @property {string} family            connector family this cable terminates in
 * @property {string} color             render + legend colour (editable)
 * @property {string} category          grouping for the filter UI
 * @property {number} diameter          metres, used for tray fill calculations
 * @property {number|null} maxLength    metres, soft limit → warning
 * @property {number} slack             default extra length factor (1.0 = none)
 */
export const DEFAULT_CABLE_TYPES = [
  { id: 'CT-AC',     name: 'AC Power',        signal: 'power',   family: 'iec',      color: '#ff8a3d', category: 'Electrical', diameter: 0.0085, maxLength: null, slack: 1.08 },
  { id: 'CT-MAINS',  name: 'AC Mains (fixed)',signal: 'power',   family: 'terminal', color: '#d9622b', category: 'Electrical', diameter: 0.0130, maxLength: null, slack: 1.05 },
  { id: 'CT-DC',     name: 'DC Power',        signal: 'power',   family: 'dc',       color: '#ffc46b', category: 'Electrical', diameter: 0.0050, maxLength: 15,   slack: 1.08 },
  { id: 'CT-ETH',    name: 'Ethernet (Cat6)', signal: 'network', family: 'rj45',     color: '#c6a2ff', category: 'Network',    diameter: 0.0060, maxLength: 90,   slack: 1.10 },
  { id: 'CT-FIBRE',  name: 'Fibre (OM4/LC)',  signal: 'network', family: 'fibre-lc', color: '#e0a3ff', category: 'Network',    diameter: 0.0040, maxLength: 400,  slack: 1.10 },
  { id: 'CT-SDI',    name: 'SDI (75Ω coax)',  signal: 'video',   family: 'bnc',      color: '#6fc2ff', category: 'Video',      diameter: 0.0069, maxLength: 100,  slack: 1.07 },
  { id: 'CT-HDMI',   name: 'HDMI',            signal: 'video',   family: 'hdmi',     color: '#4de0d0', category: 'Video',      diameter: 0.0080, maxLength: 15,   slack: 1.07 },
  { id: 'CT-DP',     name: 'DisplayPort',     signal: 'video',   family: 'dp',       color: '#39b6c9', category: 'Video',      diameter: 0.0075, maxLength: 3,    slack: 1.07 },
  { id: 'CT-COAX',   name: 'Coaxial (RF)',    signal: 'video',   family: 'coax-rf',  color: '#8fa8c9', category: 'Video',      diameter: 0.0069, maxLength: null, slack: 1.07 },
  { id: 'CT-COMP',   name: 'Composite / AV',  signal: 'video',   family: 'rca',      color: '#9ecfe8', category: 'Video',      diameter: 0.0050, maxLength: 30,   slack: 1.07 },
  { id: 'CT-XLR',    name: 'XLR (balanced)',  signal: 'audio',   family: 'xlr',      color: '#7de0a8', category: 'Audio',      diameter: 0.0065, maxLength: 100,  slack: 1.09 },
  { id: 'CT-TRS',    name: 'Jack / TRS',      signal: 'audio',   family: 'trs',      color: '#5fc48c', category: 'Audio',      diameter: 0.0050, maxLength: 10,   slack: 1.09 },
  { id: 'CT-SPKR',   name: 'Speaker',         signal: 'audio',   family: 'speakon',  color: '#3fa374', category: 'Audio',      diameter: 0.0105, maxLength: null, slack: 1.09 },
  { id: 'CT-KVM',    name: 'KVM (Cat/CATx)',  signal: 'kvm',     family: 'rj45',     color: '#ff7ec9', category: 'KVM',        diameter: 0.0060, maxLength: 100,  slack: 1.10 },
  { id: 'CT-USB',    name: 'USB',             signal: 'data',    family: 'usb',      color: '#9fb4c8', category: 'Data',       diameter: 0.0045, maxLength: 5,    slack: 1.07 },
  { id: 'CT-CTRL',   name: 'Control (RS-232)',signal: 'control', family: 'db9',      color: '#f0e07a', category: 'Control',    diameter: 0.0050, maxLength: 15,   slack: 1.07 },
  { id: 'CT-CUSTOM', name: 'Custom / other',  signal: 'data',    family: 'custom',   color: '#8d9aab', category: 'Other',      diameter: 0.0060, maxLength: null, slack: 1.07 },
];

export function cableTypeFor(project, id) {
  return project.cableTypes.find((t) => t.id === id) || null;
}

/** Cable types that can terminate in the given connector family. */
export function cableTypesForFamily(project, family) {
  if (!family) return project.cableTypes;
  const exact = project.cableTypes.filter((t) => familiesCompatible(t.family, family) && t.family !== 'custom');
  const custom = project.cableTypes.filter((t) => t.family === 'custom');
  return [...exact, ...custom];
}

/** Best-guess cable type for a pair of ports (used by the one-click cable tool). */
export function suggestCableType(project, srcPort, dstPort) {
  const fam = connectorFamily(srcPort.connector);
  const famB = connectorFamily(dstPort.connector);
  const candidates = project.cableTypes.filter(
    (t) => familiesCompatible(t.family, fam) && familiesCompatible(t.family, famB)
  );
  if (!candidates.length) return project.cableTypes.find((t) => t.id === 'CT-CUSTOM') || project.cableTypes[0];
  // Prefer a candidate whose signal both ports declare.
  const shared = (srcPort.signals || []).filter((s) => (dstPort.signals || []).includes(s));
  const bySignal = candidates.find((t) => shared.includes(t.signal));
  return bySignal || candidates[0];
}
