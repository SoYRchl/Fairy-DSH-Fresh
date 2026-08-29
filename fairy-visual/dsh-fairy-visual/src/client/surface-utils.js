const { OFFICIAL_SELECTORS, OFFICIAL_ATTRIBUTES } = require('./dom-adapter.js');

// Body-level observers are needed because official surfaces can be replaced,
// but unrelated stream updates must not wake every geometry consumer.
function mutationTouchesSurface(records, selector, attributes = []) {
  return records.some((record) => {
    const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
    if (record.type === 'attributes') {
      return (!attributes.length || attributes.includes(record.attributeName))
        && Boolean(target?.matches?.(selector) || target?.closest?.(selector));
    }
    if (record.type !== 'childList') return false;
    if (target?.matches?.(selector) || target?.closest?.(selector)) return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1
      && (node.matches?.(selector) || node.querySelector?.(selector)));
  });
}

// A root-level observer must distinguish an official surface replacement from
// ordinary streaming updates inside that surface. Only the surface itself, a
// subtree that contains one, or mutations inside the current Hero can change
// the fixed Hero controls.
function mutationTouchesHeroSurface(records, officialSelectors, officialAttributes) {
  // During a session switch the runtime can mount Hero before removing Active.
  // Both edges affect Hero ownership: observing Hero alone misses the final
  // Active removal and can leave the fixed new-session controls hidden.
  const selector = `${officialSelectors.conversation}, ${officialSelectors.phaseHero}, ${officialSelectors.phaseActive}, ${officialSelectors.composerSeat}`;
  return records.some((record) => {
    const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
    if (record.type === 'attributes') {
      if (record.attributeName === officialAttributes.phase) return Boolean(target?.matches?.(selector));
      return record.attributeName === 'placeholder'
        && Boolean(target?.matches?.(OFFICIAL_SELECTORS.composerTextarea) && target.closest?.(officialSelectors.phaseHero));
    }
    if (record.type !== 'childList') return false;
    if (target?.matches?.(officialSelectors.phaseHero) || target?.closest?.(officialSelectors.phaseHero)) return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1
      && (node.matches?.(selector) || node.querySelector?.(selector)));
  });
}

function roundedRectPath(left, top, right, bottom, radius) {
  const r = Math.max(0, Math.min(radius, (right - left) * .5, (bottom - top) * .5));
  if (!r) return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`;
  return `M ${left + r} ${top} H ${right - r} Q ${right} ${top} ${right} ${top + r} V ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} H ${left + r} Q ${left} ${bottom} ${left} ${bottom - r} V ${top + r} Q ${left} ${top} ${left + r} ${top} Z`;
}

module.exports = { mutationTouchesSurface, mutationTouchesHeroSurface, roundedRectPath };
