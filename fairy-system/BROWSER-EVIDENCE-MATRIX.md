# DSH Browser Evidence Matrix

This matrix is part of the DSH upgrade boundary. It is not a substitute for
unit tests or static preflight. Every official DSH runtime upgrade must have a
dated evidence record for every case below, or an explicit reviewed exception.

| Case | Required evidence |
|---|---|
| `normal-light-new-session` | Official DSH UI, no HDD markers/styles, new-session screen, no console errors/warnings |
| `normal-dark-new-session` | Same as above in dark theme |
| `hdd-light-new-session` | HDD stage, Fairy mascot, Hero, composer dock, Light theme, no console errors/warnings |
| `hdd-dark-new-session` | Same as above in dark theme |
| `normal-light-historical-session` | Historical session selection, official layout ownership, composer remains correct |
| `hdd-light-historical-session` | Historical session selection, HDD projection and composer remain correct |
| `hdd-composer-replacement` | Session switch / phase replacement, one composer owner, no stale listeners or duplicate controls |
| `hdd-normal-mode-transition` | HDD → normal → HDD, root markers/styles and mascot ownership cleanly transition |
| `safari-hdd-transition-svg-integrity` | Safari: cold-start directly in HDD, normal → HDD, HDD → normal → HDD, and historical-session switch; after each transition, wait through multiple timed fault bursts and confirm both threads and blocks render, while live SVG fragment IDs/references remain unique and self-contained |
| `rapid-sidebar-collapse-reopen` | Rapid collapse/reopen, brand/power geometry and sidebar overlays recover |
| `console-errors-and-warnings` | Browser console captured for the complete matrix run |

## Recording rules

- Use the candidate DSH profile/runtime, never the active runtime, for upgrade
  acceptance.
- Record the exact DSH version, official client runtime SHA-256, profile path,
  runtime path, browser URL, theme, mode, session type, and viewport.
- Preserve a screenshot or DOM snapshot plus the console result.
- Do not record credentials, session contents, API responses, or private user
  data in the evidence file.
- Evidence is dated and append-only. A new runtime cannot silently reuse an
  older runtime's acceptance record.

Current baseline evidence is in `browser-evidence/`.
