# M.A.Y.A. Alpha 0.2 — S01 Foundation Package for Integration (Consolidated Report)

**Date:** November 25, 2026
**Author:** Muse (Snoopy) — backend engineering
**Assignment:** Prepare the S01 foundation for integration, locally. Three adapter corrections (the two assigned corrections plus the supplemental abort/timeout correction from Echo/Maya), a synthetic adapter integration test, an Echo coordination note, and updated documentation. Return the consolidated foundation package and regression results.
**Authorization:** Local preparation and synthetic testing only. No repository mutations, no merges, no publishing, no deployments, no live API calls, no credential changes, no spending. All work was done inside `~/workspace/your_files/maya-alpha-0-2-s01/` only. Nothing was pushed to any repository. The frozen Alpha 0.1 baseline was not touched (verified: the local Alpha 0.1 interface file still hashes to `886b80bf…`, unchanged).
**Status:** READY FOR INTEGRATION. All three corrections are applied and tested, the integration test passes, Echo's regressions pass (including the abort-aware acceptance check), the docs are updated, and the full regression is 51/51 PASS on two consecutive runs.
**Verdict:** The foundation package is ready to land in `taaarrrell/maya-alpha-0-2` via PR into `integration` once the owner authorizes it. No further preparation is needed from Snoopy before that step.

## 1. Regression results — 51/51 PASS, exit 0, two consecutive runs

Run with `NODE_PATH=/home/hatch/workspace/your_files/maya-alpha-2a/node_modules node <suite>` (jsdom via NODE_PATH; no install, no network). All synthetic, mock fetch + mock localStorage + injectable clock only.

| Suite | File | Result | Exit |
|---|---|---|---|
| Adapter unit | `test/test-adapter-0-2.cjs` | **42/42 PASS** (32 original + 10 new) | 0 |
| Adapter integration | `test/test-adapter-integration-0-2.cjs` | **6/6 PASS** (new) | 0 |
| Echo adapter-regressions | `tests/adapter-regressions.cjs` | **3/3 PASS** (verbatim, unmodified) | 0 |
| **Total** | | **51/51 PASS** | **0** |

The full regression was run twice consecutively with identical results (42/42 + 6/6 + 3/3 both times). Echo's final case — "adapter abort-aware body reports client_timeout" — is the acceptance check for the supplemental correction, and it PASSES.

## 2. The three adapter corrections

All in `shared/adapter.js` (SHA-256 `2fef0799…`, 651 lines; was `c58f6a1c…`, 561 lines). The adapter remains plain JavaScript, no dependencies, UMD (browser `<script>` → `window.MayaAlpha02`; Node → `module.exports`). No secret, no credential, no auth header (verified by source sweep; the only URL is the public Worker address as configuration).

### Correction 1 — Conservative quota invalidation for requests spanning midnight UTC

**Finding:** the remaining count is for the UTC day (the cap resets at midnight UTC). The adapter already invalidated a stored count when the UTC date changed between `getRemaining()`/`isCountStale()` accesses, but it did NOT handle a live request IN FLIGHT across midnight UTC: if a send started before midnight and its reply arrived after midnight, the count in that reply belongs to the old day yet was recorded with the new day's date and treated as fresh.

**Change:** the UTC date (YYYY-MM-DD, via the injectable `nowImpl` clock) is now recorded when a live send STARTS (`sendDate`, captured in `runLiveSend` and passed to `handleLiveResponse`). On a successful reply, the current UTC date is compared to `sendDate`; if they differ, the count is invalidated conservatively — `remaining` and `countDate` are dropped (set to null), the count is marked stale, and the send resolves with `remaining: 'unknown'`. The reply text and chain id are still applied (the conversation happened; only the count is invalidated). If the dates match, the count is applied normally.

**How the tests prove it:**
- A-33: send starts 23:59:50Z, reply arrives 00:00:05Z next day with remaining 19 → reply text returned, chain id stored, `remaining` `'unknown'`, `getRemaining()` `'unknown'`, `isCountStale()` true.
- A-34 (control): send starts and completes within the same UTC day → count applied fresh (remaining 17, `isCountStale()` false).
- A-35 (control): send starts 23:59:50Z and reply arrives 23:59:55Z (still before midnight) → count applied fresh (remaining 18).

### Correction 2 — Validation of remaining counts as integers in [0, 20]

**Finding:** the daily cap is 20, so `remaining` must be an integer in [0, 20]. The adapter previously accepted any finite number.

**Change:** `remaining` is accepted only if it is a number, finite, an integer (`Math.floor(rem) === rem`, ES5-compatible, no `Number.isInteger` dependency), and `0 <= rem <= DAILY_CAP` (new constant `DAILY_CAP = 20`, exposed in the adapter's constants). Anything else (20.5, -1, 21, NaN, Infinity, a string, null) is treated as "no authoritative count" — the reply text and chain id are still applied, the previous remaining value is kept, and the count is marked stale (the same handling as the existing missing/non-number case).

**How the tests prove it:**
- A-36: remaining 20.5 on a first reply → stale, `'unknown'`, chain id stored, text returned.
- A-37: after a valid count (15, fresh), a reply with remaining -1 then a reply with remaining 21 → each resolves with the previous value (15), `isCountStale()` true, chain id updated, text returned.
- A-38: remaining `"5"` (string) on a first reply → stale, `'unknown'`, chain id stored.
- A-39: remaining 0 → valid, fresh, 0; remaining 20 → valid, fresh, 20 (both boundary values applied).

### Correction 3 (supplemental, from Echo, independently reproduced by Maya) — Timeout settlement takes precedence over abort-induced parse failures

**Finding:** an abort-aware response-body parser incorrectly produced `upstream_bad_json` (kind `worker`) when the client timeout triggered an abort. Expected `client_timeout` (kind `timeout`).

**Root cause (as reported):** when the client timeout fires, it aborts the fetch controller. If the response body is being parsed at that moment, the abort makes the parse promise reject (AbortError), and the adapter's parse-failure path mapped that to the PARSE_FAILED sentinel → `upstream_bad_json`. But that parse failure was CAUSED by the timeout abort, not by genuinely malformed JSON.

**Change:**
- `runLiveSend` tracks a per-generation `timeoutState = {fired: false}`; the timeout callback sets `fired = true` BEFORE aborting the controller, so any parse rejection caused by the abort always sees it.
- `parseJsonBody` no longer converts an AbortError into the PARSE_FAILED sentinel — an AbortError from `.json()`/`.text()` is rethrown, so the caller can distinguish an abort from malformed JSON.
- In `handleLiveResponse`, a PARSE_FAILED result when `timeoutState.fired` is true settles as `client_timeout` (the timeout takes precedence); otherwise it is `upstream_bad_json`. In the parse chain's outer `.catch`, an AbortError OR a rejection that arrived after the timeout fired for that generation settles as `client_timeout`; a genuine parse failure (no abort, no timeout) is still `upstream_bad_json`.
- Generation isolation is preserved: the timeout state is per-generation (a closure object, never read from the shared `pending` object), and a timed-out or cancelled generation's late parse failure is discarded by the generation check and never touches a newer generation's timers or settlement.

**How the tests prove it:**
- A-40: a mock fetch resolves with a response whose `.json()` rejects with an AbortError when the request is aborted (the mock listens to the AbortSignal), with a 120 ms timeout. The send rejects with code `client_timeout`, kind `timeout` (NOT `upstream_bad_json`/`worker`); the test asserts the abort was actually delivered to the mock body reader (so the AbortError path was genuinely exercised), and the chain id is not stored / the count is stale. (On the pre-fix code this test would settle as `upstream_bad_json`, because the abort-triggered parse rejection is queued before the timeout's race settlement.)
- A-41: a mock fetch whose `.json()` rejects with a SyntaxError (genuinely malformed JSON, no abort, 5000 ms timeout) → the send rejects with code `upstream_bad_json`, kind `worker` (genuine classification preserved).
- A-42 (generation isolation): a timed-out send (gen 1, `.json()` rejects with AbortError on abort) followed by a newer live send (gen 2, normal success) → gen 1 rejects `client_timeout`, gen 2 completes normally with its reply, remaining 14, chain id stored, count fresh.

## 3. Synthetic adapter integration test (new file)

`test/test-adapter-integration-0-2.cjs` (SHA-256 `52a13e42…`, 294 lines). It simulates a minimal UI consumer the way Echo's frontend will use the adapter: it creates an adapter (mock fetch + mock localStorage + injectable clock), sends messages in Simulated and Live mode, and persists the conversation (user + model messages) to a mock storage under the UI's history key `maya-alpha-0-2-conversation-v0.1`. **6/6 PASS, exit 0.**

- I-01: a simulated send persists the conversation (user + model) under the 0.2 history key; no chain id is set; no fetch is called.
- I-02: a live send persists the conversation and stores the chain id under the 0.2 chain key `maya-alpha-0-2-chain-v0.1`; a second live send chains by `previous_interaction_id`.
- I-03: the consumer and adapter together touch ONLY the 0.2 keys (`maya-alpha-0-2-chain-v0.1`, `maya-alpha-0-2-conversation-v0.1`) — the Alpha 0.1 keys (`maya-alpha-chain-v0.1`, `maya-alpha-conversation-v0.1`) are never read or written (the mock storage records every touched key; the touched set is exactly the two 0.2 keys).
- I-04: a typed error (mock fetch returns 502 `upstream_overloaded`) → the consumer receives code `upstream_overloaded`, kind `worker`, and does NOT add a model reply (the user message stays in history; the persisted history is unchanged).
- I-05: a concurrent second send is rejected with `busy` (kind `concurrent`) and the first send completes and persists.
- I-06: `clear()` drops the chain id and the consumer can clear the history key (both keys removed from storage; a fresh live send after the clear starts a new chain with no `previous_interaction_id`).

## 4. Echo's adapter-regressions.cjs

`tests/adapter-regressions.cjs` (SHA-256 `b12bf2bd…`, 3,754 B, 81 lines) — a verbatim copy of the file the owner provided (recovered by Maya from the E01 integrated package). **Do NOT modify it.** It was NOT found in the workspace or in Echo's ui-preview repo at `adapter-regressions.cjs`, `test/adapter-regressions.cjs`, `tests/adapter-regressions.cjs`, or `shared/adapter-regressions.cjs` (all 404; the earlier search is recorded here for the record) — it arrived via the owner after that search. It runs standalone with node and the same NODE_PATH jsdom setup. **3/3 PASS, exit 0:**

```
PASS adapter simulation never invokes transport, same-day count and UTC expiry
PASS adapter busy, reset abort, late parse isolation, newer timeout, explicit recovery
PASS adapter abort-aware body reports client_timeout
```

Its final case is the acceptance check for the supplemental correction (Correction 3 above): it FAILS with "expected client_timeout/timeout, observed upstream_bad_json/worker" if the correction is not in place, and PASSES with "adapter abort-aware body reports client_timeout" once applied. It passes.

## 5. Echo coordination note (new file)

`ECHO_COORDINATION_NOTE_2026-11-25.md` (SHA-256 `e9777916…`, 11,882 B). Addressed to Echo (frontend). It describes: the adapter API (`createAdapter` options including `nowImpl`, `send`/`setMode`/`getMode`/`getRemaining`/`isCountStale`/`getChainId`/`clear`); the typed errors and how the UI branches on `code` (never on message text); the count display rules including the UTC reset, the spanning-midnight invalidation, and the integer 0–20 validation; the storage keys (adapter owns `maya-alpha-0-2-chain-v0.1`; the UI owns `maya-alpha-0-2-conversation-v0.1`; never touch the Alpha 0.1 keys); Simulated mode behaviour; the synthetic integration test (how to run it, what it proves); and the next step (the foundation lands via PR into `integration`; Echo reviews Snoopy's PR; Echo's frontend integrates the adapter). No direct contact with Echo was attempted (no direct channel exists); this note is the coordination surface.

## 6. Updated documentation (local S01 package files only — they land in the repo via PR, where Maya reviews and approves them; nothing was pushed)

- **Adapter Contract v2.1** — `MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_1_2026-11-25.md` (SHA-256 `acad7b9f…`, 26,083 B). The v2 file (`0e94d623…`) is kept for the record, unchanged. v2.1 adds a changelog entry for all three corrections (spanning-midnight quota invalidation, remaining integer 0–20 validation, timeout precedence over abort-induced parse failures) and updates: the §3 success response (remaining is an integer in [0, 20]), the §4 `isCountStale()` conditions (UTC rollover, spanning-midnight invalidation, no authoritative count), the §5.3 timeout description (the timeout covers body parsing; an abort-induced parse failure settles as `client_timeout`, not `upstream_bad_json`), the §6 count display rules (UTC rollover, spanning-midnight, integer validation bullets), and the §9 test gates (51/51). Everything else is unchanged.
- **PROJECT_STATUS.md** (SHA-256 `e7ae8356…`, 8,714 B) — status updated (repo created Nov 25, 2026; README initialized, commit `6e676641…`; "Protect main" ruleset Active; S01 READY FOR INTEGRATION; regression 51/51); the seven decisions (all resolved, with the repo/ruleset state current); next steps (owner confirms Maya's/Echo's GitHub access; Maya issues Echo's assignment; Snoopy lands the foundation via PR into `integration` once the owner authorizes it); Snoopy's section updated. Scope is described as the verified state only: the visual embodiment integrated with the existing adapter and backend, plus the adapter corrections and the foundation package ready for integration — no scope beyond what is verified.
- **AGENTS.md** (SHA-256 `4c2e5631…`, 7,897 B) — test gates updated (42 unit + 6 integration + 3 Echo regressions = 51/51), adapter contract version updated to v2.1, repo/ruleset status added (repo exists; "Protect main" Active with its rules). Roles, file ownership and safety boundaries unchanged.

## 7. File inventory (all inside `~/workspace/your_files/maya-alpha-0-2-s01/`)

| File | SHA-256 | Size | Change |
|---|---|---|---|
| `shared/adapter.js` | `2fef0799…` | 651 lines (was 561) | Three corrections (spanning-midnight, integer 0–20, abort/timeout parse precedence) + `DAILY_CAP` constant |
| `test/test-adapter-0-2.cjs` | `b69b4320…` | 923 lines (was 705) | 10 new tests A-33–A-42; the 32 existing tests unchanged and passing |
| `test/test-adapter-integration-0-2.cjs` | `52a13e42…` | 294 lines | NEW — synthetic UI-consumer integration test (6/6) |
| `tests/adapter-regressions.cjs` | `b12bf2bd…` | 3,754 B, 81 lines | NEW (verbatim, unmodified) — Echo's regressions (3/3) |
| `ECHO_COORDINATION_NOTE_2026-11-25.md` | `e9777916…` | 11,882 B | NEW — coordination note for Echo |
| `MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_1_2026-11-25.md` | `acad7b9f…` | 26,083 B | NEW — contract v2.1 |
| `MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_2026-11-24.md` | `0e94d623…` | 21,448 B | Unchanged, retained for the record |
| `PROJECT_STATUS.md` | `e7ae8356…` | 8,714 B | Updated (status, decisions, next steps) |
| `AGENTS.md` | `4c2e5631…` | 7,897 B | Updated (test gates, contract v2.1, repo/ruleset status) |
| `test/fixtures/*.json` (4 files) | unchanged | — | Unchanged |

## 8. What was NOT done / notes for the parent agent

- **Branch rules and PR permissions verification** was not part of this local task (the subagent brief listed five items, all local). For the record, the parent agent already verified these: the repo `taaarrrell/maya-alpha-0-2` exists (public, `main`), the "Protect main" ruleset is Active (require PR + 1 approval, block force pushes, block deletions, no bypass list), and the branch/PR tools are available in the connector. Nothing in this task changed the repo or its rules.
- **Echo's adapter-regressions.cjs** was not available in the workspace or in Echo's ui-preview repo when first searched (all four checked paths returned 404); it was provided by the owner afterwards (recovered by Maya from the E01 integrated package) and placed at `tests/adapter-regressions.cjs` verbatim. It passes 3/3. No file was invented.
- **No Worker redesign.** The corrections are adapter-only; the /chat contract, the Worker, the Durable Object and the cap (20) are unchanged.
- **No repository mutations, merges, publishing, deployments, live API calls, credential changes or spending.** All testing was synthetic (jsdom + mock fetch + mock localStorage + injectable clock). The frozen Alpha 0.1 baseline was not touched.
- **Scope note:** the Alpha 0.2 scope is described in the docs only as the verified state — the visual embodiment integrated with the existing adapter and backend, plus the adapter corrections and the foundation package ready for integration. No expanded scope was invented.

## 9. Verdict

**READY FOR INTEGRATION.** The S01 foundation package is complete: three adapter corrections (all tested), a synthetic integration test proving the adapter works the way Echo's UI will use it, Echo's regressions passing (including the abort-aware acceptance check), a coordination note for Echo, and updated docs (contract v2.1, PROJECT_STATUS.md, AGENTS.md). Full regression 51/51 PASS, exit 0, on two consecutive runs. The package lands in `taaarrrell/maya-alpha-0-2` via PR into `integration` once the owner authorizes it. The remaining steps are the owner's (authorize the foundation PR; confirm Maya's and Echo's GitHub access) and Maya's (issue Echo's assignment; approve the PR).
