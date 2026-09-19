# Contributing to Jev-Mail

Thank you for your interest in improving `jev-mail`! We welcome community contributions, bug reports, and enhancements to our System One email triage pipeline.

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vynnlee/jev-mail.git
   cd jev-mail
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up your TypeSafe API Key**:
   Obtain an API key from [TypeSafe AI](https://typesafe.ai).
   ```bash
   export TYPESAFE_API_KEY="your-api-key-here"
   ```

4. **Run the local simulator**:
   ```bash
   npm run simulate
   ```

## Contribution Guidelines

- **Zero-Inbox Integrity**: Any changes to classification logic or thresholds must preserve the core premise: emails that do not require human action must be archived (`moveToArchive()`), keeping `INBOX` purely for active items.
- **MECE Taxonomy**: We adhere to the 5 core mutually exclusive labels: `Follow Up`, `Pending`, `Receipts`, `Newsletter`, `Notifications`, plus `Review` as the safety boundary. Do not add frivolous labels or emojis.
- **Syncing Google Apps Script**: If you modify `src/triage.ts` or `src/config.ts`, make sure to reflect corresponding logic updates in `gas/Code.gs`, `templates/Code-english.gs`, and `templates/Code-korean.gs`.
- **Formatting**: Keep code clean, TypeScript types strict, and comments well-structured.

## Submitting Pull Requests

1. Fork the repo and create your feature branch: `git checkout -b feat/my-improvement`.
2. Ensure simulation tests pass: `npm run simulate`.
3. Commit with clear commit messages following conventional commits (`feat:`, `fix:`, `docs:`).
4. Push to your branch and open a Pull Request.
