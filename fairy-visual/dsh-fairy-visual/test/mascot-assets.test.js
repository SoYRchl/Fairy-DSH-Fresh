import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const evaluate = (source, dependencies = {}) => {
  const module = { exports: {} };
  const require = (id) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  };
  vm.runInNewContext(source, { module, exports: module.exports, require });
  return module.exports;
};
const hash = (value) => createHash('sha256').update(value).digest('hex');

const [styleSource, effectsSource, eyeSource, geometrySource, assetsSource] = await Promise.all([
  read('../src/client/mascot-style.js'),
  read('../src/client/mascot-effects-svg.js'),
  read('../src/client/mascot-eye-svg.js'),
  read('../src/client/mascot-geometry.js'),
  read('../src/client/mascot-assets.js'),
]);
const CSS = evaluate(styleSource);
const effects = evaluate(effectsSource);
const geometry = evaluate(geometrySource);
const SVG = evaluate(eyeSource, { './mascot-geometry.js': geometry });
const assets = evaluate(assetsSource, {
  './mascot-style.js': CSS,
  './mascot-effects-svg.js': effects,
  './mascot-eye-svg.js': SVG,
  './mascot-geometry.js': geometry,
});

test('locks extracted mascot asset bytes and the derived SVG output', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(assets).filter(([, value]) => typeof value === 'string').map(([name, value]) => [name, hash(value)])),
    {
      CSS: 'faec9d56093aa5cf85875fd857f688f326546cf2e17b5ffea840d83b7fc4a86b',
      PULSE_SVG: '117eb1e6a6bde148130ee8bbf7964476eff5429020e22b7e53cd29ef6a58f929',
      HALO_SVG: '80e67b8105efb578133f498271feff019cee298a97c5b2d5e33534af1bd137bb',
      SVG: 'a669d0c21bfe0614a046f380fac4a6c05cd24a419d94e6ad44b138813b81ed67',
    },
  );
});

test('keeps the static resource aggregator explicit and immutable', () => {
  assert.equal(Object.isFrozen(assets), true);
  assert.deepEqual(Object.keys(assets), ['CSS', 'PULSE_SVG', 'HALO_SVG', 'SVG', 'geometry']);
});

test('derives edge-to-halo peaks from the shared geometry contract', () => {
  assert.equal(geometry.outerVisibleEdge, 68.6);
  assert.equal(geometry.scleraVisibleEdge, 48.4);
  assert.equal(geometry.formatRatio(geometry.outerHaloPeak), '.868');
  assert.equal(geometry.formatRatio(geometry.scleraHaloPeak), '.864');
  assert.equal(geometry.formatRatio(geometry.highlightHaloPeak), '.611');
  assert.doesNotMatch(assets.SVG, /<stop offset="\.85"[^>]*>\s*<stop offset="\.85"/);
  assert.match(geometrySource, /visible edge must be inside its halo radius/);
  assert.match(geometrySource, /Invalid Fairy geometry ratio/);
});

test('keeps contact ratios invariant across supported mascot scales', () => {
  for (const scale of [0.55, 0.7, 0.85, 1]) {
    for (const [edge, halo] of [
      [geometry.outerVisibleEdge, geometry.outerHaloRadius],
      [geometry.scleraVisibleEdge, geometry.scleraHaloRadius],
      [geometry.highlightRadius, geometry.highlightHaloRadius],
    ]) {
      assert.ok(edge * scale < halo * scale);
      assert.ok(Math.abs((edge * scale) / (halo * scale) - edge / halo) < Number.EPSILON * 4);
    }
  }
});
