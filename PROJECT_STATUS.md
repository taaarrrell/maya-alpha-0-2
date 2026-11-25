# M.A.Y.A. Alpha 0.2 — PROJECT_STATUS.md

**Repository:** `maya-alpha-0-2` (public, synthetic-only, disposable)
**Owner:** Tarell (creative direction, final authority)
**Coordinator:** Maya (chief architecture, coordination, integration, design review)
**Backend engineering:** Snoopy (Muse)
**Frontend engineering:** Echo (ChatGPT Work)
**Last updated:** November 25, 2026 (integration foundation, Snoopy)

## Current status

- **Alpha 0.1 is PASS.** Gate 3 passed (formal smoke test Nov 24, 2026, 23:13–23:17 PST + chaining probe Nov 24, 2026, 23:30 PST, "Rule of Three"). The Alpha 0.1 baseline is FROZEN (Worker `bd0860d3…`, interface `b1c870a7…`, model `gemini-3.5-flash-lite`, cap 20, repo `taaarrrell/maya-alpha-0-1-test`, commit `d6e01381…`). Do not modify it. See the Consolidated Activation Report.
- **Alpha 0.2 is in preparation.** Assignment S01 (Snoopy, backend) is the engineering foundation: the refined Adapter Contract v2.1, the shared adapter implementation (prepared locally, synthetic tests only), the synthetic integration test, the Echo coordination note, this file, and AGENTS.md. Echo's visual prototype stays in its own repo (`maya-alpha-0-2-ui-preview`) and is integrated later.
- **The shared repository exists.** `taaarrrell/maya-alpha-0-2` (public, id `1471454182`, created by the owner Nov 25, 2026, 08:00 UTC, default branch `main`). It was initialized with a README.md ("M.A.Y.A. Alpha 0.2: Identity & Embodiment", commit `6e676641…`, verified byte-identical). The "Protect main" ruleset is **Active** (ruleset id `28060838`, created Nov 25, 2026): targets only `main`; require a pull request with 1 approval; block force pushes; block branch deletion; no bypass list. (The GitHub connector cannot set rulesets; the ruleset was created in the cloud browser, and the owner completed the "Confirm access" verification in person via GitHub Mobile.)
- **All seven transition decisions are resolved.** (See "Decisions" below.)
- **Regression: 51/51 PASS, exit 0** (verified Nov 25, 2026, synthetic only): adapter unit suite 42/42, adapter integration suite 6/6, Echo's adapter-regressions 3/3.
- **No live calls, deployments, spending, or credential changes** are part of Alpha 0.2 preparation. Synthetic testing only. No engineering files have been pushed to the shared repo yet — the foundation lands via PR into `integration` once the owner authorizes it.

## Assignments

### S01 — Snoopy (backend engineering) — READY FOR INTEGRATION

Issued by Maya, Nov 24, 2026. Prepare the Alpha 0.2 engineering foundation: refine the Adapter Contract (concurrent requests, mode switching, count freshness, isolated Alpha 0.2 storage); define the repo structure, branch workflow, file ownership and integration tests; prepare the shared adapter implementation locally with synthetic fixtures; prepare PROJECT_STATUS.md and AGENTS.md; verify GitHub permissions and branch protection capabilities (read-only); preserve the frozen Alpha 0.1 baseline and security boundaries; coordinate the adapter interface with Echo. IDENTITY_CONFIG remains Maya-owned. Local preparation and synthetic testing only — no repo mutations, pushes, deployments, live calls, credential changes or spending.

**Deliverables (all in the S01 package, to land in the shared repo via PR into `integration`):** the consolidated readiness report, the refined Adapter Contract v2.1, the shared adapter implementation (`shared/adapter.js`, SHA-256 `2fef0799…`), the adapter unit suite (42/42), the adapter integration suite (6/6), Echo's adapter-regressions (3/3, verbatim), the Echo coordination note, PROJECT_STATUS.md and AGENTS.md. Three corrections were applied after Maya's S01 review: (1) UTC daily-reset count freshness, (2) client timeout coverage through response-body parsing, (3) generation-isolated timers — plus the foundation corrections: conservative quota invalidation for requests spanning midnight UTC, remaining-count validation as integers in [0, 20], and timeout settlement taking precedence over abort-induced parse failures. See the integration foundation report.

### Echo (frontend engineering) — AWAITING ASSIGNMENT

Maya issues Echo's consolidated assignment after the seven decisions (now resolved). Echo's existing preview repo (`maya-alpha-0-2-ui-preview`) remains separate. Echo's Alpha 0.2 work is the visual embodiment (nanoswarm + Crimson/Indigo/Silver protocols) integrated with the adapter's API — no new reasoning or model work.

## Decisions (all seven resolved)

1. **GitHub access for Maya and Echo** — RESOLVED (see the S01 readiness report for the verified permissions; the owner executes GitHub actions on written instruction where an agent lacks access). The repo now exists and Snoopy has write access through the GitHub App (the README was pushed successfully). Branch protection is set via the "Protect main" ruleset (Active). Maya's and Echo's GitHub access still needs confirming on their side.
2. **Repo name and visibility** — RESOLVED. `maya-alpha-0-2`, public, synthetic-only. Created by the owner Nov 25, 2026 (the GitHub App cannot create repos).
3. **Echo's prototype: move or stay?** — RESOLVED. STAY. Echo's preview repo (`maya-alpha-0-2-ui-preview`) remains separate; it is integrated later.
4. **Feature-branch preview** — RESOLVED. Echo previews in its own repo; the shared repo holds the reviewed baseline. (Pages serves one branch, so feature-branch UI in the shared repo has no live preview; review the code and the built file, and preview only after merging to `integration`.)
5. **Gate 3 path** — RESOLVED. Gate 3 is PASS (formal test + chaining probe).
6. **D-M3-2 (free-tier data terms)** — RESOLVED. Owner accepted "Accept for synthetic testing only" (Nov 24, 2026). Synthetic testing only; no real memories, personal info or Memory Core data is ever sent.
7. **Alpha 0.2 scope** — RESOLVED. Alpha 0.2 is the visual embodiment integrated with the existing adapter and backend, with no new reasoning or model work — plus the adapter corrections and the foundation package ready for integration (the three S01 review corrections and the three foundation corrections, all verified by synthetic tests). No scope beyond what is verified here.

## Repository structure (summary; see AGENTS.md for the rules)

```
maya-alpha-0-2/
  frontend/          Echo — visual UI (nanoswarm, protocols, conversation area)
  backend/           Snoopy — worker.js, counter.js, wrangler.toml, test/
  shared/
    adapter.js       Snoopy — the adapter (Contract v2)
    identity.js      Maya — IDENTITY_CONFIG (neither engineering agent edits it)
  PROJECT_STATUS.md  Maya owns; agents update their own sections via PR
  AGENTS.md          Maya owns — the working rules
  docs/decisions/    Maya — decision records
```

Branches: `main` (stable, protected by the "Protect main" ruleset — Active: PR + 1 approval, no direct pushes, no force pushes, no deletions), `integration` (the integration branch), `snoopy/<feature>`, `echo/<feature>`. One PR per feature into `integration`; the other agent reviews; Maya approves; the owner authorizes `integration` → `main`. The proxy suite (40 tests) and the adapter suites (52 Alpha 0.1 + the Alpha 0.2 suites: 42 unit + 6 integration + 3 Echo regressions = 51) must pass before a PR merges into `integration`.

## Next steps

1. Owner confirms Maya's and Echo's GitHub access (can Maya review/merge? can Echo push branches/open PRs?).
2. Maya issues Echo's consolidated assignment.
3. Snoopy lands the S01 foundation (adapter, contract v2.1, integration test, Echo's regressions, coordination note, PROJECT_STATUS.md, AGENTS.md) via PR into `integration` — once the owner authorizes it. No push, merge or deployment is authorized by this file alone.
4. Echo and Snoopy work in parallel on feature branches; integration via PRs as above.
5. Alpha 0.2 acceptance: the visual embodiment integrated with the adapter, all suites passing, no live calls beyond authorized tests.

## Snoopy's section

- S01 READY FOR INTEGRATION (Nov 25, 2026). Adapter Contract v2.1 written; adapter implementation + synthetic tests complete (51/51 PASS: 42 unit + 6 integration + 3 Echo regressions); PROJECT_STATUS.md and AGENTS.md updated; repo created and initialized with the README; "Protect main" ruleset Active; GitHub permissions verified (connector cannot set rulesets — done in the browser with the owner's in-person verification).
- Blocked on: the owner authorizing the foundation PR into `integration`; Maya issuing Echo's assignment (not a blocker for S01).

## Echo's section

- (Echo updates this section via PR once assigned.)

## Maya's section

- (Maya updates this section.)
