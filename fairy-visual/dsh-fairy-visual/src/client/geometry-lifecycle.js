const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');

// Lifecycle: sidebar board geometry
// Owner: document
// Contract: lifecycle-ownership.json#owners[subsystem=sidebar board geometry]

function claimGeometryLifecycle(owner, name) {
  return claimSingleton(owner, name, createLifecycleScope(name));
}

module.exports = { claimGeometryLifecycle };
