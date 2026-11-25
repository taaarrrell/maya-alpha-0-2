# M.A.Y.A. Alpha 0.2: Identity & Embodiment

M.A.Y.A. (Multimodal Artificial Yielding Agent) — Alpha 0.2: the visual embodiment (nanoswarm + Crimson / Indigo / Silver protocols) integrated with the existing LiveAdapter and backend. No new reasoning or model work.

## Status

- **Alpha 0.1 is PASS.** Gate 3 passed (formal smoke test + chaining probe, Nov 24, 2026). The Alpha 0.1 baseline is FROZEN (Worker `bd0860d3…`, interface `b1c870a7…`, model `gemini-3.5-flash-lite`, cap 20, repo `taaarrrell/maya-alpha-0-1-test`, commit `d6e01381…`). It is not modified by Alpha 0.2 work.
- **Alpha 0.2 is in preparation.** Assignment S01 (Snoopy, backend) prepared the engineering foundation: the refined Adapter Contract v2, the shared adapter implementation (synthetic tests only), and the coordination docs. That foundation lands here by pull request.
- **This repository is public, synthetic-only, and disposable.** No real memories, personal information, or Memory Core data is ever sent or stored here.

## Structure

```
maya-alpha-0-2/
  frontend/          Echo — visual UI (nanoswarm, protocols, conversation area)
  backend/           Snoopy — worker.js, counter.js, wrangler.toml, test/
  shared/
    adapter.js       Snoopy — the adapter (Adapter Contract v2)
    identity.js      Maya — IDENTITY_CONFIG (neither engineering agent edits it)
  PROJECT_STATUS.md  Maya owns; agents update their own sections via PR
  AGENTS.md          Maya owns — the working rules
  docs/decisions/    Maya — decision records
```

## Workflow

Branches: `main` (stable, protected — pull request + Maya approval, no direct pushes), `integration` (the integration branch), `snoopy/<feature>`, `echo/<feature>`. One pull request per feature into `integration`; the other agent reviews; Maya approves; the owner authorizes `integration` → `main`. The proxy suite (40 tests) and the adapter suites (52 Alpha 0.1 + 26 Alpha 0.2) must pass before a pull request merges into `integration`.

Echo's visual prototype stays in its own repository (`maya-alpha-0-2-ui-preview`) and is integrated later. Feature branches in this repo have no live Pages preview (Pages serves one branch); review the code and the built file, and preview only after merging to `integration`.

## Safety

- **No secrets in this repository, ever.** The Gemini API key lives only as the Cloudflare Worker secret, set by the owner in the dashboard.
- No live Memory Core connection. No autonomous actions or unrestricted delegation. No unapproved spending.
- Alpha 0.2 uses isolated storage keys (`maya-alpha-0-2-chain-v0.1`, `maya-alpha-0-2-conversation-v0.1`) and never touches the Alpha 0.1 keys.
- Dream Mode and PHINEAS stay paused. Design and specification pages are not implementation.
- This repository does not authorize anything by itself. Merges, deploys, secret changes and permission changes need the owner's explicit statement.

## Roles

- **Owner (Tarell):** creative direction and final authority.
- **Maya:** chief architecture, coordination, integration and design review.
- **Snoopy (Muse):** backend engineering, reasoning integration, security.
- **Echo (ChatGPT Work):** frontend engineering, visual embodiment, parallel implementation.
