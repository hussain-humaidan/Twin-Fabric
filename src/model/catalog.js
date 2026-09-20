/**
 * Device library.
 *
 * IMPORTANT — unverified specifications.
 * Where the real hardware spec is not known (Kiloview N50, the Blackmagic
 * converters, the site's TVs / projectors / PCs / KVM), the port list here is
 * a CONFIGURABLE PLACEHOLDER, flagged `verifiedSpec: false` and rendered with a
 * PLACEHOLDER badge in the UI. Ports are fully editable per instance and per
 * template: add, remove, rename, change connector, direction and signal.
 * Nothing in the routing, validation or tracing logic depends on these
 * defaults being correct.
 */
import { makeDevice, makePort } from './schema.js';

/** Port template shorthand. */
const p = (name, connector, direction, signals, opts = {}) => ({
  name, connector, direction, signals, verified: false, ...opts,
});

const AC_IN = (n = 'AC IN') => p(n, 'IEC_C14', 'in', ['power'], { group: 'Power' });
const AC_OUT = (n = 'AC OUT') => p(n, 'IEC_C13', 'out', ['power'], { group: 'Power' });
const DC_IN = (n = 'DC IN') => p(n, 'DC_BARREL', 'in', ['power'], { group: 'Power' });
const ETH = (n = 'ETH 1') => p(n, 'RJ45', 'bidir', ['network'], { group: 'Network' });

/**
 * @typedef CatalogItem
 * @property {string} id        stable template id, stored on every device
 * @property {string} idPrefix  human-readable entity id prefix (TV-001…)
 * @property {string} category  library group
 * @property {string} shape     box | cylinder | panel
 * @property {boolean} verifiedSpec  false ⇒ ports are placeholders
 */
export const CATALOG = [
  /* ---------------- Displays ---------------- */
  {
    id: 'tv', name: 'TV / Display', idPrefix: 'TV', category: 'Displays', icon: '▭',
    shape: 'panel', size: { w: 1.24, h: 0.72, d: 0.07 }, color: '#2b3138',
    mounting: 'wall', verifiedSpec: false,
    ports: [
      p('HDMI IN 1', 'HDMI', 'in', ['video', 'audio'], { group: 'Video' }),
      p('HDMI IN 2', 'HDMI', 'in', ['video', 'audio'], { group: 'Video' }),
      p('AUDIO OUT', 'TRS', 'out', ['audio'], { group: 'Audio' }),
      ETH(), AC_IN(),
    ],
    attributes: { resolution: '', diagonal: '', orientation: 'landscape' },
  },
  {
    id: 'monitor', name: 'Monitor', idPrefix: 'MON', category: 'Displays', icon: '▭',
    shape: 'panel', size: { w: 0.62, h: 0.38, d: 0.06 }, color: '#2b3138',
    mounting: 'desk', verifiedSpec: false,
    ports: [
      p('HDMI IN', 'HDMI', 'in', ['video', 'audio'], { group: 'Video' }),
      p('DP IN', 'DP', 'in', ['video', 'audio'], { group: 'Video' }),
      AC_IN(),
    ],
  },
  {
    id: 'projector', name: 'Projector', idPrefix: 'PRJ', category: 'Displays', icon: '◹',
    shape: 'box', size: { w: 0.4, h: 0.16, d: 0.34 }, color: '#d8dce2',
    mounting: 'ceiling', verifiedSpec: false,
    ports: [
      p('HDMI IN 1', 'HDMI', 'in', ['video', 'audio'], { group: 'Video' }),
      p('HDMI IN 2', 'HDMI', 'in', ['video', 'audio'], { group: 'Video' }),
      p('VGA IN', 'VGA', 'in', ['video'], { group: 'Video' }),
      p('RS-232', 'DB9', 'bidir', ['control'], { group: 'Control' }),
      ETH(), AC_IN(),
    ],
    attributes: { lumens: '', throwRatio: '' },
  },
  {
    id: 'screen', name: 'Projector screen', idPrefix: 'SCR', category: 'Displays', icon: '▤',
    shape: 'panel', size: { w: 3.0, h: 1.8, d: 0.08 }, color: '#e8e8e4',
    mounting: 'ceiling', verifiedSpec: true,
    ports: [p('TRIGGER', 'PHOENIX', 'in', ['control'], { group: 'Control' }), AC_IN()],
  },
  {
    id: 'camera', name: 'Camera', idPrefix: 'CAM', category: 'Displays', icon: '◉',
    shape: 'cylinder', size: { w: 0.14, h: 0.14, d: 0.22 }, color: '#3c4350',
    mounting: 'wall', verifiedSpec: false,
    ports: [
      p('SDI OUT', 'BNC', 'out', ['video'], { group: 'Video' }),
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      ETH(), DC_IN(),
    ],
    attributes: { ip: '', resolution: '' },
  },

  /* ---------------- Computing ---------------- */
  {
    id: 'pc', name: 'Desktop PC', idPrefix: 'PC', category: 'Computing', icon: '▢',
    shape: 'box', size: { w: 0.2, h: 0.45, d: 0.45 }, color: '#353c46',
    mounting: 'floor', verifiedSpec: false,
    ports: [
      p('HDMI OUT 1', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      p('HDMI OUT 2', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      p('DP OUT 1', 'DP', 'out', ['video', 'audio'], { group: 'Video' }),
      p('USB 1', 'USBA', 'out', ['data', 'kvm'], { group: 'Data' }),
      p('USB 2', 'USBA', 'out', ['data', 'kvm'], { group: 'Data' }),
      p('AUDIO OUT', 'TRS', 'out', ['audio'], { group: 'Audio' }),
      ETH(), AC_IN(),
    ],
    attributes: { hostname: '', ip: '', mac: '', os: '', vlan: '' },
  },
  {
    id: 'laptop', name: 'Laptop', idPrefix: 'LAP', category: 'Computing', icon: '▭',
    shape: 'box', size: { w: 0.36, h: 0.03, d: 0.25 }, color: '#454c57',
    mounting: 'desk', verifiedSpec: false,
    ports: [
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      p('USB-C', 'USBC', 'bidir', ['data', 'video'], { group: 'Data' }),
      ETH(), DC_IN(),
    ],
    attributes: { hostname: '', ip: '', mac: '', os: '' },
  },
  {
    id: 'minipc', name: 'Mini PC', idPrefix: 'MPC', category: 'Computing', icon: '▢',
    shape: 'box', size: { w: 0.18, h: 0.05, d: 0.18 }, color: '#3a414b',
    mounting: 'wall', verifiedSpec: false,
    ports: [
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      p('DP OUT', 'DP', 'out', ['video', 'audio'], { group: 'Video' }),
      ETH(), DC_IN(),
    ],
    attributes: { hostname: '', ip: '', mac: '', os: '' },
  },
  {
    id: 'server', name: 'Server', idPrefix: 'SRV', category: 'Computing', icon: '▤',
    shape: 'box', size: { w: 0.48, h: 0.088, d: 0.7 }, color: '#2f353e',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    ports: [
      ETH('ETH 1'), ETH('ETH 2'),
      p('SFP+ 1', 'SFP', 'bidir', ['network'], { group: 'Network' }),
      p('IPMI', 'RJ45', 'bidir', ['network'], { group: 'Network' }),
      AC_IN('PSU 1'), AC_IN('PSU 2'),
    ],
    attributes: { hostname: '', ip: '', mac: '', os: '' },
  },
  {
    id: 'workstation', name: 'Workstation', idPrefix: 'WKS', category: 'Computing', icon: '▢',
    shape: 'box', size: { w: 0.22, h: 0.5, d: 0.5 }, color: '#30363f',
    mounting: 'floor', verifiedSpec: false,
    ports: [
      p('DP OUT 1', 'DP', 'out', ['video', 'audio'], { group: 'Video' }),
      p('DP OUT 2', 'DP', 'out', ['video', 'audio'], { group: 'Video' }),
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Video' }),
      p('SDI OUT', 'BNC', 'out', ['video'], { group: 'Video' }),
      ETH(), AC_IN(),
    ],
    attributes: { hostname: '', ip: '', mac: '', os: '' },
  },
  {
    id: 'nas', name: 'NAS', idPrefix: 'NAS', category: 'Computing', icon: '▤',
    shape: 'box', size: { w: 0.23, h: 0.17, d: 0.23 }, color: '#2f353e',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    ports: [ETH('LAN 1'), ETH('LAN 2'), AC_IN()],
    attributes: { hostname: '', ip: '', capacity: '' },
  },

  /* ---------------- Network ---------------- */
  {
    id: 'switch', name: 'Network switch', idPrefix: 'SW', category: 'Network', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.3 }, color: '#2a3038',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    portGenerator: { count: 24, template: { name: 'GE', connector: 'RJ45', direction: 'bidir', signals: ['network'], group: 'Access' } },
    ports: [
      p('SFP+ 1', 'SFP', 'bidir', ['network'], { group: 'Uplink' }),
      p('SFP+ 2', 'SFP', 'bidir', ['network'], { group: 'Uplink' }),
      p('CONSOLE', 'DB9', 'bidir', ['control'], { group: 'Control' }),
      AC_IN(),
    ],
    attributes: { hostname: '', ip: '', mgmtVlan: '', portCount: '24' },
  },
  {
    id: 'fibre-switch', name: 'Fibre switch', idPrefix: 'FSW', category: 'Network', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.3 }, color: '#2a3038',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    portGenerator: { count: 12, template: { name: 'SFP', connector: 'SFP', direction: 'bidir', signals: ['network'], group: 'Fibre' } },
    ports: [ETH('MGMT'), AC_IN()],
    attributes: { hostname: '', ip: '' },
  },
  {
    id: 'router', name: 'Router / firewall', idPrefix: 'RTR', category: 'Network', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.28 }, color: '#2a3038',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    ports: [ETH('WAN'), ETH('LAN 1'), ETH('LAN 2'), ETH('LAN 3'), p('SFP', 'SFP', 'bidir', ['network'], { group: 'Uplink' }), AC_IN()],
    attributes: { hostname: '', ip: '' },
  },
  {
    id: 'ap', name: 'Access point', idPrefix: 'AP', category: 'Network', icon: '◎',
    shape: 'cylinder', size: { w: 0.22, h: 0.05, d: 0.22 }, color: '#d5d9de',
    mounting: 'ceiling', verifiedSpec: false,
    ports: [p('LAN (PoE)', 'RJ45', 'bidir', ['network', 'power'], { group: 'Network' })],
    attributes: { hostname: '', ip: '', ssid: '' },
  },
  {
    id: 'patch-panel', name: 'Patch panel', idPrefix: 'PP', category: 'Network', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.12 }, color: '#343b45',
    mounting: 'rack', rackUnits: 1, verifiedSpec: true,
    portGenerator: { count: 24, template: { name: 'P', connector: 'RJ45', direction: 'bidir', signals: ['network', 'kvm'], group: 'Patch', exclusive: true } },
    ports: [],
    passthrough: 'none',
  },

  /* ---------------- Video / AV processing ---------------- */
  {
    id: 'kiloview-n50', name: 'Kiloview N50', idPrefix: 'KLV', category: 'Video', icon: '▣',
    shape: 'box', size: { w: 0.17, h: 0.045, d: 0.12 }, color: '#1f2a36',
    manufacturer: 'Kiloview', model: 'N50', mounting: 'rack', rackUnits: 1,
    verifiedSpec: false,
    specNote: 'Port list is a PLACEHOLDER. Confirm the actual N50 I/O and edit these ports.',
    ports: [
      p('SDI IN 1', 'BNC', 'in', ['video'], { group: 'SDI' }),
      p('SDI OUT 1', 'BNC', 'out', ['video'], { group: 'SDI' }),
      p('HDMI IN 1', 'HDMI', 'in', ['video', 'audio'], { group: 'HDMI' }),
      p('HDMI OUT 1', 'HDMI', 'out', ['video', 'audio'], { group: 'HDMI' }),
      ETH('ETH 1 (NDI)'), DC_IN(),
    ],
    attributes: { ip: '', mode: '', ndiName: '' },
  },
  {
    id: 'bmd-sdi-hdmi', name: 'Blackmagic SDI → HDMI', idPrefix: 'BMD', category: 'Video', icon: '▸',
    shape: 'box', size: { w: 0.1, h: 0.032, d: 0.075 }, color: '#1d2733',
    manufacturer: 'Blackmagic Design', mounting: 'rack', rackUnits: 1,
    verifiedSpec: false,
    specNote: 'Converter I/O is a PLACEHOLDER — confirm the exact model and edit.',
    ports: [
      p('SDI IN', 'BNC', 'in', ['video'], { group: 'Input' }),
      p('SDI LOOP OUT', 'BNC', 'out', ['video'], { group: 'Input', exclusive: false }),
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Output' }),
      p('AUDIO OUT L', 'TRS', 'out', ['audio'], { group: 'Output' }),
      DC_IN(),
    ],
    passthrough: 'declared',
    // Signal direction is explicit: this device converts SDI IN → HDMI OUT.
    linkByName: [['SDI IN', 'HDMI OUT'], ['SDI IN', 'SDI LOOP OUT'], ['SDI IN', 'AUDIO OUT L']],
  },
  {
    id: 'bmd-hdmi-sdi', name: 'Blackmagic HDMI → SDI', idPrefix: 'BMD', category: 'Video', icon: '▸',
    shape: 'box', size: { w: 0.1, h: 0.032, d: 0.075 }, color: '#1d2733',
    manufacturer: 'Blackmagic Design', mounting: 'rack', rackUnits: 1,
    verifiedSpec: false,
    specNote: 'Converter I/O is a PLACEHOLDER — confirm the exact model and edit.',
    ports: [
      p('HDMI IN', 'HDMI', 'in', ['video', 'audio'], { group: 'Input' }),
      p('SDI OUT 1', 'BNC', 'out', ['video'], { group: 'Output' }),
      p('SDI OUT 2', 'BNC', 'out', ['video'], { group: 'Output' }),
      DC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['HDMI IN', 'SDI OUT 1'], ['HDMI IN', 'SDI OUT 2']],
  },
  {
    id: 'bmd-sdi-av', name: 'Blackmagic SDI → AV', idPrefix: 'BMD', category: 'Video', icon: '▸',
    shape: 'box', size: { w: 0.1, h: 0.032, d: 0.075 }, color: '#1d2733',
    manufacturer: 'Blackmagic Design', mounting: 'rack', rackUnits: 1,
    verifiedSpec: false,
    specNote: 'Converter I/O is a PLACEHOLDER — confirm the exact model and edit.',
    ports: [
      p('SDI IN', 'BNC', 'in', ['video'], { group: 'Input' }),
      p('SDI LOOP OUT', 'BNC', 'out', ['video'], { group: 'Input', exclusive: false }),
      p('COMPOSITE OUT', 'RCA', 'out', ['video'], { group: 'Output' }),
      p('AUDIO OUT L', 'RCA', 'out', ['audio'], { group: 'Output' }),
      p('AUDIO OUT R', 'RCA', 'out', ['audio'], { group: 'Output' }),
      DC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['SDI IN', 'COMPOSITE OUT'], ['SDI IN', 'SDI LOOP OUT'], ['SDI IN', 'AUDIO OUT L'], ['SDI IN', 'AUDIO OUT R']],
  },
  {
    id: 'sdi-da', name: 'SDI distribution', idPrefix: 'SDA', category: 'Video', icon: '⑂',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.2 }, color: '#232d39',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    ports: [
      p('SDI IN', 'BNC', 'in', ['video'], { group: 'Input' }),
      p('SDI OUT 1', 'BNC', 'out', ['video'], { group: 'Output' }),
      p('SDI OUT 2', 'BNC', 'out', ['video'], { group: 'Output' }),
      p('SDI OUT 3', 'BNC', 'out', ['video'], { group: 'Output' }),
      p('SDI OUT 4', 'BNC', 'out', ['video'], { group: 'Output' }),
      AC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['SDI IN', 'SDI OUT 1'], ['SDI IN', 'SDI OUT 2'], ['SDI IN', 'SDI OUT 3'], ['SDI IN', 'SDI OUT 4']],
  },
  {
    id: 'hdmi-da', name: 'HDMI distribution', idPrefix: 'HDA', category: 'Video', icon: '⑂',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.2 }, color: '#232d39',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    ports: [
      p('HDMI IN', 'HDMI', 'in', ['video', 'audio'], { group: 'Input' }),
      p('HDMI OUT 1', 'HDMI', 'out', ['video', 'audio'], { group: 'Output' }),
      p('HDMI OUT 2', 'HDMI', 'out', ['video', 'audio'], { group: 'Output' }),
      p('HDMI OUT 3', 'HDMI', 'out', ['video', 'audio'], { group: 'Output' }),
      p('HDMI OUT 4', 'HDMI', 'out', ['video', 'audio'], { group: 'Output' }),
      AC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['HDMI IN', 'HDMI OUT 1'], ['HDMI IN', 'HDMI OUT 2'], ['HDMI IN', 'HDMI OUT 3'], ['HDMI IN', 'HDMI OUT 4']],
  },
  {
    id: 'video-matrix', name: 'Video matrix', idPrefix: 'MTX', category: 'Video', icon: '▦',
    shape: 'box', size: { w: 0.44, h: 0.088, d: 0.3 }, color: '#232d39',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    portGenerator: { count: 8, template: { name: 'IN', connector: 'HDMI', direction: 'in', signals: ['video', 'audio'], group: 'Inputs' } },
    ports: [
      p('OUT 1', 'HDMI', 'out', ['video', 'audio'], { group: 'Outputs' }),
      p('OUT 2', 'HDMI', 'out', ['video', 'audio'], { group: 'Outputs' }),
      p('OUT 3', 'HDMI', 'out', ['video', 'audio'], { group: 'Outputs' }),
      p('OUT 4', 'HDMI', 'out', ['video', 'audio'], { group: 'Outputs' }),
      ETH(), AC_IN(),
    ],
  },

  /* ---------------- KVM ---------------- */
  {
    id: 'kvm-switch', name: 'KVM switch', idPrefix: 'KVM', category: 'KVM', icon: '▥',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.2 }, color: '#2d2635',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    ports: [
      p('CPU 1', 'RJ45', 'in', ['kvm'], { group: 'Computers' }),
      p('CPU 2', 'RJ45', 'in', ['kvm'], { group: 'Computers' }),
      p('CPU 3', 'RJ45', 'in', ['kvm'], { group: 'Computers' }),
      p('CPU 4', 'RJ45', 'in', ['kvm'], { group: 'Computers' }),
      p('CONSOLE 1', 'RJ45', 'out', ['kvm'], { group: 'Consoles' }),
      p('CONSOLE 2', 'RJ45', 'out', ['kvm'], { group: 'Consoles' }),
      ETH('MGMT'), AC_IN(),
    ],
    passthrough: 'auto',
  },
  {
    id: 'kvm-console', name: 'KVM console', idPrefix: 'KVMC', category: 'KVM', icon: '▭',
    shape: 'box', size: { w: 0.48, h: 0.044, d: 0.45 }, color: '#2d2635',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    ports: [p('KVM IN', 'RJ45', 'in', ['kvm'], { group: 'KVM' }), AC_IN()],
  },
  {
    id: 'kvm-tx', name: 'KVM extender (TX)', idPrefix: 'KTX', category: 'KVM', icon: '▸',
    shape: 'box', size: { w: 0.11, h: 0.026, d: 0.09 }, color: '#2d2635',
    mounting: 'desk', verifiedSpec: false,
    ports: [
      p('HDMI IN', 'HDMI', 'in', ['video', 'audio'], { group: 'Local' }),
      p('USB IN', 'USBB', 'in', ['data', 'kvm'], { group: 'Local' }),
      p('LINK OUT', 'RJ45', 'out', ['kvm'], { group: 'Link' }),
      DC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['HDMI IN', 'LINK OUT'], ['USB IN', 'LINK OUT']],
  },
  {
    id: 'kvm-rx', name: 'KVM extender (RX)', idPrefix: 'KRX', category: 'KVM', icon: '◂',
    shape: 'box', size: { w: 0.11, h: 0.026, d: 0.09 }, color: '#2d2635',
    mounting: 'desk', verifiedSpec: false,
    ports: [
      p('LINK IN', 'RJ45', 'in', ['kvm'], { group: 'Link' }),
      p('HDMI OUT', 'HDMI', 'out', ['video', 'audio'], { group: 'Local' }),
      p('USB 1', 'USBA', 'out', ['data', 'kvm'], { group: 'Local' }),
      p('USB 2', 'USBA', 'out', ['data', 'kvm'], { group: 'Local' }),
      DC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['LINK IN', 'HDMI OUT'], ['LINK IN', 'USB 1'], ['LINK IN', 'USB 2']],
  },

  /* ---------------- Audio ---------------- */
  {
    id: 'mixer', name: 'Audio mixer', idPrefix: 'MIX', category: 'Audio', icon: '▥',
    shape: 'box', size: { w: 0.44, h: 0.09, d: 0.36 }, color: '#232f2a',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    portGenerator: { count: 8, template: { name: 'MIC/LINE', connector: 'XLR3F', direction: 'in', signals: ['audio'], group: 'Inputs' } },
    ports: [
      p('MAIN OUT L', 'XLR3M', 'out', ['audio'], { group: 'Outputs' }),
      p('MAIN OUT R', 'XLR3M', 'out', ['audio'], { group: 'Outputs' }),
      p('AUX OUT 1', 'XLR3M', 'out', ['audio'], { group: 'Outputs' }),
      AC_IN(),
    ],
  },
  {
    id: 'amplifier', name: 'Amplifier', idPrefix: 'AMP', category: 'Audio', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.088, d: 0.38 }, color: '#232f2a',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    ports: [
      p('IN L', 'XLR3F', 'in', ['audio'], { group: 'Inputs' }),
      p('IN R', 'XLR3F', 'in', ['audio'], { group: 'Inputs' }),
      p('SPK OUT A', 'SPEAKON', 'out', ['audio'], { group: 'Outputs' }),
      p('SPK OUT B', 'SPEAKON', 'out', ['audio'], { group: 'Outputs' }),
      AC_IN(),
    ],
    passthrough: 'declared',
    linkByName: [['IN L', 'SPK OUT A'], ['IN R', 'SPK OUT B']],
  },
  {
    id: 'speaker', name: 'Speaker', idPrefix: 'SPK', category: 'Audio', icon: '◍',
    shape: 'box', size: { w: 0.26, h: 0.4, d: 0.24 }, color: '#20262d',
    mounting: 'wall', verifiedSpec: false,
    ports: [p('SPK IN', 'SPEAKON', 'in', ['audio'], { group: 'Audio' })],
  },
  {
    id: 'microphone', name: 'Microphone', idPrefix: 'MIC', category: 'Audio', icon: '⌶',
    shape: 'cylinder', size: { w: 0.05, h: 0.18, d: 0.05 }, color: '#3a4149',
    mounting: 'desk', verifiedSpec: false,
    ports: [p('XLR OUT', 'XLR3M', 'out', ['audio'], { group: 'Audio' })],
  },
  {
    id: 'xlr-patch', name: 'XLR patch panel', idPrefix: 'XPP', category: 'Audio', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.1 }, color: '#232f2a',
    mounting: 'rack', rackUnits: 1, verifiedSpec: true,
    portGenerator: { count: 8, template: { name: 'XLR', connector: 'XLR3F', direction: 'bidir', signals: ['audio'], group: 'Patch' } },
    ports: [], passthrough: 'none',
  },

  /* ---------------- Power ---------------- */
  {
    id: 'ups', name: 'UPS', idPrefix: 'UPS', category: 'Power', icon: '▣',
    shape: 'box', size: { w: 0.44, h: 0.088, d: 0.5 }, color: '#33291f',
    mounting: 'rack', rackUnits: 2, verifiedSpec: false,
    portGenerator: { count: 8, template: { name: 'OUT', connector: 'IEC_C13', direction: 'out', signals: ['power'], group: 'Outlets' } },
    ports: [p('AC IN', 'IEC_C14', 'in', ['power'], { group: 'Supply' }), ETH('NET CARD')],
    passthrough: 'auto',
    attributes: { capacityVA: '', runtimeMin: '', ip: '' },
  },
  {
    id: 'pdu', name: 'PDU', idPrefix: 'PDU', category: 'Power', icon: '▤',
    shape: 'box', size: { w: 0.44, h: 0.044, d: 0.1 }, color: '#33291f',
    mounting: 'rack', rackUnits: 1, verifiedSpec: false,
    portGenerator: { count: 8, template: { name: 'C13', connector: 'IEC_C13', direction: 'out', signals: ['power'], group: 'Outlets' } },
    ports: [p('AC IN', 'IEC_C14', 'in', ['power'], { group: 'Supply' })],
    passthrough: 'auto',
    attributes: { phases: '1', ratingA: '' },
  },
  {
    id: 'psu', name: 'Power supply (DC)', idPrefix: 'PSU', category: 'Power', icon: '▢',
    shape: 'box', size: { w: 0.11, h: 0.035, d: 0.06 }, color: '#33291f',
    mounting: 'custom', verifiedSpec: false,
    ports: [
      p('AC IN', 'IEC_C14', 'in', ['power'], { group: 'Supply' }),
      p('DC OUT', 'DC_BARREL', 'out', ['power'], { group: 'Output' }),
    ],
    passthrough: 'declared',
    linkByName: [['AC IN', 'DC OUT']],
    attributes: { voltage: '', currentA: '' },
  },
  {
    id: 'distribution-board', name: 'Distribution board', idPrefix: 'DB', category: 'Power', icon: '▦',
    shape: 'box', size: { w: 0.6, h: 0.8, d: 0.16 }, color: '#3a3128',
    mounting: 'wall', verifiedSpec: false,
    portGenerator: { count: 6, template: { name: 'WAY', connector: 'TERMINAL', direction: 'out', signals: ['power'], group: 'Ways' } },
    ports: [p('SUPPLY IN', 'TERMINAL', 'in', ['power'], { group: 'Supply' })],
    passthrough: 'auto',
    attributes: { phases: '3', mainBreakerA: '' },
  },
  {
    id: 'socket', name: 'Socket outlet', idPrefix: 'SKT', category: 'Power', icon: '◫',
    shape: 'panel', size: { w: 0.15, h: 0.1, d: 0.04 }, color: '#e6e6e2',
    mounting: 'wall', verifiedSpec: true,
    ports: [
      p('CIRCUIT IN', 'TERMINAL', 'in', ['power'], { group: 'Supply', verified: true }),
      p('OUTLET', 'SCHUKO', 'out', ['power'], { group: 'Outlet', exclusive: false, verified: true }),
    ],
    passthrough: 'declared',
    linkByName: [['CIRCUIT IN', 'OUTLET']],
  },

  /* ---------------- Infrastructure ---------------- */
  {
    id: 'rack', name: 'Equipment rack', idPrefix: 'RACK', category: 'Infrastructure', icon: '▥',
    creates: 'rack', shape: 'box', size: { w: 0.6, h: 2.0, d: 1.0 }, color: '#1b2029',
    mounting: 'floor', verifiedSpec: true, ports: [],
  },
  {
    id: 'cabinet', name: 'Wall cabinet', idPrefix: 'RACK', category: 'Infrastructure', icon: '▥',
    creates: 'rack', shape: 'box', size: { w: 0.6, h: 0.6, d: 0.45 }, color: '#1b2029',
    mounting: 'wall', verifiedSpec: true, ports: [], rackUnits: 12,
  },
  {
    id: 'generic', name: 'Generic device', idPrefix: 'DEV', category: 'Infrastructure', icon: '▢',
    shape: 'box', size: { w: 0.3, h: 0.2, d: 0.2 }, color: '#5c6673',
    mounting: 'floor', verifiedSpec: false, ports: [],
  },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

export const CATEGORY_ORDER = ['Displays', 'Computing', 'Network', 'Video', 'KVM', 'Audio', 'Power', 'Infrastructure'];

/** Category → accent colour used by the library swatch and 3D tint. */
export const CATEGORY_COLOR = {
  Displays: '#6fc2ff', Computing: '#9fb4c8', Network: '#c6a2ff', Video: '#4de0d0',
  KVM: '#ff7ec9', Audio: '#7de0a8', Power: '#ff9a52', Infrastructure: '#8d9aab',
};

/** Expand a catalog template into a concrete Device entity. */
export function instantiate(ids, templateId, overrides = {}) {
  const t = CATALOG_BY_ID.get(templateId) || CATALOG_BY_ID.get('generic');
  const ports = [];
  if (t.portGenerator) {
    const { count, template } = t.portGenerator;
    for (let i = 1; i <= count; i++) {
      ports.push(makePort(ids, { ...template, name: `${template.name} ${i}` }));
    }
  }
  for (const tpl of t.ports || []) ports.push(makePort(ids, tpl));

  const links = [];
  if (t.linkByName) {
    const byName = new Map(ports.map((pt) => [pt.name, pt.id]));
    for (const [a, b] of t.linkByName) {
      const fa = byName.get(a), fb = byName.get(b);
      if (fa && fb) links.push({ from: fa, to: fb });
    }
  }

  const dev = makeDevice(ids, {
    id: overrides.id || ids.next(t.idPrefix),
    name: overrides.name || t.name,
    typeId: t.id,
    category: t.category,
    manufacturer: t.manufacturer || '',
    model: t.model || '',
    size: { ...t.size },
    shape: t.shape,
    color: t.color,
    mounting: t.mounting,
    rackUnits: t.rackUnits ?? 1,
    verifiedSpec: t.verifiedSpec ?? false,
    ports,
    passthrough: t.passthrough || 'auto',
    links,
    attributes: { ...(t.attributes || {}) },
    ...overrides,
  });
  if (t.specNote) dev.notes = dev.notes || t.specNote;
  return dev;
}

export function catalogItem(id) { return CATALOG_BY_ID.get(id) || CATALOG_BY_ID.get('generic'); }
