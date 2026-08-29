const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');

// Lifecycle: HDD overlay scrollbars
// Owner: document and target scroll node
// Contract: lifecycle-ownership.json#owners[subsystem=HDD overlay scrollbars]

function claimScrollbarLifecycle(documentRef) {
  return claimSingleton(documentRef, 'scrollbars', createLifecycleScope('scrollbars'));
}

module.exports = { claimScrollbarLifecycle };
