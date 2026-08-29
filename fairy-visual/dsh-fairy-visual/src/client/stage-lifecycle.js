const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');

// Lifecycle: stage geometry and content fade
// Owner: stage node
// Contract: lifecycle-ownership.json#owners[subsystem=stage geometry and content fade]

function claimStageGeometryLifecycle(stageNode) {
  return claimSingleton(stageNode, 'stage-geometry', createLifecycleScope('stage-geometry'));
}

function claimContentFadeLifecycle(stageNode) {
  return claimSingleton(stageNode, 'content-fade', createLifecycleScope('content-fade'));
}

module.exports = { claimStageGeometryLifecycle, claimContentFadeLifecycle };
