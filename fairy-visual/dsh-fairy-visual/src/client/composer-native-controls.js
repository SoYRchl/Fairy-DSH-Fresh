const { markControls } = require('./composer-marker-projection.js');

// Native placement is marker-only: CSS places the official nodes in the dock.
function placeNativeControlMarkers(card) {
  return markControls(card);
}

module.exports = { placeNativeControlMarkers };
