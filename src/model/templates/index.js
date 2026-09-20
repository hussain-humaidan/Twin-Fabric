/**
 * Template registry.
 *
 * A template is just a function that fills an empty project document with
 * levels, walls, slabs, openings, stairs, columns, spaces and pathways. The
 * platform loads them from here and never refers to any of them by name.
 *
 * To add a building type: write a module that exports a build(ids, opts)
 * function and add one entry below. Community templates plug in the same way.
 */
import { buildMall } from './mall.js';
import { buildBlank, buildOffice } from './generic.js';

/**
 * @typedef BuildingTemplate
 * @property {string} id
 * @property {string} name      shown in the New Building dialog
 * @property {string} summary   one line of detail
 * @property {string} category  grouping for the picker
 * @property {(ids, opts) => object} build
 */
export const BUILDING_TEMPLATES = [
  {
    id: 'mall',
    name: 'Mall',
    category: 'Community',
    summary: '5 halls and 3 rooms downstairs, 10 rooms plus 2 clerks halls and 11 clerk rooms upstairs, roof with plant and mast zones.',
    build: buildMall,
  },
  {
    id: 'office',
    name: 'Office',
    category: 'Commercial',
    summary: 'Two storeys, three offices and a meeting room per floor, comms room, corridor tray on each level.',
    build: buildOffice,
  },
  {
    id: 'blank',
    name: 'Empty site',
    category: 'Custom',
    summary: 'One level and a ground slab. Draw the building yourself with the wall and room tools.',
    build: buildBlank,
  },
];

export function getTemplate(templateId) {
  return BUILDING_TEMPLATES.find((t) => t.id === templateId) || BUILDING_TEMPLATES[0];
}

export function createFromTemplate(templateId, ids, opts) {
  return getTemplate(templateId).build(ids, opts);
}

export { buildMall, buildBlank, buildOffice };
