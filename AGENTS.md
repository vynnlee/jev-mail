# AGENTS.md — Agent Operations & Deployment Manual for `jev-mail`

> **Note for AI Agents**: This document provides explicit instructions for coding agents (Claude Code, Antigravity, Cursor, Codex, OpenCode, etc.) to autonomously inspect, test, and one-shot deploy `jev-mail` to a user's Google Apps Script (GAS) and Gmail environment.

---

## 1. Project Overview

`jev-mail` is a 24/7 autonomous, cloud-native Zero-Inbox triage system for Gmail.
It replaces brittle keyword filters and expensive, slow LLM prompts with **TypeSafe AI's System One model (`Jev`)**.

### Why System One (`Jev`) over Generative LLMs?
1. **Calibrated Probabilities (`noul`)**: Outputs mathematically sound probabilities (0.0 to 1.0) rather than generated text, allowing precise threshold-based decision making.
2. **Sub-250ms Latency**: 5x to 10x faster than traditional LLMs.
3. **Deterministic & Hallucination-Free**: Pure classification and probability scoring.
4. **100x Cost Efficiency**: Fractions of a cent per batch.

### Why Google Apps Script (GAS)?
- **Always-On Cloud Execution**: Runs 24/7 on Google's cloud infrastructure at no cost, even when the user's laptop is powered off.
- **Native Gmail Integration**: Zero external OAuth token refresh issues; runs securely within Google's permission sandbox.
- **Trigger-Driven**: Built-in 5-minute time-driven trigger runs automatically and silently.

---

## 2. MECE 2-Axis Triage Architecture

`jev-mail` organizes emails along two orthogonal axes: **Lifecycle (System Mailboxes)** and **Content (Custom Labels)**.

### Axis 1: Content Classification (Mutually Exclusive, Collectively Exhaustive)
No numeric prefixes, no emojis in label names. Exactly 5 core categories + 1 safety fallback:

| Label | Description | Criteria |
| :--- | :--- | :--- |
| **`Follow Up`** | Human action required | Direct response, decision, code review, manual task, or sign-off requested. |
| **`Pending`** | Waiting on external outcome | Awaiting another person's reply, order/package delivery in transit, support ticket resolution, calendar invites awaiting attendance. |
| **`Receipts`** | Financial / Legal / Accounting | Invoices, purchase receipts, Stripe/bank transaction alerts, SaaS billing, travel/hotel bookings. |
| **`Newsletter`** | Knowledge reading | Industry digests, technical blogs, Substack, product changelogs, marketing promotions. |
| **`Notifications`** | Machine & system telemetry | Automated GitHub/Jira mentions, CI/CD build alerts, security verification codes, password resets, social media pings. |
| **`Review`** | Fallback safety net | Boundary case or low confidence score (< 0.60). Preserved in Inbox for human review. |

### Axis 2: Lifecycle & System Mailboxes

| System Mailbox | Policy & Implementation |
| :--- | :--- |
| **Inbox (`INBOX`)** | **Active Queue Only**. Only emails requiring human action (`Follow Up`) or human review (`Review`) remain in the Inbox. |
| **Starred (`STARRED` ⭐)** | **Today's Focus / Priority Queue**. Marked ONLY when `is_important >= 0.70` (urgent within 24h or critical stakeholder). Replaces Google's heuristic "Important" mailbox. |
| **Archive (`ARCHIVED`)** | **Zero-Inbox Storage**. Non-action emails (`Pending`, `Receipts`, `Newsletter`, `Notifications`) are immediately archived with their label attached. |

---

## 3. Calibrated Thresholds & Scoring

Configured in `src/config.ts` and `gas/Code.gs`:

```typescript
thresholds: {
  // requiresAction: Score >= 0.55 flags email for human action -> 'Follow Up'
  requiresAction: 0.55,
  // isImportant: Score >= 0.70 flags urgent action -> ⭐ Starred
  isImportant: 0.70,
  // minConfidence: Non-action bucket confidence < 0.60 -> 'Review'
  minConfidence: 0.60,
}
```

### Evaluation Logic Pipeline
1. If `requires_action >= 0.55`:
   - Label: `Follow Up`
   - Archive: `false` (stays in Inbox)
   - Star: `true` if `is_important >= 0.70` else `false`
2. If `requires_action < 0.55`:
   - If `bucket.confidence < 0.60`:
     - Label: `Review`
     - Archive: `false` (stays in Inbox for safety)
     - Star: `false`
   - Else:
     - Label: `bucket.choice` (`Pending`, `Receipts`, `Newsletter`, or `Notifications`)
     - Archive: `true` (`thread.moveToArchive()`)
     - Star: `false`

---

## 4. Repository Structure & Key Commands

```text
jev-mail/
├── AGENTS.md               <-- You are here (instructions for AI agents)
├── README.md               <-- User-facing documentation & 1-shot prompt
├── package.json            <-- Scripts & dependencies
├── tsconfig.json           <-- TypeScript configuration
├── gas/
│   ├── Code.gs             <-- Production Google Apps Script
│   └── appsscript.json     <-- GAS manifest & OAuth permissions
├── templates/
│   ├── Code-english.gs     <-- Ready-to-paste English GAS template
│   └── Code-korean.gs      <-- Ready-to-paste Korean GAS template
├── src/
│   ├── types.ts            <-- TypeScript domain models
│   ├── config.ts           <-- Labels, thresholds, and endpoints
│   ├── triage.ts           <-- Jev payload generator & evaluation rules
│   └── cli.ts              <-- Local CLI test harness
└── examples/
    └── mock-emails.json    <-- Realistic mock email test suite
```

### Build & Test Commands
```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript to dist/
npm run build

# 3. Run mock email simulation against TypeSafe Jev API
TYPESAFE_API_KEY="your-api-key-here" npm run simulate
```

---

## 5. One-Shot Deployment Protocol for AI Agents

When a user instructs you to **"Set up jev-mail for my Gmail"**, execute the following autonomous protocol:

### Step 1: Pre-flight Verification
1. Check for `TYPESAFE_API_KEY`:
   - If present in environment (`process.env.TYPESAFE_API_KEY`), proceed.
   - If absent, ask the user to provide their TypeSafe AI API key.
2. Run local simulation test:
   ```bash
   TYPESAFE_API_KEY="<KEY>" npm run simulate
   ```
   Verify that all 6 mock scenarios pass with `✅ PASS`.

### Step 2: Google Apps Script Setup (Two Methods)

#### Method A: Using Google CLASP CLI (Recommended for Terminal-driven agents)
1. Check if `@google/clasp` is available:
   ```bash
   npx @google/clasp -v
   ```
2. If not logged in, initiate login:
   ```bash
   npx @google/clasp login
   ```
   *(Inform the user to click the browser URL to approve Google Cloud access if prompted)*.
3. Create new standalone Apps Script project:
   ```bash
   npx @google/clasp create --title "Jev-Mail-Triage" --type standalone --rootDir ./gas
   ```
4. Push code:
   ```bash
   npx @google/clasp push
   ```
5. Open script editor or instruct user to configure Script Property:
   - Key: `TYPESAFE_API_KEY`
   - Value: `<USER_API_KEY>`

#### Method B: Browser / Web UI Guided Onboarding (For Browser Agents or Manual Fallback)
1. Instruct the user (or drive browser via MCP) to navigate to:
   `https://script.google.com/home` -> **New Project**.
2. Name the project `Jev-Mail-Triage`.
3. Copy the entire content of [`gas/Code.gs`](file:///Users/vsl/Developer/sandbox/jev-mail/gas/Code.gs) into `Code.gs` in the editor.
4. Go to **Project Settings** (gear icon on the left navigation) -> **Script Properties** -> **Add script property**:
   - Property: `TYPESAFE_API_KEY`
   - Value: `<USER_API_KEY>`
   - Click **Save script properties**.
5. Return to the editor, select `installTrigger` from the top function dropdown, and click **Run**.
   - Google will prompt for one-time permissions (`GmailApp` and `UrlFetchApp`).
   - Approve the dialog ("Advanced" -> "Go to Jev-Mail-Triage (unsafe)").
   - Trigger is now installed! It will run `autoTriageInbox` every 5 minutes 24/7.

### Step 3: Gmail Recommended Best-Practice Settings
Inform or assist the user with:
1. **Disable Google's Automated "Important" Mailbox**:
   - Go to Gmail -> Settings (⚙️) -> **See all settings** -> **Inbox**.
   - Under *Importance markers*, select **No markers**.
   - Under *Don't use my past actions to predict importance*, check the box.
   - Save changes.
   *(Why: `jev-mail` uses the Star ⭐ mailbox as your high-priority queue, eliminating Google's noisy heuristic algorithms).*

---

## 6. Maintenance & Troubleshooting for Agents

- **Inspecting Execution Logs**:
  In Google Apps Script, navigate to **Executions** (icon on left menu) to view real-time logs of `autoTriageInbox`.
- **Adjusting Batch Size**:
  `CONFIG.maxBatchSize` defaults to `10` threads per run to respect Google Apps Script execution time limits (6 minutes max). For high-volume inboxes, 10-20 threads per 5-minute trigger is optimal.
- **Handling False Positives**:
  If an email was categorized into `Notifications` instead of `Receipts`, review `CONFIG.thresholds` or refine the `bucket.criteria` prompts in `callJevTriage`.
