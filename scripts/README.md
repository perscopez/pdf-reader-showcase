# Scripts

Local maintenance, audit and backup helpers. None of them contact a remote server
unless you configure one explicitly through environment variables.

## Accounts

| Script | Purpose |
| --- | --- |
| `create-user.js` | `npm run user:create -- <username> [admin\|user]` creates a verified local account and prints a generated password once. |
| `create-invite.js` | `npm run invite:create -- [count]` adds registration invite codes to the local database. |

## Security and licensing

| Script | Purpose |
| --- | --- |
| `security-audit.js` | `npm run security:audit` statically checks that private API routes call `getCurrentUser`, book/file routes check ownership, and insecure defaults do not come back. |
| `audit-encrypted-derivatives.js` | Verifies that no plaintext derivatives (page text, previews, annotations) are stored for encrypted books. |
| `dependency-audit.js` | `npm run security:deps` runs `npm audit` and lists outdated packages. |
| `license-audit.js` | `npm run license:audit` checks bundled third-party assets against `THIRD_PARTY_NOTICES.md`. |
| `verify-crypto.js` | Smoke test for the E2EE primitives (PBKDF2, AES-GCM key wrapping) using Node WebCrypto. |

## Backups

| Script | Purpose |
| --- | --- |
| `safe-backup.js` | `npm run backup:safe` creates a locked, encrypted archive of `data/` and `public/uploads/`, prunes old archives and optionally uploads to S3. |
| `backup-s3.js` / `verify-backup-s3.js` | Upload to and verify archives in any S3-compatible bucket (`S3_*` env vars). |
| `backup-lib.js` | Shared helpers used by the backup scripts. |
| `backup-package.json` | Minimal dependency manifest installed into the Docker image for the backup scripts. |

## Monitoring and QA

| Script | Purpose |
| --- | --- |
| `monitor-health.js` | `npm run monitor:health` calls `/api/health` (`HEALTHCHECK_URL`) and exits non-zero on failure. |
| `reader-accessibility-check.mjs` | Playwright check of reader keyboard/ARIA behaviour against a running dev server. |
| `reader-selection-check.mjs` | Playwright check of text-selection geometry in the reader. |
| `design-review-shots.mjs` | Captures desktop and mobile screenshots of key pages from a local dev server. |
| `sync-pdf-worker.mjs` | Copies the PDF.js worker matching the installed `pdfjs-dist` into `public/` (runs before `build`). |
