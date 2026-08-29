const { createLifecycleScope, claimSingleton } = require('./lifecycle.js');
const { ownModeTheme } = require('./mode-theme.js');

// Lifecycle: controller
// Owner: Controller instance
// Contract: lifecycle-ownership.json#owners[subsystem=controller]
// Controller disposal is a singleton-owned lifecycle boundary. The controller
// remains the state machine; this module owns resource teardown registration.
function ownControllerLifecycle(controller) {
  const scope = claimSingleton(controller, 'controller-dispose', createLifecycleScope('controller'));
  ownModeTheme(scope, controller.modeTransition, controller.themeTransition, controller.sessionTransition);
  scope.add(() => controller.listOff?.(), 'controller:session-list-subscription');
  scope.add(() => controller.sessionOff?.(), 'controller:session-binding-subscription');
  scope.add(() => controller.settingsOff?.(), 'controller:settings-subscription');
  scope.add(() => controller.listeners?.clear?.(), 'controller:listener-registry');
  return scope;
}

function disposeControllerLifecycle(scope) {
  scope?.dispose?.();
}

module.exports = { ownControllerLifecycle, disposeControllerLifecycle };
