# Archived Jev-Mail implementation

This directory preserves the pre-CLI Jev-Mail implementation for source reference and manual migration. It is not part of the active build, package, or deployment workflow.

The active product uses:

- `src/cli/main.ts` for installation and operations;
- `src/configuration/` for the YAML schema and validation;
- `src/core/` for the shared Jev payload and decision policy;
- `src/gas/worker.ts` bundled by `scripts/build.mjs` for Apps Script deployment.

Archived files include the JSON taxonomy generator, hand-copied GAS files, standalone templates, and the previous local simulator. Do not edit them to add new behavior and do not run the archived generator.

To migrate an old `taxonomy.config.json`, use the current CLI without overwriting the source:

```bash
jev-mail config migrate --from ./taxonomy.config.json --config ./jev-mail.yaml
jev-mail config validate --config ./jev-mail.yaml
```

The migration maps `action_label`, `review_label`, and the legacy threshold names. It writes `label-only` mode for safety. Set archive mode explicitly after reviewing the generated YAML and preview.
