# Contributing to Jev-Mail

Contributions to Jev-Mail are welcome.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/vynnlee/jev-mail.git
   cd jev-mail
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your TypeSafe API Key:
   ```bash
   export TYPESAFE_API_KEY="your-api-key"
   ```

4. Run the test simulator:
   ```bash
   npm run simulate
   ```

## Guidelines

- Zero-Inbox Integrity: Emails not requiring direct human action must be archived (`moveToArchive()`).
- Taxonomy: Maintain the 5 mutually exclusive labels (`Follow Up`, `Pending`, `Receipts`, `Newsletter`, `Notifications`) and `Review` fallback. Do not add emojis or numeric prefixes to labels.
- Synchronizing Templates: Updates to `src/triage.ts` or `src/config.ts` must be mirrored in `gas/Code.gs`, `templates/Code-english.gs`, and `templates/Code-korean.gs`.
- Style: Do not use emojis, em-dashes, en-dashes, or middle-dots in documentation or codebase.

## Pull Requests

1. Create a feature branch: `git checkout -b feat/my-improvement`.
2. Verify all tests pass: `npm run simulate`.
3. Submit a pull request with clear conventional commit messages.
