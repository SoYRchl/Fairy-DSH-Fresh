const { claimGeometryLifecycle } = require('./geometry-lifecycle.js');

function claimBrandSidebarGeometry(owner) {
  return claimGeometryLifecycle(owner, 'brand-sidebar-geometry');
}

module.exports = { claimBrandSidebarGeometry };
