# Jev-Mail onboarding checklist

This checklist covers the real first-install path for the CLI-managed, GAS-based Gmail classifier. It intentionally separates local preparation, Google authorization, Apps Script linking, trigger installation, and remote verification. A local command finishing successfully is not proof that the worker is running.

An agent can follow the [packaged setup skill](../skills/jev-mail-setup/SKILL.md). Use a Google Cloud project and Desktop OAuth client owned by the person whose Gmail will be classified. The user completes browser sign-in and consent, the Apps Script editor approval, and masked TypeSafe key entry. An agent may help configure the user-owned Cloud project through an authorized session, prepare YAML, run the CLI, inspect diagnostics, and resume the same installation without handling credential contents.

## Before starting

- [ ] Node.js 22 or newer is installed.
- [ ] The TypeSafe API key is available without putting it in chat, source, shell history, or a command-line argument.
- [ ] The Google account that owns the Gmail inbox is known.
- [ ] A standard Google Cloud project is available.
- [ ] The numeric project number is recorded.

## Google Cloud preparation

In the same Google Cloud project that will own the Desktop OAuth client:

- [ ] Enable **Apps Script API**.
- [ ] Enable **Gmail API**.
- [ ] Configure the OAuth consent screen.
- [ ] Add the operating Google account as a test user when the consent screen is in testing mode.
- [ ] Create a **Desktop app** OAuth client.
- [ ] Download the OAuth client JSON to a protected local path.
- [ ] Enable Apps Script API in [Apps Script user settings](https://script.google.com/home/usersettings).

The project number must be the numeric number from this same Cloud project. A project ID or a number from a different project will cause the linking or execution step to fail.

If the OAuth consent screen is **Internal**, a personal Gmail account is rejected with an organization-only authorization error. Use a Workspace account in that organization, or change the audience to **External** testing and add the personal account as a test user. The audience setting applies across the Cloud project and can affect other OAuth clients, so use a dedicated Jev-Mail project when that matters. See Google's [OAuth audience guidance](https://support.google.com/cloud/answer/15549945?hl=en).

If the error code is `org_internal`, first check the signed-in account and the chosen project's audience. Do not alter the audience of a shared project or borrow its OAuth client to bypass this error. Google states that External/Testing authorizations requesting Gmail scopes, including offline refresh tokens, expire after seven days. The existing installation can be reauthorized with `init --reauthorize`; long-term authorization may require a different publishing and verification path.

## First CLI run

From the repository:

```bash
npm install
npm run build
node dist/cli/main.js init \
  --credentials /absolute/path/to/client.json \
  --project-number 123456789012
```

The CLI will:

1. Open the Google OAuth flow and save a refresh token under the local CLI home.
2. Confirm the Gmail account.
3. Create a GAS project under that account.
4. Upload the versioned worker, manifest, and validated YAML policy.
5. Create or update the execution deployment.
6. Pause with a setup guide if the GAS project is not yet linked to the Cloud project or its trigger has not been installed.

The default local home is `~/.config/jev-mail`. Use `--home DIR` to keep separate accounts or installations apart. The CLI writes local files with restrictive permissions, but the operating system account still controls access to them.

When an agent runs the CLI, keep the interactive process open while the user completes browser consent. Do not send the OAuth JSON, token, TypeSafe key, or browser callback URL through chat. An agent only needs the protected JSON *path* and numeric project number for the command.

## Link the Apps Script project

When `init` prints the project settings and editor URLs:

1. Open the project settings URL.
2. Find **Google Cloud Platform project**.
3. Choose **Change project**.
4. Enter the exact numeric project number used above.
5. Save and return to the editor URL.

This links the newly created Apps Script project to the same Cloud project that owns the OAuth client. It does not mean that a trigger exists yet.

## Install the trigger once

In the Apps Script editor:

1. Select `installTrigger` from the function menu.
2. Click Run.
3. Approve the requested Gmail, external request, and script permissions.

The installable time trigger is created paused. The CLI cannot create this trigger through the Apps Script API. Do not continue by assuming the scheduled worker is active.

## Resume `init`

Run the exact same command again:

```bash
node dist/cli/main.js init \
  --credentials /absolute/path/to/client.json \
  --project-number 123456789012
```

The CLI now checks the deployed function. If the TypeSafe key is not configured, it asks for the key through a masked prompt. In a controlled automation shell, the equivalent is to set `TYPESAFE_API_KEY` before the command. Never use `--key` for the API key and never print it.

If the Google refresh token has expired or been revoked, rerun the same command with `--reauthorize` to start the browser authorization flow again. Keep the same `--home` directory and OAuth client unless you intentionally want a separate installation.

If a key must be replaced, use `init --replace-key` with the new key in the masked prompt or `TYPESAFE_API_KEY`. The worker performs a synthetic TypeSafe connection check before saving the replacement; an invalid replacement leaves the previously stored key untouched.

After configuration, `init` reports the account, script ID, deployment, and remote verification result. A successful upload without this verification is an incomplete installation.

## Resume with structured diagnostics

Run `doctor --json` with the same `--home` and `--config` options used for `init`:

```bash
node dist/cli/main.js doctor --json --home /absolute/path/to/installation --config /absolute/path/to/config.yaml
```

The versioned report has `schemaVersion: 1`, `ok`, `checks[]` with `pass`, `blocked`, or `unknown` status, and `nextActions[]` assigned to `user` or `agent`. Each action may include a URL or a command as an argument array. Preserve argument boundaries when running it. Carry out agent actions and give the user the exact link and one next step for user actions, then rerun doctor. An `unknown` check is not evidence of success. Do not make a second GAS project merely because setup paused. If no custom home or config was used, omit those flags consistently.

Default `doctor` inspects local and remote state without changing remote state or calling TypeSafe. Refreshing Google OAuth may update the local token file. `doctor --verify-model` requests an explicit synthetic model check and may incur usage. It distinguishes a configured key from a working model connection. A locally valid YAML file or uploaded script cannot establish the Google account, installed trigger, or live TypeSafe result. Use `status` to confirm the active remote worker after `enable`.

## Preview and activate

```bash
node dist/cli/main.js preview --limit 10
node dist/cli/main.js status
node dist/cli/main.js enable
node dist/cli/main.js status
```

Review the preview in particular for:

- action mail receiving the action label and remaining in the inbox;
- urgent action mail receiving a star;
- uncertain mail receiving Review;
- category labels matching the configured descriptions;
- label-only mode leaving all messages in the inbox.

`preview` sends classification requests to Jev and can consume API usage, but it does not apply Gmail labels, stars, archives, or processing receipts.

Only run `enable` after the preview is acceptable. `status` should show the expected Google account, one owned trigger, a configured API key, and `enabled: true` after activation.

`status` also reports receipt count, receipt limit, and whether receipt capacity has been reached. Completed receipts for retained inbox threads are kept to prevent duplicate classification. If capacity is reached, the worker fails closed for new receipts. Review or archive retained threads deliberately before expecting new threads to be processed.

## Customize labels and categories

Create or copy a YAML file and validate it before applying it:

```bash
cp jev-mail.example.yaml jev-mail.yaml
node dist/cli/main.js config validate --config ./jev-mail.yaml
```

Edit these fields:

- `labels.action` and `labels.review` for the two safety labels;
- `thresholds` for the action, importance, and category confidence boundaries;
- `categories[]` for custom category keys, Gmail labels, descriptions, examples, and archive policy;
- `runtime.mode` as `label-only` or `archive`.

Then apply the policy to the existing deployment:

```bash
node dist/cli/main.js config apply --config ./jev-mail.yaml
node dist/cli/main.js preview --config ./jev-mail.yaml --limit 10
```

Use `label-only` while tuning. `archive` permits archiving only for categories with `archive: true`; action and Review decisions remain in the inbox. The validator rejects Gmail system labels, duplicates, unknown properties, unsafe strings, invalid thresholds, and the reserved `__review__` category key.

Changing configuration changes the worker policy fingerprint. It does not automatically reclassify every completed message. A new reply or a previously unprocessed message uses the new policy.

The current CLI does not consume the older `taxonomy.config.json` generator format directly. Convert it without overwriting the source:

```bash
node dist/cli/main.js config migrate \
  --from ./taxonomy.config.json \
  --config ./jev-mail.yaml
node dist/cli/main.js config validate --config ./jev-mail.yaml
```

Migration writes a safe `label-only` runtime mode. Review the generated YAML and use `config set-mode --mode archive` only when the old archive behavior is intentionally desired. Keep the old JSON as a backup until the new preview has been reviewed.

## Pause, inspect, and update

Pause processing without deleting the trigger:

```bash
node dist/cli/main.js disable
node dist/cli/main.js status
```

Inspect setup and recent run metadata:

```bash
node dist/cli/main.js doctor
node dist/cli/main.js status
```

Publish a new local worker build to the existing deployment:

```bash
npm run build
node dist/cli/main.js update
```

Run `preview` again after a worker or policy update. Existing Gmail labels are not automatically removed merely because a new policy was uploaded; only the worker's next decisions manage its owned labels.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| OAuth cannot complete | Confirm Desktop OAuth JSON, consent test user, and the account being used in the browser. If the project is Internal, use an organization account or switch to External testing and add the account as a test user. If the refresh token was revoked, rerun `init --reauthorize`. |
| `init` says setup needs approval | Link the GAS project to the exact numeric Cloud project number, install `installTrigger` in the editor, then rerun `init`. |
| `enable` says trigger is missing | Run `installTrigger` once in the Apps Script editor and check `status`. |
| API key is missing | Rerun interactive `init` or set `TYPESAFE_API_KEY` in the controlled shell. Do not pass it as an argument. |
| Configuration is rejected | Run `config validate`; fix the reported YAML path, duplicate, reserved label, or threshold. |
| Preview has no results | Confirm the Gmail account, inbox contents, API key, and remote status. A preview does not process archived mail. |
| Worker is enabled but no change occurs | Check `status` for the last run, inspect GAS executions, and remember that Review and label-only mode intentionally leave mail in the inbox. |

Do not create a second GAS project as a first response to an incomplete setup. Preserve the local home and installation state, fix the reported Google link or trigger step, and rerun `init`.
