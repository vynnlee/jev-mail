# Verification record

Date: 2026-09-20

The CLI/GAS refactor is exercised at four distinct levels. A passing mocked test is not a claim of live Google operation.

| Layer | Evidence | Status |
| --- | --- | --- |
| Static checks | `npm run typecheck`, `git diff --check` | Passed |
| Deterministic tests | Core policy/configuration, OAuth PKCE/state/refresh, worker idempotency/replies/retry/capacity | Passed |
| Built artifact E2E | Spawned bundled CLI against mocked Google APIs; actual GAS bundle executed in a VM with fake GAS services | Passed |
| npm package smoke | Packed tarball installed into a separate temporary prefix; binary version and config init/validate executed | Passed |
| Live Google OAuth | Dedicated Desktop client prepared; personal Gmail authorization attempted | Blocked by `403 org_internal`: Cloud project's OAuth audience is Internal |
| Live GAS deployment/trigger | Requires completed Google authorization and project link | Pending |
| Live Jev inference | Requires a TypeSafe key via masked prompt, environment, or gitignored `.env` | Pending |
| Scheduled Gmail classification | Requires the previous live gates, then observe a timer run and verify labels | Pending |

## Important regression coverage

- Configured taxonomy validation rejects collisions and invalid thresholds.
- Action ambiguity, missing confidence, unknown bucket, and explicit Review never archive.
- New replies receive a fresh decision; previously processed retained messages do not starve the scan cursor.
- Interrupted Gmail changes reuse a cached decision, and delayed replies invalidate stale archive plans.
- Preview does not mutate Gmail or Script Properties.
- Repeated installation does not create duplicate timers or API deployments.
- Resume after a lost deployment checkpoint discovers the managed deployment.
- `init` refuses to silently publish changed configuration; `config apply` is explicit.
- API key replacement validates a synthetic request before saving; a bad key cannot replace a working key.
- Timer interval mismatch is visible and prevents processing until corrected.
- OAuth state/PKCE, wrong-account rejection, credential redaction, and structured CLI usage errors are tested.
- Full retained receipt storage stops new classification instead of evicting completed inbox history.

## Live test procedure

1. Resolve the Google OAuth audience/account mismatch without unintentionally changing other apps' access policy.
2. Run `init`, complete browser OAuth, link GAS to the same Cloud project number, and run `installTrigger` in the editor.
3. Rerun `init` with a securely provided TypeSafe key; require a successful synthetic inference and exactly one matching timer.
4. Run `preview --limit 1`; inspect the proposed label without mutating Gmail.
5. Enable in label-only mode, observe one actual timer execution, verify Gmail labels and `status`, then disable after the test unless continued operation is requested.
6. Record the observed results without copying mail bodies, secrets, or account tokens into repository artifacts.
