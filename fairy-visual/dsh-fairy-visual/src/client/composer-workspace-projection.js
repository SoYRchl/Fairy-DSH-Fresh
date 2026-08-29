
function lastVisibleTextNode(node) {
  let textNode = null;
  const visit = (current) => {
    [...(current?.childNodes || [])].forEach((child) => {
      if (child.nodeType === 3) {
        if (child.nodeValue?.trim()) textNode = child;
        return;
      }
      visit(child);
    });
  };
  visit(node);
  return textNode;
}

// Active sessions do not render the hero preset picker. Their workspace row is
// therefore a disabled Fairy projection. Keep that projection honest by taking
// its text from the official read-only header label for the current session.
// When the header is in a replacement/loading gap, hide the projected control
// instead of briefly showing the previous session's preset.
function syncWorkspaceProjectionMode(projection, sessionLabel) {
  const modeOwner = projection?.querySelector?.('[data-dsh-fairy-composer-mode-control="true"]') || null;
  const button = modeOwner?.querySelector?.('button') || null;
  const text = sessionLabel?.textContent?.trim() || '';
  if (!modeOwner || !button) return false;
  if (!text) {
    modeOwner.setAttribute('data-dsh-fairy-composer-mode-pending', 'true');
    return false;
  }
  const textNode = lastVisibleTextNode(button);
  if (!textNode) {
    modeOwner.setAttribute('data-dsh-fairy-composer-mode-pending', 'true');
    return false;
  }
  textNode.nodeValue = text;
  button.setAttribute('aria-label', text);
  button.setAttribute('title', sessionLabel.getAttribute?.('title') || text);
  modeOwner.removeAttribute('data-dsh-fairy-composer-mode-pending');
  return true;
}

function stripProjectionIdentity(node) {
  if (!node) return;
  node.removeAttribute('id');
  node.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('inert', '');
}

function captureWorkspaceTemplate(workspaceRow) {
  if (!workspaceRow || workspaceRow.hasAttribute('data-dsh-fairy-composer-workspace-projection')) return null;
  const template = workspaceRow.cloneNode(true);
  stripProjectionIdentity(template);
  template.removeAttribute('data-dsh-fairy-composer-workspace');
  template.removeAttribute('data-dsh-fairy-composer-workspace-projection');
  template.querySelectorAll('[data-dsh-fairy-composer-workspace]').forEach((node) => node.removeAttribute('data-dsh-fairy-composer-workspace'));
  return template;
}

// The projection is a disabled visual clone. The official workspace row stays
// the only interactive control surface.
function ensureWorkspaceProjection(stack, workspaceRow, workspaceTemplate, existingProjection) {
  // A real official row always wins. Remove an older fallback before returning
  // so a phase switch cannot leave two visually identical control rows.
  if (workspaceRow) {
    existingProjection?.remove();
    return null;
  }
  if (!stack || !workspaceTemplate) {
    existingProjection?.remove();
    return null;
  }
  if (existingProjection?.isConnected && existingProjection.parentElement === stack) return existingProjection;
  existingProjection?.remove();
  const projection = workspaceTemplate.cloneNode(true);
  projection.setAttribute('data-dsh-fairy-composer-workspace', 'true');
  projection.setAttribute('data-dsh-fairy-composer-workspace-projection', 'true');
  stripProjectionIdentity(projection);
  projection.querySelectorAll('button').forEach((button) => {
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.tabIndex = -1;
  });
  stack.appendChild(projection);
  return projection;
}

module.exports = { captureWorkspaceTemplate, ensureWorkspaceProjection, syncWorkspaceProjectionMode };
