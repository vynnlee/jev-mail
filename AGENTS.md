# AGENTS.md: Agent Operations and Deployment Manual for Jev-Mail

This document provides explicit instructions for coding agents (Claude Code, Antigravity, Cursor, Codex, Gemini CLI) to inspect, test, and deploy Jev-Mail to a user's Google Apps Script (GAS) and Gmail environment in one shot.

---

## 1. Project Overview

Jev-Mail is a 24/7 autonomous Zero-Inbox triage system for Gmail.
It replaces keyword filters and generative LLM prompts with TypeSafe AI System One model (Jev).

### System One (Jev) Primitives
1. Calibrated Probabilities (Noul): Returns mathematical probability (0.0 to 1.0) rather than text, enabling threshold-based decisions.
2. Low Latency: Sub-250ms decisions.
3. Deterministic: Pure classification and probability scoring without hallucination.

### Google Apps Script (GAS) Architecture
- Always-On Cloud Execution: Runs 24/7 on Google infrastructure at zero cost, even when the user's laptop is powered off.
- Native Gmail Integration: Uses GmailApp within Google permission sandbox with no token expiration.
- Trigger-Driven: 5-minute time-driven trigger runs automatically in the background.

---

## 2. Taxonomy and Decision Engine

Jev-Mail separates email processing into two orthogonal axes: Content (Custom Labels) and Lifecycle (System Mailboxes).

### Content Taxonomy (Mutually Exclusive, Collectively Exhaustive)
No numeric prefixes, no emojis. Exactly 5 core categories and 1 safety fallback:

| Label | Description | Criteria |
| :--- | :--- | :--- |
| `Follow Up` | Direct human action required | Reply, decision, sign-off, or manual task needed |
| `Pending` | Waiting on external outcome | Waiting on response, package in transit, ticket update |
| `Receipts` | Financial and legal notices | Invoices, Stripe/bank alerts, SaaS subscriptions |
| `Newsletter` | Reading material | Technical digests, blogs, product updates, marketing |
| `Notifications` | Machine and telemetry alerts | GitHub/Jira pings, CI/CD builds, verification codes, OTPs, password resets |
| `Review` | Low-confidence safety boundary | Confidence score below 0.60, retained in Inbox |

### Lifecycle Mailboxes

| System Mailbox | Policy |
| :--- | :--- |
| Inbox (`INBOX`) | Active queue only. Only emails requiring action (`Follow Up`) or human inspection (`Review`) remain in the Inbox. |
| Starred (`STARRED`) | Priority focus queue. Starred only when `is_important >= 0.70` (urgent within 24h). Replaces Google's heuristic Important marker. |
| Archive (`ARCHIVED`) | Non-action emails (`Pending`, `Receipts`, `Newsletter`, `Notifications`) are archived immediately after labeling. |

---

## 3. Calibrated Thresholds and Logic

Configured in `src/config.ts` and `gas/Code.gs`:

```typescript
thresholds: {
  requiresAction: 0.55,
  isImportant: 0.70,
  minConfidence: 0.60,
}
```

### Decision Pipeline
1. If `requires_action >= 0.55`:
   - Label: `Follow Up`
   - Archive: `false` (retained in Inbox)
   - Star: `true` if `is_important >= 0.70`, otherwise `false`
2. If `requires_action < 0.55`:
   - If `bucket.confidence < 0.60`:
     - Label: `Review`
     - Archive: `false` (retained in Inbox for safety)
     - Star: `false`
   - Else:
     - Label: `bucket.choice` (`Pending`, `Receipts`, `Newsletter`, `Notifications`)
     - Archive: `true` (thread.moveToArchive())
     - Star: `false`

---

## 4. Repository Structure and Commands

```text
jev-mail/
├── README.md               # English user documentation
├── README.ko.md            # Korean user documentation
├── AGENTS.md               # Agent deployment manual
├── CONTRIBUTING.md         # Contribution guidelines
├── LICENSE                 # MIT License
├── package.json            # Scripts and dependencies
├── tsconfig.json           # TypeScript configuration
├── gas/
│   ├── Code.gs             # Production Google Apps Script
│   └── appsscript.json     # GAS manifest and OAuth scopes
├── templates/
│   ├── Code-english.gs     # English GAS template
│   └── Code-korean.gs      # Korean GAS template
├── src/
│   ├── types.ts            # TypeScript interfaces
│   ├── config.ts           # Taxonomy and thresholds
│   ├── triage.ts           # Jev payload builder and rules
│   └── cli.ts              # Local CLI test harness
└── examples/
    └── mock-emails.json    # Test suite
```

### Commands
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run simulation test against TypeSafe API
TYPESAFE_API_KEY="your-api-key" npm run simulate
```

---

## 5. One-Shot Deployment Protocol for Agents

When a user instructs you to set up Jev-Mail, follow these steps:

### Step 1: Pre-flight Verification
1. Check for `TYPESAFE_API_KEY` in the environment (`process.env.TYPESAFE_API_KEY`). If absent, prompt the user for their key.
2. Run the simulation test:
   ```bash
   TYPESAFE_API_KEY="<KEY>" npm run simulate
   ```
   Confirm all 6 test scenarios pass.

### Step 2: Google Apps Script Setup

#### Option A: CLASP CLI
1. Check if `@google/clasp` is available: `npx @google/clasp -v`
2. Run login: `npx @google/clasp login`
3. Create project: `npx @google/clasp create --title "Jev-Mail-Triage" --type standalone --rootDir ./gas`
4. Push code: `npx @google/clasp push`
5. Configure Script Property `TYPESAFE_API_KEY`.

#### Option B: Browser or Manual Guidance
1. Direct user to `https://script.google.com/home` and create a project named `Jev-Mail-Triage`.
2. Copy `gas/Code.gs` into the editor.
3. In Project Settings, add Script Property `TYPESAFE_API_KEY`.
4. Select `installTrigger` from the function dropdown and click Run to authorize and start the 5-minute trigger.

### Step 3: Configure Gmail Settings
1. Open Gmail Settings -> **See all settings** -> **Inbox**.
2. Under **Importance markers**, select **No markers**.
3. Under **Don't use my past actions to predict importance**, check the box.
4. Save changes.

### Step 4: Optional Backlog Clean-Up
If the user has existing unorganized emails in their `INBOX`:
1. In Apps Script editor, run function `triageHistoricalInbox`.
2. All existing inbox emails will be categorized and archived without adding Star or Follow Up labels.
