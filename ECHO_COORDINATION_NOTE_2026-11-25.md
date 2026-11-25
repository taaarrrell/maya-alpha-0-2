# M.A.Y.A. Alpha 0.2 — Echo Coordination Note (Adapter Integration)

**Date:** November 25, 2026
**From:** Snoopy (Muse) — backend engineering
**To:** Echo (ChatGPT Work) — frontend engineering
**Via:** Maya (coordination) and the owner (Human Relay). There is no direct agent-to-agent channel; this note is the coordination surface, and the S01 package lands in the shared repo via PR for Echo's review.
**Status:** The S01 foundation is ready for integration. The adapter is implemented and tested (see below). Echo reviews Snoopy's PR into `integration`; Echo's frontend integrates the adapter.

## The adapter

`shared/adapter.js` (Snoopy-owned). Plain JavaScript, no dependencies. Browser `<script>` → `window.MayaAlpha02`; Node → `module.exports`. The only URL in it is the public Worker address, used as configuration. It holds no secret and sends no credential. The contract is `MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_1_2026-11-25.md` (v2.1; v2 retained for the record).

### API

Create it once per page load:

```js
const adapter = MayaAlpha02.createAdapter({
  workerUrl: 'https://maya-alpha-m3-proxy.macman2028.workers.dev', // configuration, not a secret
  identity: IDENTITY_CONFIG,   // injected by the page (Maya-owned); the adapter never hardcodes it
  fetchImpl: fetch,             // optional; defaults to the global fetch
  storage: localStorage,        // optional; defaults to the global localStorage
  timeoutMs: 35000,             // optional; the client timeout (default 35 s)
  simulatedDelayMs: 350,        // optional; the simulated reply delay (default 350 ms)
  nowImpl: () => new Date()     // optional; injectable clock (tests advance it across midnight UTC)
});
```

- **`adapter.send(text)`** — handles BOTH modes. Live → Worker; Simulated → the M1 scripted reply set (the adapter owns it; Echo keeps no separate scripted-reply system and does not change the reply content — changes need Maya's approval). Resolves `{text, remaining}` (a number in Live, `'unknown'` in Simulated). Rejects with a typed error (§ below) on failure. Never returns a simulated reply when the mode is Live. Sends only the last user message; builds the system instruction from the injected identity at request time; attaches the stored chain id as `previous_interaction_id` when one exists; stores the returned `interaction_id` as the new chain id.
- **`adapter.setMode(mode)`** — `'live'` or `'simulated'`. Throws `TypeError` for anything else. The mode defaults to `'simulated'` on every construction (Live is never remembered across loads). Switching mode does NOT abort an in-flight request — it completes and its reply is added, tagged with the mode it was sent in; the switch affects future sends only. Returns the new mode.
- **`adapter.getMode()`** — the current mode.
- **`adapter.getRemaining()`** — the last authoritative `remaining` count, or `'unknown'` if none yet (or if the count is stale — see the count rules below).
- **`adapter.isCountStale()`** — true when the count may be out of date (see below). False only immediately after a successful live reply.
- **`adapter.getChainId()`** — the stored chain id, or `null`.
- **`adapter.clear()`** — drops the chain id. Works while a reply is pending: it aborts the pending request and retires its generation so a late reply is never added. If no request was in flight, the count freshness is unchanged. If a request was in flight and got cancelled, the count is marked stale (the request may have reserved a slot before the abort).

Only one `send()` may be in flight at a time (live or simulated). A second `send()` while one is pending rejects immediately with code `busy`, kind `concurrent` — it does not disturb the in-flight request and does not consume a cap slot. Disable the send control while a reply is pending; treat `busy` as a transient state, not a prominent error.

### Typed errors — branch on `code`, never on message text

`send()` rejects with `{code, kind, message}`. The UI branches on `code`; the messages are user-facing copy and may change.

| Kind | Codes | What it means |
|---|---|---|
| `worker` | The Worker's §3 codes (`forbidden`, `bad_request`, `payload_too_large`, `unsupported_media_type`, `proxy_not_configured`, `rate_limited`, `daily_limit_reached`, `upstream_rate_limited`, `upstream_auth_failed`, `upstream_permission_denied`, `upstream_overloaded`, `upstream_timeout`, `upstream_unreachable`, `upstream_bad_json`, `upstream_empty_reply`, `upstream_error`, `service_unavailable`) | The Worker returned an error. Show `message`. No automatic retry. |
| `network` | `network_error` | The fetch to the Worker failed before any response. "Could not reach the proxy. Check your connection and try again." Distinct from the Worker's `upstream_unreachable`. |
| `timeout` | `client_timeout` | No response within the adapter's 35 s client timeout (which covers the whole send, including response-body parsing). "The reply took too long. Try again." Distinct from the Worker's `upstream_timeout`. A late reply is discarded, never added. |
| `cancelled` | `cancelled` | `clear()` aborted a pending request. `message` is `null` — the UI must NOT display an error for a cancellation. A late reply from the cancelled generation is never added. |
| `concurrent` | `busy` | A second `send()` while one is in flight. "A reply is already in progress. Wait for it to finish." |

On any error: do NOT add a reply and do NOT change the saved history. Never retry automatically — a retry is a new user action and consumes a new cap slot. On `cancelled`, show nothing. On `busy`, show at most a transient hint. On every other error, show `message` and mark the count as stale (or show "unknown").

### Count display rules — including the UTC reset, the spanning-midnight invalidation, and the integer validation

The remaining count is for the UTC day (the daily cap is 20; it resets at midnight UTC). The rules are binding on the UI; they exist so the display never overstates what is left.

- **No authoritative count yet → show "unknown".** Before the first successful live reply, show "unknown" (or an equivalent neutral state), not a guessed count and not the cap (20). `isCountStale()` is true.
- **After a successful live reply → show the returned `remaining`.** That value is authoritative. It comes from the Worker's 200 response, not from local arithmetic. `isCountStale()` is false.
- **After an error → mark the last count as stale.** A failed attempt consumes a slot, but the error response carries no new count. Mark the last displayed count as stale (for example "9 left (may be out of date)") or show "unknown". Never present the pre-error count as current. `isCountStale()` is true.
- **UTC day rollover → the count goes stale.** If the page stays open across midnight UTC, the count from the old day is stale and `getRemaining()` returns `'unknown'`. The adapter records the UTC date the count was set on and compares it on every access. The count is in-memory only (never persisted).
- **A live request spanning midnight UTC → the count is invalidated conservatively.** If a send starts before midnight and its reply arrives after midnight, the count in that reply belongs to the old day. The adapter still returns the reply text and stores the chain id, but the count is dropped: the send resolves with `remaining: 'unknown'` and `isCountStale()` is true. (The conversation happened; only the count is invalidated.)
- **Remaining counts are validated as integers in [0, 20].** An authoritative count must be an integer between 0 and 20 inclusive. A fractional, negative, over-cap, NaN, infinite, string or null value is treated as "no authoritative count": the reply text and chain id are still applied, the previous remaining value is kept, and the count is marked stale. The UI never has to validate the count itself — the adapter only ever hands it a valid integer or `'unknown'`.
- **Never overstate what is left.** When in doubt, show "unknown" or mark stale. Understating (or showing unknown) is safe; overstating is not.

### Storage keys

- **Adapter owns:** `maya-alpha-0-2-chain-v0.1` (the chain id only). The adapter never reads or writes any conversation-history key.
- **UI owns:** `maya-alpha-0-2-conversation-v0.1` (the conversation history — an array of `{role, text}` messages, user and model). The UI persists it; the adapter never touches it.
- **Never touch the Alpha 0.1 keys** (`maya-alpha-chain-v0.1`, `maya-alpha-conversation-v0.1`). The frozen Alpha 0.1 baseline and its stored state are untouched.

### Simulated mode

The mode defaults to Simulated on every load. In Simulated mode the adapter returns a scripted reply from the M1 set (greeting, who-are-you, help/capabilities, fallback) with `remaining: 'unknown'`; it does not call the Worker, does not touch the chain id, and does not change the count. Simulated mode never substitutes silently for a failed live reply: when the mode is Live, a failure rejects with the typed error and adds no reply. Show a LIVE badge and the remaining-cap display when live; a SIMULATED badge when simulated.

### Safety (carried from Alpha 0.1)

No secrets in the page (no key, token or credential in HTML, JS, CSS, docs or tests — the Worker URL is public by design; the key is not). No direct upstream calls from the page — the UI calls the adapter, the adapter calls the Worker, the Worker calls Gemini. The identity panel renders IDENTITY_CONFIG as-is; the UI may render it but may not rewrite it (IDENTITY_CONFIG is Maya-owned). No automatic retries anywhere. Dream Mode and PHINEAS stay paused.

## The synthetic integration test

`test/test-adapter-integration-0-2.cjs` simulates a minimal UI consumer the way the frontend will use the adapter (mock fetch + mock localStorage + injectable clock). Run it with:

```
NODE_PATH=/home/hatch/workspace/your_files/maya-alpha-2a/node_modules node test/test-adapter-integration-0-2.cjs
```

It proves: (I-01) a simulated send persists the conversation under the 0.2 history key; (I-02) a live send persists the conversation and stores the chain id under the 0.2 chain key, and a second live send chains by `previous_interaction_id`; (I-03) the consumer and adapter together touch only the 0.2 keys, never the Alpha 0.1 keys; (I-04) a typed error (`upstream_overloaded`) adds no model reply and the user message stays; (I-05) a concurrent second send is rejected with `busy` and the first send completes and persists; (I-06) `clear()` drops the chain id and the consumer can clear the history key. **6/6 PASS, exit 0** (verified Nov 25, 2026).

The adapter unit suite is `test/test-adapter-0-2.cjs` (same NODE_PATH run). **42/42 PASS, exit 0** — 32 original S01 tests plus 10 new tests for the spanning-midnight invalidation (A-33–A-35), the integer 0–20 validation (A-36–A-39), and the abort/timeout parse correction (A-40–A-42). Echo's `tests/adapter-regressions.cjs` (provided by the owner, recovered by Maya from the E01 integrated package; verbatim, unmodified) also passes **3/3, exit 0**, including its final abort-aware body case.

## Next step

The foundation lands via PR into `integration` once the owner authorizes it (the repo `taaarrrell/maya-alpha-0-2` exists, `main` is protected by the "Protect main" ruleset — Active, require PR + 1 approval, block force pushes, block deletions). Echo reviews Snoopy's PR; Maya approves; the owner authorizes `integration` → `main`. Echo's frontend then integrates the adapter: call `createAdapter` once per load with the injected IDENTITY_CONFIG, route sends through `adapter.send`, persist the conversation under `maya-alpha-0-2-conversation-v0.1`, branch on error `code`, and follow the count display rules above. Echo's preview repo (`maya-alpha-0-2-ui-preview`) remains separate; the shared repo holds the reviewed baseline.
