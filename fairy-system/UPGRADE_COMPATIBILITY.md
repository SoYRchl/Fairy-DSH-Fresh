# DSH Upgrade Compatibility Matrix

This document defines a read-only gate for an official DSH candidate. It does
not authorize an install, lockfile refresh, package change, or runtime patch.

## Reviewed Baseline

| Surface | Declaration / resolved version | Upgrade contract |
| --- | --- | --- |
| Official browser runtime | `0.1.1-rc.2`, SHA-256 `13a5fe0ee8cddda2306d302eb0dbfdd601e96d14baeb512867b4b6d1d72f6679` | Browser ModuleLoader registration, `factory(require)`, client lifecycle and slots remain present. |
| Fairy Visual host settings | `@deepseek-ai/dsh-settings` exactly `0.1.1-rc.2` | The host alone imports `settingsNamespace` and registers its schema through `ctx.inject(['settings'])` / `settings.register`. |
| Fairy Visual client settings | Official runtime `0.1.1-rc.2` | The client uses `ctx.settingsScope.bind`; it must not import or bundle `@deepseek-ai/dsh-settings`. |
| `dsh-reasoning-effort` | `github:HanaAyane/dsh-reasoning-effort#main`, resolved lock version `0.6.2` | The current lock pin is commit `83bc8c548749d7156a03d11d875d8117e9b5d994` plus patch hash `9cbcceae243982ca0241cd41471317da9112c3e61e345b3b32f205d90aec18b5`. |
| `dsh-message-edit` | exact `0.2.3` | The current lock patch hash is `6365b2e53f9a2f366898ef2d78648c34823df11e9bfc2a47162e6626803763cb`. |

## Peer API Risks

`dsh-reasoning-effort` declares `^0.1.0-rc.6` peer ranges for the browser
runtime, connection, conversation, model-selection, settings, slots, remotes,
and Cordis. The installed official providers are `0.1.1-rc.2`; semver range
acceptance is not evidence that its ModuleLoader bundle, `conversation.input.model`,
or `settings.general.item` slots remain compatible.

`dsh-message-edit` declares no runtime peer dependencies. Its bundle was built
against rc.6 development dependencies and implicitly relies on the browser
ModuleLoader plus `conversation.view` and `conversation.session.header.actions`.
Treat those as peer API contracts even though its manifest does not state them.

## Upgrade Blockers

Do not upgrade until a candidate preserves, or has an explicitly reviewed
replacement for, all of the following:

- approved runtime version and SHA-256;
- ModuleLoader boot protocol and lifecycle/slot behavior;
- Visual settings import boundary, resolved version, `settings.register`, and
  client `settingsScope` bridge;
- Visual slots, DOM attributes/selectors, and Chinese ARIA anchors;
- reasoning peer ranges, slots, source commit, and patch hash;
- message-edit version, bundled ModuleLoader/slot contract, and patch hash.

The reasoning declaration points to a moving Git branch. The lockfile commit
and patch hash are therefore the actual reproducibility pins. A lockfile diff
for either third-party plugin is a blocking review item, not routine upgrade
noise.

## Read-only Commands

```sh
cd <fairy-dsh-checkout>
node fairy-system/upgrade-preflight.js --report
node fairy-system/upgrade-preflight.js \
  --profile /absolute/isolated/profile \
  --runtime /absolute/isolated/runtime/lib/client.js \
  --expected-version 0.1.1-rc.2 \
  --expected-sha256 13a5fe0ee8cddda2306d302eb0dbfdd601e96d14baeb512867b4b6d1d72f6679
```

## 2026-08-25 capability boundary

- The official DOM selector, attribute, slot, ARIA, Session, and Workspace
  contracts are versioned in `capability-matrix.json`.
- Fairy Visual's official DOM selectors are resolved through
  `fairy-visual/dsh-fairy-visual/src/client/dom-adapter.js`; observer helpers
  consume adapter exports instead of duplicating official selectors.
- The approved Visual settings dependency is
  `@deepseek-ai/dsh-settings@0.1.1-rc.2`, aligned with the installed DSH
  runtime family.
- `upgrade-preflight.js` rejects the active profile/runtime by default and
  validates only an explicitly supplied isolated candidate pair.
- Browser evidence is required for normal/HDD, Light/Dark, historical-session,
  composer-replacement, sidebar-transition, and console-error cases before a
  new runtime can be approved.
