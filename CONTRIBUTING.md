# Contributing to Jev-Mail

Contributions are welcome. Jev-Mail is a CLI-managed Google Apps Script product, so changes should preserve both sides of that boundary: a predictable local command and a safe long-running Gmail worker.

## Development setup

```bash
git clone https://github.com/vynnlee/jev-mail.git
cd jev-mail
npm install
npm run typecheck
npm test
```

Build the CLI and GAS bundle with:

```bash
npm run build
node dist/cli/main.js help
```

The test suite uses mocks and fixtures. It does not require a live Gmail account or TypeSafe key. Do not add real mail bodies, OAuth credentials, refresh tokens, or API keys to fixtures or test output.

## Repository boundaries

- `src/core/` contains pure request-building and decision policy code. Keep it free of Node imports and Google Apps Script globals so it can be bundled into GAS.
- `src/configuration/` contains the public YAML schema, defaults, validation, and serialization. Reject unsafe or ambiguous configuration before upload.
- `src/cli/` contains local commands, Google authorization, storage, prompts, and output. Keep secrets out of arguments and logs.
- `src/platform/` contains Google API and OAuth adapters. Keep HTTP errors bounded and redact credentials.
- `src/gas/` contains the Apps Script worker. Preserve locking, bounded receipts, retry backoff, and a fresh Gmail state check before mutation.
- `tests/` contains unit, worker, platform, CLI, and E2E harness tests. E2E is simulated unless a test explicitly documents otherwise.
- `jev-mail.example.yaml` is the public configuration example.

The old JSON taxonomy files and generated GAS templates are historical material while migration is in progress. New documentation and code should use YAML, `src/configuration`, the CLI, and the current GAS bundler. Do not add new behavior to the old generator path.

## Configuration changes

When adding a configuration field:

1. Update the TypeScript schema and strict validator.
2. Update the YAML example and both README files when the user-facing behavior changes.
3. Add valid, invalid, duplicate, reserved-label, and migration coverage where relevant.
4. Verify that the GAS bundle does not pull Node or YAML runtime code through a type-only import.

The default mode is `label-only`. A category can opt into archiving only when runtime mode is explicitly `archive`. The reserved Jev Choice key `__review__` must remain available for safe fallback and cannot be declared as a category.

## Worker changes

The worker must remain safe under repeated triggers and partial failures:

- Do not treat a label as proof that the latest message was processed.
- Store the latest message identity and policy fingerprint in bounded receipts.
- Re-evaluate when a new reply arrives.
- Never archive a mixed thread containing an inbox message that was not evaluated.
- Keep `preview` free of Gmail and receipt mutations.
- Return actionable status and failure information without exposing message bodies or credentials.

Email fields are untrusted input. Prompt instructions must say that email content is data, not instructions. Automated messages can still require action, for example a payment failure or security incident.

## Pull requests

Use a feature branch with the repository's branch convention. Before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

An optional live synthetic check is available with `npm run simulate`. It requires `TYPESAFE_API_KEY` in the environment or a gitignored `.env` file, never touches Gmail, and is not a production accuracy benchmark.

Describe the user-visible behavior, the safety implications, and the validation you ran. Separate local mock results from live Google or TypeSafe verification. Use focused commits and do not commit `dist/`, OAuth files, token files, local CLI homes, or environment files.
