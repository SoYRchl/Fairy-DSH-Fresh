const { claimGeometryLifecycle } = require('./geometry-lifecycle.js');

function claimPowerModeGeometry(owner) {
  return claimGeometryLifecycle(owner, 'power-mode-geometry');
}

module.exports = { claimPowerModeGeometry };
