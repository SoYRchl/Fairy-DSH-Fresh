const { OFFICIAL_SELECTORS, composerAttachmentsSlot } = require('./dom-adapter.js');

const ATTACHMENTS_SLOT = OFFICIAL_SELECTORS.composerAttachmentsSlot;

function attachmentSlot(card) {
  return composerAttachmentsSlot(card);
}

function attachmentRail(slot) {
  return slot?.firstElementChild || null;
}

function attachmentRailHeight(slot) {
  const height = Number(attachmentRail(slot)?.getBoundingClientRect?.().height);
  return Number.isFinite(height) ? Math.max(0, Math.ceil(height)) : 0;
}

function attachmentDockHeight(baseHeight, railHeight, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, baseHeight + railHeight));
}

module.exports = {
  ATTACHMENTS_SLOT,
  attachmentSlot,
  attachmentRail,
  attachmentRailHeight,
  attachmentDockHeight,
};
