# M.A.Y.A. Alpha 0.2 — AGENTS.md

**Repository:** `maya-alpha-0-2` (public, synthetic-only, disposable)
**Owner:** Tarell (creative direction, final authority)
**Coordinator:** Maya (chief architecture, coordination, integration, design review)
**Last updated:** November 25, 2026 (integration foundation, Snoopy)

This file is the working rules for the shared repository. It is Maya-owned. Changes need Maya's approval. It does not authorize anything by itself — merges, deploys, secret changes and permission changes need the owner's explicit statement.

**Repository status:** the repo exists (created by the owner Nov 25, 2026; default branch `main`; initialized with a README.md, commit `6e676641…`). `main` is protected by the "Protect main" ruleset (Active, ruleset id `28060838`): targets only `main`; require a pull request with 1 approval; block force pushes; block branch deletion; no bypass list. (The GitHub connector cannot set rulesets; this one was created in the cloud browser, and the owner completed the "Confirm access" verification in person via GitHub Mobile.)

## Roles

- **Owner (Tarell):** creative direction and final authority. Creates the repo, installs the GitHub App, executes GitHub actions on an agent's written instruction where that agent lacks access, and authorizes `integration` → `main`, deployments, and any live calls or spending.
- **Maya:** chief architecture, coordination, integration and design review. Owns PROJECT_STATUS.md, AGENTS.md, `shared/identity.js` (IDENTITY_CONFIG) and `docs/decisions/`. Approves pull requests and contract changes. Issues the consolidated assignments.
- **Snoopy (Muse):** backend engineering, reasoning integration, security. Owns `backend/` and `shared/adapter.js`. Reviews Echo's pull requests.
- **Echo (ChatGPT Work):** frontend engineering, visual embodiment, parallel implementation. Owns `frontend/`. Reviews Snoopy's pull requests.

## Branches

- `main` — stable. Protected: pull request + Maya approval required, no direct pushes. Only the owner authorizes a merge into `main`, and only from `integration`.
- `integration` — the integration branch. Feature branches merge here by pull request. Nothing merges into `integration` with a failing test suite.
- `snoopy/<feature>` — Snoopy's feature branches.
- `echo/<feature>` — Echo's feature branches.

One pull request per feature, into `integration`. The other engineering agent reviews it. Maya approves it. The owner authorizes `integration` → `main`.

## File ownership

| Path | Owner | Rule |
|---|---|---|
| `frontend/` | Echo | Echo's visual UI. Calls the adapter; never reimplements the Worker contract. |
| `backend/` | Snoopy | Worker, Durable Object, wrangler.toml, tests. |
| `shared/adapter.js` | Snoopy | The adapter (Adapter Contract v2.1). Echo consumes its API and must not change its internals. |
| `shared/identity.js` | Maya | IDENTITY_CONFIG. Neither engineering agent edits it. |
| `PROJECT_STATUS.md` | Maya | Agents update their own sections via PR. |
| `AGENTS.md` | Maya | This file. Changes need Maya's approval. |
| `docs/decisions/` | Maya | Decision records. |

No cross-ownership edits. A change to another agent's files needs that agent's review and Maya's approval.

## The adapter contract

The adapter is the only seam between Echo's UI and Snoopy's backend. The contract is `MAYA_ALPHA_0_2_ADAPTER_CONTRACT_v2_1_2026-11-25.md` (v2.1; v2 and v1 retained for the record). It fixes:

- The /chat HTTP contract (Worker ↔ adapter) — Snoopy owns it, versioned, Maya reviews changes.
- The adapter JS API (adapter ↔ Echo's UI) — `Adapter.send(text)` handles both Live and Simulated modes; `setMode`, `getMode`, `getRemaining`, `isCountStale`, `getChainId`, `clear`.
- The typed errors (§5): Worker failures, network failures (`network_error`), timeouts (`client_timeout`), cancellation by `clear()` (`cancelled`, message null, UI shows nothing), concurrent requests (`busy`). The UI branches on `code`, never on message text.
- The count display rules (§6): no authoritative count yet → show "unknown"; after an error → fresh count if available or mark the last count stale; never overstate what is left. The count goes stale when the UTC day rolls over, when a live request spans midnight UTC (its count is invalidated conservatively), and when the last reply carried no authoritative count (missing, non-integer, or out-of-range `remaining` in [0, 20]).
- The safety behaviors (§7): Simulated default on every load, LIVE/SIMULATED badges, no silent simulated fallback, no automatic retries, no secrets in the page, no direct upstream calls, IDENTITY_CONFIG rendered as-is.

The §3 error mapping, the §5 typed errors, the §6 count display rules and the §7 safety behaviors change only by a pull request that both agents review and Maya approves. `MODEL_ID` and `DAILY_CAP` change only by owner decision.

## Tests (gates)

These suites must pass before a pull request merges into `integration`. A pull request that breaks a test does not merge.

- Proxy suite (backend): 40 tests (Miniflare, synthetic only).
- Adapter suite, Alpha 0.1: 52 tests (jsdom, synthetic only).
- Adapter suite, Alpha 0.2: the unit suite `test/test-adapter-0-2.cjs` (42 tests, jsdom, synthetic fixtures only) + the integration suite `test/test-adapter-integration-0-2.cjs` (6 tests, simulating a minimal UI consumer) + Echo's `tests/adapter-regressions.cjs` (3 tests, provided verbatim by Echo via the owner). Current regression: 42/42 + 6/6 + 3/3 = 51/51 PASS, exit 0 (verified Nov 25, 2026).

Run the suites locally before opening a PR. Record the test counts in the PR description.

## Safety boundaries (carry from Alpha 0.1)

- Isolated/synthetic/disposable only. No live Memory Core connection. No autonomous actions or unrestricted delegation. No secrets in any repo, file, doc or test — ever. The Gemini API key lives only as the Worker secret, set by the owner in the Cloudflare dashboard.
- No unapproved spending. No live calls, deployments or credential changes without the owner's explicit authorization for that specific action.
- The frozen Alpha 0.1 baseline (Worker `bd0860d3…`, interface `b1c870a7…`, model `gemini-3.5-flash-lite`, cap 20, repo `taaarrrell/maya-alpha-0-1-test`, commit `d6e01381…`) is not modified by Alpha 0.2 work. Alpha 0.2 uses isolated storage keys (`maya-alpha-0-2-chain-v0.1`, `maya-alpha-0-2-conversation-v0.1`) and never touches the Alpha 0.1 keys.
- Dream Mode and PHINEAS stay paused. Design and specification pages are not implementation.
- The repo does not authorize anything. Merges, deploys, secret changes and permission changes need the owner's explicit statement.

## Coordination

- **PROJECT_STATUS.md** is the shared status. Each agent updates their own section via PR. Maya owns the file.
- **No direct agent-to-agent channel.** Coordination is async through the repo (PRs, reviews, PROJECT_STATUS.md). The owner remains the approval relay. Escalation: note it in PROJECT_STATUS.md → Maya decides → the owner carries it.
- **Human Relay** remains the only channel between Muse and Maya (and Echo) outside the repo. External agents never get unrestricted workspace access.
- **Identity:** `shared/identity.js` (IDENTITY_CONFIG) is Maya-owned. If the UI needs an identity change, ask Maya; do not edit it.
- **Cloudflare deploys** are Snoopy-only, via the `custom.cloudflare-deploy` connector (never `custom.cloudflare`). The Origin allowlist covers `taaarrrell.github.io`; a different domain needs an owner decision.
- **Echo's preview repo** (`maya-alpha-0-2-ui-preview`) remains separate. Echo previews in-progress UI there; the shared repo holds the reviewed baseline. Feature branches in the shared repo have no live Pages preview (Pages serves one branch); review the code and the built file, and preview only after merging to `integration`.
