# M.A.Y.A. Alpha 0.2 — Adapter Contract v2.1 (refined for Assignment S01 — integration foundation)

**Date:** November 25, 2026
**Author:** Muse (Snoopy) — backend engineering
**To:** Echo (frontend engineering), via Maya (coordination) and the owner
**Supersedes:** Adapter Contract v2 (`MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_2026-11-24.md`, SHA-256 `0e94d623…`). This v2.1 is the complete contract for Alpha 0.2; v2 and v1 are retained for the record and must not be used for new work.
**Basis:** The verified Alpha 0.1 backend (Worker version `bd0860d3…`, interface `b1c870a7…`, model `gemini-3.5-flash-lite`, cap 20), the Slice 2A LiveAdapter, and the M1 simulated reply set. Alpha 0.1 is PASS and its baseline is frozen; this contract changes nothing in it.
**Status:** Integration foundation. The adapter is implemented to this contract and tested (42/42 adapter unit tests + 6/6 integration tests + 3/3 Echo regression tests, synthetic only). It lands in the shared repo (`taaarrrell/maya-alpha-0-2`, `main` protected by the "Protect main" ruleset) via PR into `integration`. No code changes to the frozen baseline, deployments, live calls, credential changes or spending are authorized by this document.

## Changes in v2 (refinements for S01)

- **Concurrent requests (§4, §5.5):** only one `send()` may be in flight at a time. A second `send()` while one is pending rejects with code `busy`, kind `concurrent`. The in-flight request is unaffected.
- **Mode switching (§4):** switching mode does NOT abort an in-flight request. The in-flight request completes and its reply is added, tagged with the mode it was sent in. The mode switch only affects future sends.
- **Count freshness (§4, §6):** the adapter tracks whether the remaining count is fresh or stale. New API: `Adapter.isCountStale()`. The count is fresh only immediately after a successful live reply; it is stale before any live reply, after any error, and after a cancellation that may have consumed a slot.
- **Isolated Alpha 0.2 storage (§4, §9):** the adapter uses ONLY the Alpha 0.2 keys (`maya-alpha-0-2-chain-v0.1` for the chain id). It never reads or writes the Alpha 0.1 keys (`maya-alpha-chain-v0.1`, `maya-alpha-conversation-v0.1`). The frozen Alpha 0.1 baseline and its stored state are untouched.

## Changes in v2.1 (integration foundation, Nov 25, 2026)

- **Conservative quota invalidation for requests spanning midnight UTC (§4, §6):** the UTC date is now recorded when a live send STARTS, not only when its count is set. If the reply arrives on a different UTC day, the count in that reply belongs to the old day (whose cap has reset) and is invalidated conservatively — the reply text and chain id are still applied, but the count is dropped and the send resolves with `remaining: 'unknown'`, and `isCountStale()` is true. (Previously, only a count already stored could go stale on rollover; a reply arriving after midnight was recorded with the new day's date and treated as fresh.)
- **Remaining counts validated as integers in [0, 20] (§3, §6):** an authoritative `remaining` must be an integer between 0 and 20 inclusive (the daily cap is 20). A fractional, negative, over-cap, NaN, infinite, string or null value is treated as "no authoritative count": the reply text and chain id are still applied, the previous remaining value is kept, and the count is marked stale. The UI never has to validate the count itself — the adapter only ever hands it a valid integer or `'unknown'`.
- **Timeout settlement takes precedence over abort-induced parse failures (§5.3):** when the client timeout fires it aborts the fetch controller; if the response body is being parsed at that moment, the abort makes the parse reject (AbortError). That parse failure is caused by the timeout, not by malformed JSON, so the send settles as `client_timeout` (kind `timeout`), never as `upstream_bad_json` (kind `worker`). Genuine malformed JSON — a 200 whose body is unparseable with no abort and no timeout — is still `upstream_bad_json`. Generation isolation is preserved: a timed-out or cancelled generation's late parse failure is discarded and never interferes with a newer generation's timers or settlement.

## 1. Purpose

The adapter is the only seam between Echo's visual UI and Snoopy's backend. Echo's UI never talks to the Worker directly and never talks to Gemini. It calls the adapter. The adapter talks to the Worker. The Worker talks to Gemini. This contract fixes that seam so the two sides can be built in parallel without breaking each other.

## 2. The two contracts

There are two contracts, and they are separate:

- **(A) The /chat HTTP contract** (Worker ↔ adapter). Snoopy owns it. It is versioned. A change needs Maya's review. Echo never calls it directly.
- **(B) The adapter JS API** (adapter ↔ Echo's UI). Snoopy owns the adapter's internals; Echo consumes the API. The API surface is fixed by this document and does not change without a pull request that both agents review.

## 3. Contract A — the /chat HTTP contract

**Endpoint:** `POST {WORKER_URL}/chat`, where `WORKER_URL` is `https://maya-alpha-m3-proxy.macman2028.workers.dev`. The URL is configuration, not code; the adapter reads it from its own configuration, and the page never hardcodes a different endpoint.

**Request body.** The body may contain ONLY these fields: `messages`, `system_instruction`, `previous_interaction_id`. Each message is exactly `{role, text}` with role `user` or `model` and text 1–2000 chars; 1–20 messages; the last message must be role `user`; total text ≤ 40,000 chars; the whole body ≤ 16 KB UTF-8 bytes. The adapter sends ONE message only — the last user message — because the Worker forwards only the last user message upstream and a full history would exceed the 16 KB body limit. `system_instruction` is a string built from IDENTITY_CONFIG at request time (~1.2 KB). `previous_interaction_id` is a string matching `/^[A-Za-z0-9][A-Za-z0-9 _-]{0,255}$/`; omit it (do not send an empty string) when there is no previous interaction.

**Success response (HTTP 200).** `{text, interaction_id, remaining}`. `text` is the reply text. `interaction_id` is the new interaction id — the adapter stores it as the chain id for the next request. `remaining` is the authoritative remaining-request count for the day (an integer in [0, 20] — the daily cap is 20). This is the ONLY authoritative count. The adapter must use this value, not a locally computed one. A value outside [0, 20] (or not an integer) is treated as "no authoritative count" (see §6); the reply text and chain id are still applied.

**Errors.** The Worker returns these, and the adapter must map them as shown (Repair 2 classification — do not change the mapping without Maya's review):

| HTTP | Worker error | Adapter message (shown to the user) |
|---|---|---|
| 403 | `forbidden` | The Origin is not allowed. |
| 400 | `bad_request` | The request was not valid. |
| 413 | `payload_too_large` | The message is too long. |
| 415 | `unsupported_media_type` | The request must be JSON. |
| 500 | `proxy_not_configured` | The proxy's model key is not set. |
| 429 | `rate_limited` / `daily_limit_reached` / `upstream_rate_limited` | The limit message for that code (daily limit reached when the cap is used up). |
| 502 | `upstream_auth_failed` | "The proxy's model key was rejected. Check the Worker secret." |
| 502 | `upstream_permission_denied` | The model key does not have permission for this request. |
| 502 | `upstream_overloaded` | "Gemini is overloaded right now. Wait a little and try again." |
| 502 | `upstream_timeout` | The model took too long to reply. |
| 502 | `upstream_unreachable` | Gemini could not be reached. |
| 502 | `upstream_bad_json` | Gemini returned a reply the proxy could not read. |
| 502 | `upstream_empty_reply` | Gemini returned no usable reply. |
| 502 | `upstream_error` (generic) | "Gemini did not return a usable reply. Try again." Never present this as overload. |
| 503 | `service_unavailable` | The proxy is unavailable. |

**Request flow order (Worker).** OPTIONS preflight → path/method → Origin allowlist → content-type → body size/parse → shape validation → key-configured check (500 `proxy_not_configured`) → per-IP limit (5/min, Durable Object) → daily cap reservation (Durable Object) → upstream call. The key check precedes both Durable Object calls, so a request with no key set consumes 0 cap and makes 0 upstream calls. The daily cap slot is reserved BEFORE the upstream call and is NEVER refunded on failure (including timeouts and overloads). A failed attempt consumes a slot.

**Upstream (for reference; the adapter never calls it).** `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key` only (no Api-Revision header). Body: `{model, input, system_instruction, previous_interaction_id, generation_config: {thinking_level: 'medium'}}` where `model` is `gemini-3.5-flash-lite` and `input` is the last user message as a plain string. The reply text is at `steps[].content[].text` where `steps[].type` is `model_output`; the interaction id is the top-level `id`. The Worker timeout is 30 s.

**Origin allowlist.** The Worker accepts requests only from `https://taaarrrell.github.io`. Echo's UI must be served from that host. A different host needs an owner decision and a Worker redeploy.

## 4. Contract B — the adapter JS API (what Echo's UI calls)

The adapter exposes this surface to Echo's UI. Echo calls it; Echo does not reimplement it.

- **`Adapter.send(text)`** — handles BOTH modes (confirmed). In Live mode it sends one user message to the Worker and returns a promise that resolves to `{text, remaining}` on a live reply, or rejects with a typed error (§5) on failure. In Simulated mode it returns a scripted reply from the existing M1 simulated reply set, resolving to `{text, remaining: 'unknown'}` (simulated replies do not consume cap, so there is no live count to report). Echo does NOT keep a separate scripted-reply system and does NOT implement simulated replies — the adapter owns the mode routing and the simulated reply set. The adapter never returns a simulated reply when the mode is Live. In Live mode the adapter sends only the last user message, builds the system instruction from IDENTITY_CONFIG at request time, attaches the stored chain id as `previous_interaction_id` when one exists, and stores the returned `interaction_id` as the new chain id. On a Live failure it does NOT add a reply, does NOT change the saved history, and does NOT retry.
- **`Adapter.setMode(mode)`** — `mode` is `'live'` or `'simulated'`. Switching to Live does not send anything. The mode defaults to `'simulated'` on every page load — the adapter must not remember Live across loads. **Mode switching (v2):** switching mode does NOT abort an in-flight request. The in-flight request completes and its reply is added, tagged with the mode it was sent in. The mode switch only affects future sends. Returns the new mode.
- **`Adapter.getMode()`** — returns the current mode.
- **`Adapter.getRemaining()`** — returns the last authoritative `remaining` count from a successful live reply, or the string `'unknown'` if no live reply has returned a count yet. See §6 for the display rules.
- **`Adapter.isCountStale()`** — (v2) returns true when the count may be out of date: (a) before any live reply (no count yet), (b) after any error (Worker failure, network failure, timeout), (c) after a cancellation that may have consumed a slot, (d) when the UTC day has rolled over since the count was set (the count belongs to a day whose cap has reset), (e) when a live request spanned midnight UTC and its count was invalidated conservatively, (f) when the last reply carried no authoritative count (missing, non-integer, or out-of-range `remaining`). Returns false only immediately after a successful live reply whose count is fresh. The UI uses this to decide whether to show a stale marker (§6).
- **`Adapter.getChainId()`** — returns the stored chain id, or `null`. The chain id lives in its own localStorage key, `maya-alpha-0-2-chain-v0.1` (v2 — isolated Alpha 0.2 storage; see below), validated against the interaction-id pattern; an invalid stored value is dropped. Clearing the conversation drops the chain id (a fresh chain starts on the next live message).
- **`Adapter.clear()`** — clears the saved conversation and the chain id. Works while a reply is pending: it aborts the pending request and retires its generation so a late reply is never added. If no request was in flight, the count freshness is unchanged. If a request was in flight and got cancelled, the count is marked stale (the request may have reserved a slot before the abort).

**Concurrent requests (v2).** Only ONE `send()` may be in flight at a time (live or simulated). A second `send()` while one is pending rejects immediately with code `busy`, kind `concurrent` (§5.5). It does not disturb the in-flight request and does not consume a cap slot. The in-flight request completes normally.

**Timeouts.** The adapter's client timeout is 35 s (a race plus abort), slightly longer than the Worker's 30 s upstream timeout. A reply that arrives after the timeout is discarded, never added.

**No retries.** Neither the adapter nor the UI retries a failed live request automatically. A retry is a new user action (the user sends the message again), and it consumes a new cap slot.

**Simulated mode (confirmed).** `Adapter.send(text)` handles Simulated mode. When the mode is Simulated, the adapter returns a scripted reply from the existing M1 simulated reply set — the same replies Alpha 0.1 used (greeting, who-are-you, help/capabilities, fallback; see the implementation for the exact text). Echo does NOT keep a separate scripted-reply system and does NOT implement simulated replies; the adapter owns the mode routing and the simulated reply set. The simulated reply content is part of M.A.Y.A.'s conversational behavior (derived from the identity), so Echo does not change it; changes to it need Maya's approval. Simulated mode never substitutes silently for a failed live reply: when the mode is Live, a failure rejects with the typed error (§5) and adds no reply — it never falls back to a simulated reply.

**Isolated Alpha 0.2 storage (v2).** The adapter uses ONLY the Alpha 0.2 keys. Chain id: `maya-alpha-0-2-chain-v0.1`. (The UI's conversation history key, owned by the UI and not the adapter, is `maya-alpha-0-2-conversation-v0.1`.) The adapter never reads or writes the Alpha 0.1 keys (`maya-alpha-chain-v0.1`, `maya-alpha-conversation-v0.1`). The frozen Alpha 0.1 baseline and its stored state are untouched.

## 5. Typed errors

`Adapter.send(text)` rejects (never resolves) on failure, with a typed error object. Echo's UI must branch on the error's `code`, not on the message text. The error shape is `{ code, kind, message }`:

- `code` — a stable machine-readable string, enumerated below.
- `kind` — one of `'worker'`, `'network'`, `'timeout'`, `'cancelled'`, `'concurrent'`.
- `message` — the user-facing message, or `null` for a cancellation (which the UI must not display).

### 5.1 Worker failures (kind: `'worker'`)

The Worker returned an error response. `code` is the Worker's error code from §3 (for example `upstream_overloaded`). `message` is the §3 user-facing message. The UI shows the message. No automatic retry.

Cap slot: consumed for the 502 codes and for `upstream_rate_limited` (the slot was reserved before the upstream call). NOT consumed for `forbidden`, `bad_request`, `payload_too_large`, `unsupported_media_type`, `proxy_not_configured`, `rate_limited` (per-IP) or `daily_limit_reached` (these fail before the daily cap reservation). For `service_unavailable` (503) the slot is unknown — treat the count as stale (§6).

### 5.2 Network failures (kind: `'network'`)

The fetch to the Worker failed before any response was received — network down, DNS failure, the Worker host unreachable, a CORS failure. `code: 'network_error'`. `message: "Could not reach the proxy. Check your connection and try again."` This is adapter→Worker, and is distinct from the Worker's `upstream_unreachable` (Worker→Gemini). Cap slot: unknown — the request may or may not have reached the Worker. The UI shows the message and marks the count as stale (§6).

### 5.3 Timeouts (kind: `'timeout'`)

No response arrived within the adapter's 35 s client timeout, so the adapter aborted the request. `code: 'client_timeout'`. `message: "The reply took too long. Try again."` This is the adapter's own 35 s abort, and is distinct from the Worker's `upstream_timeout` (the Worker's 30 s upstream timeout, returned as a 502 with code `upstream_timeout`). Cap slot: likely consumed (the Worker reserves the slot before the upstream call), but not confirmed — mark the count as stale (§6). A reply that arrives after the timeout is discarded, never added. The timeout covers the whole send, including response-body parsing: if the timeout fires while the body is being parsed, the abort makes the parse fail, and that failure settles as `client_timeout` — never as `upstream_bad_json`. A parse failure is `upstream_bad_json` only when it is genuine (malformed JSON, no abort, no timeout).

### 5.4 Cancellation by clear() (kind: `'cancelled'`)

The user cleared the conversation while a reply was pending. `Adapter.clear()` aborts the pending request and retires its generation. The pending `Adapter.send()` promise rejects with `code: 'cancelled'`, `kind: 'cancelled'`, `message: null`. The UI must NOT display an error for a cancellation — it is a user-initiated action, not a failure. A late reply from the cancelled generation is never added. Cap slot: unknown (the request may have reached the Worker and reserved a slot before the abort) — mark the count as stale (§6).

### 5.5 Concurrent requests (kind: `'concurrent'`) — v2

A second `send()` was called while one was already in flight. `code: 'busy'`, `kind: 'concurrent'`, `message: "A reply is already in progress. Wait for it to finish."` The in-flight request is unaffected and completes normally. The rejected second call does not consume a cap slot and does not change the count freshness. The UI should treat this as a transient state (for example, disable the send control while a reply is pending) rather than an error to display prominently.

### 5.6 Rules for the UI

- Branch on `code`, never on `message` text. The messages are user-facing copy and may change; the codes are the contract.
- Never retry automatically for any error kind. A retry is a new user action (the user sends the message again) and consumes a new cap slot.
- On any error, do NOT add a reply and do NOT change the saved history.
- On `cancelled`, show nothing. On `busy`, show at most a transient hint (or nothing — the send control should already be disabled while a reply is pending). On every other error, show the `message` and mark the count as stale (or show "unknown") per §6.

## 6. Count display rules (from the Activation Report corrections)

These rules are binding on the Alpha 0.2 UI. They fix the display quirk found in the Gate 3 smoke test, where after a failed R3 attempt the UI briefly overstated what was left (it showed 9 when the true count was 8), because the failed attempt consumed a slot but the display did not update.

- **No authoritative count yet → show "unknown".** Before the first successful live reply, the UI must not show a number. Show "unknown" (or an equivalent neutral state), not a guessed count and not the cap (20). `Adapter.isCountStale()` returns true in this state.
- **After a successful live reply → show the returned `remaining`.** That value is authoritative. It comes from the Worker's 200 response, not from local arithmetic. `Adapter.isCountStale()` returns false.
- **After an error → use a fresh count if available, or mark the last count as stale.** A failed attempt consumes a slot, but the error response carries no new count. So after an error the UI must either fetch a fresh authoritative count (if the Worker exposes one on a non-consuming read — it currently does not, so this is a future option, not a current behavior) or mark the last displayed count as stale (for example "9 left (may be out of date)" or an equivalent stale marker). It must never present the pre-error count as current. `Adapter.isCountStale()` returns true.
- **UTC day rollover → the count goes stale.** The count is for the UTC day (the cap resets at midnight UTC). If the page stays open across midnight UTC, the count from the old day is stale and `Adapter.getRemaining()` returns `'unknown'`. The adapter records the UTC date the count was set on and compares it on every access; the count is in-memory only (never persisted).
- **A live request spanning midnight UTC → the count is invalidated conservatively (v2.1).** If a send starts before midnight and its reply arrives after midnight, the count in that reply belongs to the old day. The adapter still returns the reply text and stores the chain id, but the count is dropped: the send resolves with `remaining: 'unknown'` and `Adapter.isCountStale()` is true. (The conversation happened; only the count is invalidated.)
- **Remaining counts are validated as integers in [0, 20] (v2.1).** An authoritative count must be an integer between 0 and 20 inclusive (the daily cap is 20). A fractional, negative, over-cap, NaN, infinite, string or null value is treated as "no authoritative count": the reply text and chain id are still applied, the previous remaining value is kept, and the count is marked stale. The UI never has to validate the count itself — the adapter only ever hands it a valid integer or `'unknown'`.
- **Never overstate what is left.** When in doubt, show "unknown" or mark stale. Understating (or showing unknown) is safe; overstating is not.

## 7. Safety behaviors the UI must preserve

Echo's visual work may change how these look, not whether they exist:

- Mode defaults to Simulated on every load. Live is an explicit, per-load choice.
- A LIVE badge and the remaining-cap display are shown when live. A SIMULATED badge is shown when simulated.
- A live failure shows the §5 error message openly and adds no reply. Never a silent simulated fallback.
- No automatic retries anywhere.
- No secrets in the page. No API key, no token, no credential in the HTML, JS, CSS, docs or tests. The Worker URL is public by design; the key is not.
- No direct upstream calls from the page. The UI calls the adapter; the adapter calls the Worker; the Worker calls Gemini.
- The identity panel renders IDENTITY_CONFIG as-is. The UI may render it; it may not rewrite it. IDENTITY_CONFIG is Maya-owned.

## 8. Chaining and the interaction id

Multi-turn continuity works through the server-side chain: each live request sends the previous reply's `interaction_id` as `previous_interaction_id`, and the upstream returns a new `interaction_id`. The adapter stores the chain id in `maya-alpha-0-2-chain-v0.1` (v2 — isolated Alpha 0.2 storage) and attaches it to the next request. That is the mechanism. Whether it is working is verified by a probe, not assumed: send a message that refers to something from an earlier turn that is NOT in the system instruction (for example "What was the organizing idea you suggested earlier?" — the Rule of Three is in the conversation, not in the identity config). A correct answer supports context carryover. To verify the specific `previous_interaction_id` mechanism, also check that the request used the expected interaction id and that the answer was not supplied in the current request. A miss or another overload leaves chaining unverified. (Gate 3 status: PASS as of Nov 24, 2026 — the chaining probe returned the expected "Rule of Three" (see the Consolidated Activation Report §3.3). The mechanism verification rests on behavioural evidence; direct payload observation was not possible because the browser could not open DevTools or evaluate JavaScript.)

## 9. File ownership and change rules

- `shared/adapter.js` (the adapter) — Snoopy owns. Echo consumes its §4 API and must not change its internals.
- `shared/identity.js` (IDENTITY_CONFIG) — Maya owns. Neither engineering agent edits it.
- `frontend/` (Echo's UI) — Echo owns. Echo calls the adapter; Echo does not reimplement the Worker contract.
- `backend/` (Worker, Durable Object, wrangler.toml, tests) — Snoopy owns.
- The §3 error mapping, the §5 typed errors, the §6 count display rules, and the §7 safety behaviors change only by a pull request that both agents review and Maya approves. `MODEL_ID` and `DAILY_CAP` in wrangler.toml change only by owner decision.
- Tests gate the integration branch: the proxy suite (40 tests) and the adapter suite (52 tests, Alpha 0.1) plus the Alpha 0.2 suites must pass before a pull request merges into `integration`. A pull request that breaks a test does not merge. The Alpha 0.2 suites (all synthetic, jsdom + mock fetch + mock localStorage, no live calls): the adapter unit suite `test/test-adapter-0-2.cjs` (42 tests), the adapter integration suite `test/test-adapter-integration-0-2.cjs` (6 tests, simulating a minimal UI consumer), and Echo's `tests/adapter-regressions.cjs` (3 tests, provided verbatim by Echo via the owner). Current regression: 42/42 + 6/6 + 3/3 = 51/51 PASS, exit 0 (verified Nov 25, 2026).

## 10. What Echo needs from Snoopy next

- The `shared/adapter.js` file itself, written to this contract (prepared locally under Assignment S01; it lands in the shared repo once it exists).
- The Worker URL and the current model/cap (`gemini-3.5-flash-lite`, cap 20) as configuration, so Echo's UI never hardcodes them.
- The chaining probe ran Nov 24, 2026, 23:30 PST and returned the expected "Rule of Three" — Gate 3 is PASS. Echo may build multi-turn visual behavior on the chain. (Mechanism verification rests on behavioural evidence; see §8.)
