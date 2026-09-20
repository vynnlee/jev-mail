# Verification record

Date: 2026-09-20

The CLI/GAS refactor is exercised at four distinct levels. A passing mocked test is not a claim of live Google operation.

| Layer | Evidence | Status |
| --- | --- | --- |
| Static checks | `npm run typecheck`, `git diff --check` | Passed |
| Deterministic tests | Core policy/configuration, OAuth PKCE/state/refresh, worker idempotency/replies/retry/capacity | Passed |
| Built artifact E2E | Spawned bundled CLI against mocked Google APIs; actual GAS bundle executed in a VM with fake GAS services | Passed |
| npm package smoke | Packed tarball installed into a separate temporary prefix; binary version and config init/validate executed | Passed |
| Live Google OAuth | Dedicated Desktop client prepared; personal Gmail authorization attempted | Passed; initial `org_internal` resolved with External/Testing and test-user registration |
| Live GAS deployment/trigger | CLI created project, uploaded bundle, created/updated deployment, linked standard Cloud project; editor installed one matching 5-minute trigger | Passed |
| Live Jev inference | Authenticated live synthetic model calls and GAS verifySetup | Passed; expanded fixture evaluation 10/11 exact matches |
| Scheduled Gmail classification | Actual time-driven run at 11:06:56 UTC handled one synthetic inbox message; Gmail Follow Up label and INBOX retention independently checked | Passed |

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

## Live model evaluation

The initial seven legacy fixtures produced 6/7 exact expected decisions. The OTP case was conservatively retained as Review because of conditional security boilerplate. The question was clarified to distinguish routine codes from confirmed security incidents, and four contrasting cases were added. The expanded live evaluation produced 10/11 exact matches: all 11 labels and inbox/archive outcomes matched; one payment-failure email received an extra star. Expected fixture values were not changed to hide this discrepancy. This small development set is not an independent production accuracy estimate.

Live setup also exposed a too-short two-minute OAuth wait and an unhelpful API-disabled error. The CLI now waits 15 minutes for user approval and maps known Google setup errors to fixed, actionable instructions.

## Live scheduled execution and handoff

At 2026-09-20 20:06:56 KST (11:06:56 UTC), the Google time trigger processed one synthetic message with zero failures. Status showed one trigger and one receipt. A separate Gmail API read confirmed that the expected Follow Up label was present and INBOX was retained. The synthetic message was subsequently moved to Trash. No real message was deleted by the test.

The CLI was linked locally and verified from a fresh login shell as `jev-mail 0.2.0`. The verified installation uses the default `~/.config/jev-mail` profile. The worker is paused, with label-only mode, a restored batch size of ten, and one five-minute timer retained. `jev-mail enable` resumes operation and `jev-mail status` queries the real cloud state. Local linking is not an npm publication.

This verifies a scheduled live round trip, not a 24-hour endurance run. Structured evidence is in [live-e2e.json](live-e2e.json) and [live-evaluation.json](live-evaluation.json).
