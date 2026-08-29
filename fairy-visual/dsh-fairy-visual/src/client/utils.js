import { MODE_ATTR, POWER_MODE_ATTR, THEME_ATTR } from './constants.js';

import { deriveSessionComfort } from './comfort-detector.js';

export function deriveSessionActivity(snapshot) {
  if (deriveSessionComfort(snapshot)) return 'comforting';
  return snapshot?.running === true ? 'thinking' : 'normal';
}

export function syncDocumentMode(snapshot) {
  // Settings snapshots carry the persisted value under `value`; keeping the
  // projection here makes the document state authoritative for every visual
  // surface and prevents controls from drifting from their CSS scope.
  const value = snapshot?.value || snapshot || {};
  if (snapshot?.status === 'loading') return;
  const enabled = Boolean(value.enabled);
  const theme = value.theme === 'light' ? 'light' : 'dark';
  const powerMode = value.powerMode === 'low-power' ? 'low-power' : 'normal';
  const root = document.documentElement;

  if (enabled) {
    root.setAttribute('data-dsh-fairy-visual', '');
    root.setAttribute(THEME_ATTR, theme);
    root.setAttribute(MODE_ATTR, 'hdd');
    root.setAttribute(POWER_MODE_ATTR, powerMode);
  } else {
    root.removeAttribute('data-dsh-fairy-visual');
    root.removeAttribute(THEME_ATTR);
    root.removeAttribute(MODE_ATTR);
    root.removeAttribute(POWER_MODE_ATTR);
  }
}
