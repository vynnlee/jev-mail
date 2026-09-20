---
name: jev-mail-setup
description: Prepare, diagnose, and resume a user's own Google Cloud and Apps Script installation of Jev-Mail.
---

# Jev-Mail setup

Use this skill when an agent is asked to install or repair Jev-Mail. Read the repository `AGENTS.md` and `docs/onboarding.md` first. Keep the user's existing installation and explicit `--home` / `--config` paths across retries. Never use an agent-owned or shared OAuth client for the user's mailbox.

## Boundaries

- The agent may build the CLI, prepare and validate YAML, run `init`, `doctor`, `status`, and `preview`, and interpret their output. Preserve the user's taxonomy and start with `runtime.mode: label-only`.
- The user signs into Google, grants OAuth consent, approves the Apps Script editor run of `installTrigger`, and enters the TypeSafe key in the masked terminal prompt or a controlled environment. The agent may configure a dedicated user-owned standard Cloud project and Desktop OAuth client through an authorized session, and guide the user with exact links. A user may also perform those console steps directly.
- Never request or print OAuth JSON contents, refresh tokens, a TypeSafe key, authorization URLs containing secrets, or personal mail content. The OAuth JSON and CLI home stay outside git. Pass only the *path* to `--credentials`; never a key as an argument or in chat.
- Google Cloud audience changes affect every OAuth client in that project. For `org_internal`, confirm which account and audience are intended. Use an account in that organization or a user-owned dedicated External project; do not alter a shared project's audience to make the error disappear.

## Prepare and run

1. Read `git status`, inspect which installation files exist without printing credentials or tokens, and read the chosen YAML before editing. Build with `npm install` and `npm run build` if needed. `node dist/cli/main.js help` is the source for flags.
2. Explain the browser handoff: [Cloud console](https://console.cloud.google.com/apis/credentials) for the user's project and Desktop client; enable Apps Script API and Gmail API; configure consent/test user; enable [Apps Script API in user settings](https://script.google.com/home/usersettings). Record only the numeric project number and local JSON path. The client and project number must belong to the same Cloud project.
3. Run `node dist/cli/main.js config validate --config PATH` before upload. Use `node dist/cli/main.js init --credentials PATH --project-number NUMBER` with the same `--home DIR` and `--config FILE` options on every resume. Let the user complete OAuth in their browser. Keep the CLI callback alive while they do so.
4. If `init` pauses, use the *existing* script ID and links it prints. The user links that Apps Script project to the same numeric Cloud project, runs `installTrigger` once in the editor, and grants its scopes. Upload success is only code delivery; it does not prove a trigger exists. Rerun the same `init` command after the editor step. Enter the TypeSafe key only through the masked prompt or controlled `TYPESAFE_API_KEY` environment.
5. Run `node dist/cli/main.js doctor --json` with the same path options. Interpret `schemaVersion: 1`, `ok`, `checks[]` (`pass`, `blocked`, `unknown`), and `nextActions[]` (`actor: user` or `agent`; optional `url` or `command` argument array). Treat an unknown result as unverified. Carry out agent actions; present user actions and exact links, then rerun doctor. Preserve argument boundaries when running suggested commands. Do not hard-code a particular check order or claim a trigger from local state.
6. Once remote setup is verified, run `preview --limit 10` and let the user inspect representative decisions. Preview sends mail snippets to Jev and may use paid quota, but does not mutate Gmail. If activation is already authorized, assess the preview and enable within that scope; otherwise present the concrete preview before requesting activation. Confirm with remote `status`.

## Diagnosis and reporting

The default `doctor` checks setup without remote changes or a model request; refreshing Google OAuth may update the local token file. Use `doctor --verify-model` only when a synthetic, potentially billable model call is needed to distinguish a configured key from a working TypeSafe connection. Do not equate a configured key with live model success. `--json` disables interactive prompts; run interactive `init` separately when OAuth or masked key input is needed. On a revoked/expired OAuth token, resume the same home with `init --reauthorize`; do not create another GAS project. Google External/Testing authorizations requesting Gmail scopes may expire after seven days, including refresh tokens; see [Google's OAuth audience guidance](https://support.google.com/cloud/answer/15549945?hl=en). Explain that limitation and reauthorization path without promising unattended operation beyond the authorization lifetime.

Report local build/tests, Cloud authorization, remote trigger, TypeSafe verification, preview, and enabled status as separate facts. Mock E2E tests never establish live Gmail or TypeSafe access. If blocked, state the exact user action, URL, and command that resumes the existing installation. Never report success solely from an uploaded script or a local file.

If project creation is interrupted before `installation.json` is saved, do not blindly repeat `init`: Google may have created an orphan script. Inspect Apps Script for that creation and reconcile the installation before retrying. Resume guarantees apply after the script ID has been saved.
