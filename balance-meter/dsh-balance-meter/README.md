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

When the balance lookup fails, the card renders a Chinese reason instead of a
bare `unavailable` token: `未配置` (no key in the credentials file), `密钥无效`
(HTTP 401), `账户欠费` (HTTP 402), `无权限` (HTTP 403), `请求过快` (HTTP 429),
`网络失败` (request failed), and `暂不可用` for any other outcome. The server
also logs `balance.fetch` with the HTTP status, so a non-2xx reply is
attributable from `DSH_FAIRY_LOG`.

Usage events are priced by their message source. Official DeepSeek models
(`deepseek-*` model ids or a provider id containing `deepseek`) use the
built-in V4 Flash schedule. Any other model is counted in tokens but
skipped in money, and the daily estimate is flagged incomplete (rendered
as `¥x.xx*` with a note in the card). To price third-party models, list
them in the bundle config — `balancePricing.models`, USD per million
tokens, exact model match; `cacheRead`/`cacheWrite` default to `input`,
and rows missing `model`, `input`, or `output` are dropped:

~~~yaml
- insert:
    - id: balance-meter
      name: 'dsh-balance-meter'
      inject: [clientModules]
      config:
        balancePricing:
          models:
            - model: 'mimo-v2.6-flash-free'
              input: 0
              output: 0
              cacheRead: 0
              cacheWrite: 0
~~~

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
