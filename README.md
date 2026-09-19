# Jev-Mail

> Autonomous 24/7 Zero-Inbox triage for Gmail powered by TypeSafe Jev System One.

[English](README.md) | [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Engine: TypeSafe Jev](https://img.shields.io/badge/Engine-TypeSafe%20Jev-orange.svg)](https://typesafe.ai)
[![Runtime: Google Apps Script](https://img.shields.io/badge/Runtime-Google%20Apps%20Script-green.svg)](https://script.google.com)
[![Cost: 0 USD](https://img.shields.io/badge/Cloud%20Cost-0%20USD-brightgreen.svg)]()
[![Type: TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org)

Jev-Mail is an always-on email triage system for Gmail. Running serverless inside Google Apps Script (GAS), it processes incoming emails every 5 minutes on Google Cloud infrastructure even when your computer is off.

Instead of slow, generative LLM text prompts or brittle regex filters, Jev-Mail uses TypeSafe AI System One model (`Jev`). A single inference call evaluates parallel typed questions: action necessity (`Noul`), urgency (`Noul`), and taxonomy category (`Choice`) with calibrated probabilities in under 250 ms.

---

## Decision Pipeline

Jev-Mail evaluates incoming emails across two orthogonal axes: Lifecycle (System Mailboxes) and Content (Custom Labels).

```
                  Incoming Email
                        │
                        ▼
             TypeSafe Jev Inference
            (Parallel Speculative Fan-out)
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
requires_action >= 0.55        requires_action < 0.55
(Direct Action Required)       (Information / Non-Action)
        │                               │
        ▼                               ▼
  Label: Follow Up             Confidence >= 0.60?
  Retain in INBOX                      │
        │                       ┌──────┴──────┐
        ▼                       ▼             ▼
is_important >= 0.70?          YES            NO
  YES: Star ON                  │             │
  NO:  Star OFF                 ▼             ▼
                        Choice Routing   Label: Review
                        - Receipts       Retain in INBOX
                        - Newsletter
                        - Notifications
                        - Pending
                                │
                                ▼
                         Archive Immediately
                         (Zero-Inbox)
```

### Taxonomy Matrix

| Label | Description | Criteria | Star Policy | Inbox Lifecycle |
| :--- | :--- | :--- | :---: | :---: |
| `Follow Up` | Direct human action required | Reply, decision, sign-off, or manual task needed | Starred if urgent (<24h) | Retained in INBOX |
| `Pending` | Awaiting external outcome | Waiting on response, package in transit, ticket update | None | Archived |
| `Receipts` | Financial and legal notices | Invoices, Stripe/bank alerts, SaaS subscriptions | None | Archived |
| `Newsletter` | Reading material | Technical digests, blogs, product updates, marketing | None | Archived |
| `Notifications` | Machine and telemetry alerts | GitHub/Jira pings, CI/CD builds, security codes | None | Archived |
| `Review` | Low-confidence safety boundary | Confidence score below 0.60 | None | Retained in INBOX |

---

## 1-Shot Agent Deployment

If you use an AI coding agent (Claude Code, Antigravity, Cursor, Codex, Gemini CLI), copy and paste this instruction block:

```markdown
Read AGENTS.md in https://github.com/vynnlee/jev-mail and set up Jev-Mail on my Gmail account.
My TypeSafe API Key is: <YOUR_TYPESAFE_API_KEY>

Follow the deployment steps in AGENTS.md:
1. Verify the local build and run `npm run simulate`.
2. Push the Google Apps Script code to my account.
3. Set TYPESAFE_API_KEY in Script Properties.
4. Run installTrigger to start 24/7 cloud execution.
5. Guide me through Gmail settings for Zero-Inbox.
```

The agent will parse [AGENTS.md](AGENTS.md) and handle setup automatically.

---

## Manual Setup

Setup takes under 3 minutes with zero local tooling required:

### Step 1: Obtain a TypeSafe API Key
Sign up at [TypeSafe AI](https://typesafe.ai) and generate an API key.

### Step 2: Create Google Apps Script Project
1. Open [script.google.com/home](https://script.google.com/home) and click **New project**.
2. Name the project `Jev-Mail-Triage`.
3. Replace the contents of `Code.gs` with [gas/Code.gs](gas/Code.gs) (or [templates/Code-korean.gs](templates/Code-korean.gs) for Korean folder names).
4. Save the project (`Cmd+S` or `Ctrl+S`).

### Step 3: Configure Script Properties
1. In the left sidebar, click **Project Settings** (gear icon).
2. Scroll to **Script Properties** and click **Add script property**.
3. Add:
   - Property: `TYPESAFE_API_KEY`
   - Value: `<your-api-key>`
4. Click **Save script properties**.

### Step 4: Install 24/7 Automation Trigger
1. Return to the **Editor** (`< >` icon).
2. Select `installTrigger` from the function dropdown on the top toolbar.
3. Click **Run**.
4. Complete Google's one-time permission approval.
5. A confirmation message `[OK] 24/7 trigger installed successfully` appears in the execution log. Google Cloud will now run the triage function every 5 minutes.

### Step 5: (Optional) Initial Backlog Triage
To categorize and clear existing emails currently sitting in your `INBOX`:
1. Select `triageHistoricalInbox` from the function dropdown.
2. Click **Run**.
3. All existing inbox emails are categorized into `Receipts`, `Newsletter`, `Notifications`, or `Pending` and archived immediately. Star and Follow Up labels are never applied to historical emails.

---

## Recommended Gmail Configuration

Google's default "Important" marker relies on heuristic algorithms that frequently misclassify newsletters or automated alerts.

1. Open Gmail Settings (gear icon) -> **See all settings** -> **Inbox**.
2. Under **Importance markers**, select **No markers**.
3. Under **Don't use my past actions to predict importance**, check the box.
4. Save changes.

Jev-Mail uses the Starred mailbox exclusively for emails where `is_important >= 0.70`, turning Starred into your daily priority queue.

---

## Local Verification

You can simulate decisions locally against mock email scenarios before deploying:

```bash
git clone https://github.com/vynnlee/jev-mail.git
cd jev-mail
npm install
npm run build
TYPESAFE_API_KEY="your-api-key" npm run simulate
```

### Sample Output

```text
=============================================================
Jev-Mail: System One Zero-Inbox Simulator
=============================================================

Loaded 6 mock email scenarios.
Evaluating with Jev (jev-latest)...

┌─────────┬───────────┬───────────────────────────────────────┬─────────────────┬──────────┬──────────┬─────────┬───────────┐
│ (index) │ id        │ subject                               │ label           │ star     │ archive  │ latency │ status    │
├─────────┼───────────┼───────────────────────────────────────┼─────────────────┼──────────┼──────────┼─────────┼───────────┤
│ 0       │ 'mock_01' │ '[Urgent] Q3 Roadmap approval nee...' │ 'Follow Up'     │ 'YES'    │ 'NO'     │ '659ms' │ 'PASS'    │
│ 1       │ 'mock_02' │ 'Question regarding webhook integ...' │ 'Follow Up'     │ 'NO'     │ 'NO'     │ '639ms' │ 'PASS'    │
│ 2       │ 'mock_03' │ 'Your package #KR-98214 has shipp...' │ 'Pending'       │ 'NO'     │ 'YES'    │ '292ms' │ 'PASS'    │
│ 3       │ 'mock_04' │ 'Your receipt for Cloud Invoice #...' │ 'Receipts'      │ 'NO'     │ 'YES'    │ '225ms' │ 'PASS'    │
│ 4       │ 'mock_05' │ 'Issue #142: How System One model...' │ 'Newsletter'    │ 'NO'     │ 'YES'    │ '287ms' │ 'PASS'    │
│ 5       │ 'mock_06' │ '[GitHub] Pull request #84 merged...' │ 'Notifications' │ 'NO'     │ 'YES'    │ '219ms' │ 'PASS'    │
└─────────┴───────────┴───────────────────────────────────────┴─────────────────┴──────────┴──────────┴─────────┴───────────┘

Simulation complete. All decisions verified against taxonomy.
```

---

## Repository Structure

```text
jev-mail/
├── README.md               # English documentation
├── README.ko.md            # Korean documentation
├── AGENTS.md               # Agent deployment instructions
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
├── package.json            # Scripts and configuration
├── tsconfig.json           # TypeScript configuration
├── gas/
│   ├── Code.gs             # Google Apps Script production code
│   └── appsscript.json     # Apps Script manifest and scopes
├── templates/
│   ├── Code-english.gs     # Standalone English template
│   └── Code-korean.gs      # Standalone Korean template
├── src/
│   ├── types.ts            # TypeScript interfaces
│   ├── config.ts           # Taxonomy and threshold constants
│   ├── triage.ts           # Jev payload builder and decision logic
│   └── cli.ts              # Local simulation harness
└── examples/
    └── mock-emails.json    # Test suite covering taxonomy edge cases
```

---

## Security and Privacy

- Zero persistent email storage: No emails or metadata are stored in external databases.
- Execution occurs strictly inside your private Google Apps Script container.
- API keys are stored in encrypted Google Script Properties.
- Inference payload transmits only sender, subject, and a truncated snippet (up to 1,000 characters) over TLS directly to TypeSafe AI.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
Author: [Vynn Lee](https://github.com/vynnlee).
