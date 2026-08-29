# DSH Fairy Startup

This client-only plugin owns one policy: each new browser document starts on
the official blank-session screen instead of restoring the previously selected
conversation. It synchronously clears the restored selection, waits for the
workspace baseline, and then calls the public `workspaces.startSession()` API.

It does not render UI, alter visual settings, inspect language presets, or
control voice playback. Its only document marker prevents duplicate execution
within one page. Cordis disposal unsubscribes a pending workspace wait.

```sh
node --check lib/client.js
node --test test/*.test.js
```
