// Lifecycle: mode/theme transitions and mascot scale retry
// Owner: Controller transition objects and Stage effect
// Contract: lifecycle-ownership.json#owners[subsystem=mode/theme transitions and mascot scale retry]
// Ownership boundary for the existing visual transition state machines.
// Transition implementation and all visual timing stay in index.js unchanged.
function ownModeTheme(scope, modeTransition, themeTransition, sessionTransition) {
  scope.add(() => modeTransition?.dispose?.(), 'mode-theme:mode-transition');
  scope.add(() => themeTransition?.dispose?.(), 'mode-theme:theme-transition');
  scope.add(() => sessionTransition?.dispose?.(), 'mode-theme:session-transition');
}

module.exports = { ownModeTheme };
