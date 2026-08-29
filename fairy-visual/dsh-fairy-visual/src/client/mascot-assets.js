'use strict';

const CSS = require('./mascot-style.js');
const { PULSE_SVG, HALO_SVG } = require('./mascot-effects-svg.js');
const SVG = require('./mascot-eye-svg.js');
const geometry = require('./mascot-geometry.js');

module.exports = Object.freeze({ CSS, PULSE_SVG, HALO_SVG, SVG, geometry });
