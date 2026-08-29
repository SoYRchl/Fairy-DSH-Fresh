const { getDomObserverManager, createManagedMutationObserver } = require('./dom-observer-manager.js');
const { createSemanticMarkerMap, markSemanticNode, mutationTouchesSemanticSurface, claimSemanticMarkers } = require('./semantic-markers.js');
const { OFFICIAL_SELECTORS, OFFICIAL_ATTRIBUTES, SEMANTIC_SURFACE_SELECTOR, rootSlot, sidebar, shellOverlay, settingsDialog, sidebarOpenControl, sidebarCollapseControl, sessionTree, expandedSessionItems, selectedSessionItems, newSessionButtons, sidebarBrandButton, conversation, phase, sessionHeader, sessionHeaderActions, sessionHeaderUtilities, sessionAgentPresetLabel, headerElement, composerSeat, composerCard, sendOnlyButton, undoControl, redoControl, reportMissingCapabilities } = require('./dom-adapter.js');

const domObserverManager = getDomObserverManager(document);

// Lifecycle: semantic markers
// Owner: document
// Contract: lifecycle-ownership.json#owners[subsystem=semantic markers]
function install(lifecycle = claimSemanticMarkers(document)) {
  const semanticFrameKey = {};
  let observer = null;
  const owned = createSemanticMarkerMap();
  let modalOpen = false;
  const clear = () => {
    owned.forEach((nodes, name) => {
      nodes.forEach((node) => {
        if (node.isConnected) node.removeAttribute(name);
      });
      nodes.clear();
    });
  };
  const sync = () => {
    const desired = createSemanticMarkerMap();
    const mark = (node, name) => markSemanticNode(desired, node, name);
    const root = rootSlot(document);
    const rootFrame = root?.firstElementChild;
    mark(rootFrame, 'data-dsh-fairy-background-surface');

    const shellOverlaySlot = shellOverlay(document);
    mark(shellOverlaySlot?.parentElement, 'data-dsh-fairy-overlay-layer');
    const nextModalOpen = Boolean(settingsDialog(document));
    if (nextModalOpen !== modalOpen) {
      modalOpen = nextModalOpen;
      document.documentElement.toggleAttribute('data-dsh-fairy-modal-open', modalOpen);
    }

    const side = sidebar(document);
    const sidebarContent = side?.firstElementChild;
    const sidebarLayer = side?.parentElement;
    const openSidebarControl = sidebarOpenControl(document);
    mark(sidebarLayer, 'data-dsh-fairy-sidebar-layer');
    mark(sidebarContent, 'data-dsh-fairy-sidebar-content');
    mark(openSidebarControl, 'data-dsh-fairy-sidebar-open-control');
    if (openSidebarControl) {
      mark(sidebarContent, 'data-dsh-fairy-sidebar-collapsed-content');
    }

    const tree = sessionTree(side);
    const historySurface = tree?.parentElement?.parentElement;
    mark(historySurface, 'data-dsh-fairy-history-surface');
    mark(tree?.nextElementSibling, 'data-dsh-fairy-history-fade');
    expandedSessionItems(tree).forEach((node) => mark(node, 'data-dsh-fairy-active-folder'));
    selectedSessionItems(tree).forEach((node) => mark(node, 'data-dsh-fairy-selected-session'));

    const newSessionControls = newSessionButtons(side);
    const brandCandidate = sidebarBrandButton(side);
    const sidebarCollapsed = Boolean(openSidebarControl) || !sidebarCollapseControl(document);
    const ownedBrand = !sidebarCollapsed ? brandCandidate : null;
    mark(ownedBrand, 'data-dsh-fairy-brand-anchor');
    newSessionControls.filter((button) => button !== ownedBrand).forEach((button) => mark(button, 'data-dsh-fairy-native-new-session'));

    const stage = conversation(document);
    const currentPhase = phase(stage);
    const header = sessionHeader(currentPhase);
    const actions = sessionHeaderActions(currentPhase);
    const utilities = sessionHeaderUtilities(currentPhase);
    mark(header, 'data-dsh-fairy-header-row');
    const nativeHeader = headerElement(header);
    const titleRow = [...(nativeHeader?.children || [])].find((node) => actions && utilities && node.contains(actions) && node.contains(utilities));
    mark(titleRow, 'data-dsh-fairy-header-title-row');
    const titleCluster = [...(titleRow?.children || [])].find((node) => actions && node.contains(actions) && (!utilities || !node.contains(utilities)));
    mark(titleCluster, 'data-dsh-fairy-header-title-cluster');
    mark(utilities?.parentElement, 'data-dsh-fairy-header-utilities-shell');
    mark(actions, 'data-dsh-fairy-header-actions-cluster');
    mark(utilities, 'data-dsh-fairy-header-utilities-cluster');
    const utilityButtons = [...(utilities?.querySelectorAll('button') || [])];
    const sessionLogButton = utilityButtons.find(
      (button) => !button.matches('.dsh-fairy-toggle, .dsh-fairy-theme-toggle'),
    );
    mark(sessionLogButton, 'data-dsh-fairy-header-session-log');
    mark(sessionAgentPresetLabel(currentPhase), 'data-dsh-fairy-header-session-agent-preset');
    const undo = undoControl(actions);
    const redo = redoControl(actions);
    if (undo?.parentElement && undo.parentElement === redo?.parentElement) mark(undo.parentElement, 'data-dsh-fairy-version-navigation');

    // The official composer seat is resident across Hero and Active. Do not
    // bind its geometry to the transient phase node.
    const seat = composerSeat(stage);
    const card = composerCard(seat);
    const sendButton = sendOnlyButton(card);
    mark(seat, 'data-dsh-fairy-composer-seat');
    mark(sendButton?.parentElement, 'data-dsh-fairy-composer-controls');
    mark(sendButton, 'data-dsh-fairy-send-button');
    const nativeCopy = seat?.querySelector('.dsh-fairy-hero-native-headline');
    mark(nativeCopy, 'data-dsh-fairy-hero-native-copy');
    desired.forEach((nextNodes, name) => {
      const previousNodes = owned.get(name);
      previousNodes.forEach((node) => {
        if (nextNodes.has(node)) return;
        if (node.isConnected) node.removeAttribute(name);
      });
      nextNodes.forEach((node) => {
        if (!previousNodes.has(node) || node.getAttribute(name) !== 'true') node.setAttribute(name, 'true');
      });
      owned.set(name, nextNodes);
    });
    reportMissingCapabilities(document);
  };
  const schedule = () => {
    if (!lifecycle.disposed) domObserverManager.scheduleFrame(semanticFrameKey, sync);
  };

  sync();
  if (typeof MutationObserver === 'function' && document.body) {
    observer = createManagedMutationObserver((records) => {
      if (mutationTouchesSemanticSurface(records, SEMANTIC_SURFACE_SELECTOR)) schedule();
    });
    lifecycle.add(() => observer?.disconnect(), 'semantic-markers:observer');
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-label', 'aria-selected', OFFICIAL_ATTRIBUTES.phase, OFFICIAL_ATTRIBUTES.slot],
    });
  }
  const cleanup = () => {
    domObserverManager.cancelFrame(semanticFrameKey);
    clear();
    document.documentElement.removeAttribute('data-dsh-fairy-modal-open');
  };
  lifecycle.add(cleanup, 'semantic-markers:restore-markers');
  return () => lifecycle.dispose();
}

module.exports = { install };
