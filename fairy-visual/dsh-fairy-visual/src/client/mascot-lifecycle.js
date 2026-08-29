const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');

// Lifecycle: Fairy mascot runtime
// Owner: stage node
// Contract: lifecycle-ownership.json#owners[subsystem=Fairy mascot runtime]

function claimMascotLifecycle(stageNode) {
  return claimSingleton(stageNode, 'mascot-runtime', createLifecycleScope('mascot-runtime'));
}

module.exports = { claimMascotLifecycle };
