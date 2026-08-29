# DSH Balance Meter

This local package owns the DeepSeek balance card and local daily token/cost
estimate shown in `sidebar.footer.action`. It is independent from Fairy
language, startup, visual, and voice behavior.

The server reads the existing DeepSeek key from the private DSH credentials
file and never returns or logs the key. It exposes only `/balance-meter`.
Daily counters are stored at `~/.dsh/balance-meter-daily.json` with mode `0600`
and are written atomically. Displayed cost remains an estimate, not an invoice.
Each new usage event is priced by its event timestamp using the DeepSeek V4
Flash peak/off-peak schedule verified from the official pricing page on
2026-08-26. The CNY display uses an explicit `1 USD = ¥7.2` estimate. A daily
file migrated from the former fixed-price schema is labelled `含迁移估算`
until the next local-day rollover because historical event times cannot be
reconstructed from aggregated counters.

The visible daily row preserves the native wording `今日token` in normal mode
and uses `今日电量` only while the published visual snapshot
`data-dsh-fairy-mode="hdd"` is active. The component observes that read-only
document contract and owns only its own label; the underlying value and server
field remain token counts (`todayTokens`).

The browser polls only while the document is visible. Unmount, `pagehide`, and
hidden-document transitions cancel pending requests/timers; the sidebar
`ResizeObserver` is disconnected on cleanup.

Registration is owned by the web profile through a local `link:` dependency.
Do not place the maintainable source directly in `profiles/node_modules`.

~~~sh
node --check lib/index.js
node --check lib/client.js
node --test test/*.test.js
仓库根目录下的 fairy-system/check.sh
~~~

## 2026-08-21 lifecycle hardening

The in-flight server request now has identity-guarded cleanup: an aborted old
request cannot clear a newer replacement request after plugin disposal or a
rapid reload. Persisted and event-supplied usage counters are normalized to
finite non-negative integers before accounting, so malformed runtime data
cannot turn the daily total into a string, `NaN`, or a negative value.

The browser polling lifecycle now handles `pageshow` in addition to
`visibilitychange` and `pagehide`. A BFCache restore resumes exactly one load
only when no request or timer already owns the refresh. The three expanded
rows have stable React keys; normal/HDD wording and all visible layout remain
unchanged.
