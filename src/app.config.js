/**
 * Twinfabric — open-source 3D digital twin and infrastructure planning platform.
 * Copyright (C) 2026 Hussain Humaidan and Twinfabric contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. It is distributed WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE. See the GNU Affero General Public License for more details:
 * https://www.gnu.org/licenses/
 *
 * ---
 *
 * Product identity — the ONE place the application names itself.
 *
 * The platform is generic. A Mall, an office, a school or a warehouse is a
 * PROJECT that runs inside it, supplied by a template. Nothing in the engine,
 * the data model or the logic layer knows what a Mall is; only
 * `src/model/templates/mall.js` does, and it is just one entry in a registry.
 *
 * Renaming the product is editing this file.
 */
export const PRODUCT = {
  /** Display name, used in the title bar, the brand mark and reports. */
  name: 'Twinfabric',
  /** Two or three letters for the brand chip. */
  mark: 'TWF',
  /** One line, used in the page title and the README. */
  tagline: 'Open-source 3D digital twin and infrastructure planning platform',
  /** Intended repository / package name. */
  slug: 'twinfabric',
  /** Application version, written into every saved project. */
  version: '0.2.0',
  /** File extension for exported projects. */
  fileExtension: '.twinfabric',
  /** AGPL section 13: a network user must be able to reach the source. */
  license: 'AGPL-3.0-only',
  sourceUrl: 'https://github.com/hussain-humaidan/Twin-Fabric',
  copyright: 'Copyright (C) 2026 Hussain Humaidan and Twinfabric contributors',
};

/**
 * Where a name comes from, so the UI never has to guess:
 *   PRODUCT.name        the software            "Twinfabric"
 *   project.name        this body of work       "Mall Infrastructure Project"
 *   project.building.name  the physical thing   "Riverside Mall"
 */
export const NAMING = {
  productLabel: () => PRODUCT.name,
  windowTitle: (project) => (project?.name ? `${project.name} — ${PRODUCT.name}` : PRODUCT.name),
};
