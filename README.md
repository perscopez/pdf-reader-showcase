# PDF Reader Showcase

A self-hosted PDF/EPUB reader and personal library. Upload books, read them in a
focused reader with highlights, notes and bookmarks, search across the text of
every book you own, and keep it all on your own server with SQLite as the only
datastore. Optional client-side encryption keeps selected books unreadable to the
server itself.

This repository is a cleaned-up public snapshot of a private project built
between April and November 2026. Infrastructure scripts, private data and
deployment details have been removed; the application code is otherwise intact.

## Features

- **Library**: upload PDF and EPUB files (EPUB is converted to PDF with Calibre),
  shelves and categories, metadata editing and enrichment, import of
  public-domain books from Project Gutenberg, Open Library, Google Books and the
  Internet Archive (host allowlist), duplicate detection, trash with restore,
  storage quotas.
- **Reader**: PDF.js rendering with a geometry-normalised text layer, single and
  double page modes, highlights and area notes, freehand drawing, bookmarks,
  in-document search, reflow and RSVP speed-reading modes, OCR (Tesseract.js,
  bundled) for scanned pages, text-to-speech.
- **Search across books**: page text is extracted server-side into SQLite and
  searched per user; extraction runs in a lease-based background queue keyed by
  file revision so stale caches are never served.
- **Study tools**: word library with dictionary/translation lookups, reading
  goals and statistics, research notebooks, cited multi-document AI answers,
  a knowledge graph of linked notes, audio notes with time-linked markers,
  side-by-side compare view.
- **Collaboration**: invite-only registration, reading groups with shared books
  and threaded annotation replies.
- **End-to-end encryption (optional, per book)**: files are encrypted in the
  browser with AES-GCM; the file key is wrapped by a vault key derived from the
  user's password (PBKDF2), with a recovery code. The server refuses to store
  plaintext derivatives (page text, previews, annotations) for encrypted books.
- **Offline-friendly**: PWA with service worker, device sync with checkpoints,
  local IndexedDB stores for decrypted derivatives.
- **Operations**: health endpoint, encrypted backups to local disk and any
  S3-compatible bucket, admin panels for users, backups and bug reports.
- **Native client prototypes** (`native/`): SwiftUI/PDFKit (macOS/iOS),
  Kotlin/Compose (Android) and Windows Forms clients against the same API.
- UI in Turkish, English and German.

## Tech stack

| Area | Tools |
| --- | --- |
| App | Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript, Tailwind CSS 4 |
| Data | SQLite via `better-sqlite3`, versioned migrations |
| PDF | `pdfjs-dist`, `react-pdf`, `pdf-lib`, Tesseract.js |
| Server tools | Calibre `ebook-convert`, Ghostscript, Poppler (`pdfimages`) |
| Crypto | WebCrypto (AES-GCM, PBKDF2), HMAC-signed session cookies |
| Tests | Vitest, Testing Library, jsdom; Playwright scripts for reader QA |
| Deploy | Docker (non-root, standalone output), Nginx reverse proxy example |

## Architecture

```
browser ── proxy.ts (auth gate, rate limit, security headers)
              │
              ├── app/            pages (library, reader, notes, groups, admin…)
              ├── app/api/        69 route handlers, each checks the session user
              │     └── uploads/  only path that serves stored files (ownership check)
              └── lib/            domain logic: db + migrations, auth, crypto,
                                  text extraction/indexer, sync, quotas, backups
SQLite (data/library.db)    files (public/uploads/, never served statically)
```

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) and
[`docs/READER_ACCESSIBILITY.md`](docs/READER_ACCESSIBILITY.md).

## Engineering notes

- **Canonical page text model** (`lib/pdfTextModel.ts`): PDF.js text items are
  normalised into a versioned model with stable word identity and rotation-free
  normalised coordinates, so selections, highlights, search and TTS all agree
  regardless of zoom or rotation.
- **Revision-aware extraction queue** (`lib/indexer.ts`): page text is cached per
  file revision fingerprint; a SQLite lease table prevents multiple processes
  from claiming the same job.
- **Encrypted-book policy** (`lib/encryptedBookPolicy.ts`): one place decides
  which server features (AI, TTS, export, previews) are disabled for encrypted
  books, and tests enforce it.
- **Session security** (`lib/auth.ts`, `proxy.ts`): HMAC-SHA256 signed cookies
  with a per-user session version for instant revocation, constant-time
  signature comparison, PBKDF2 password hashing.
- **Upload hardening** (`app/api/upload/route.ts`): size limits, per-user upload
  lock against quota races, file signature sniffing, ZIP-bomb checks for EPUB,
  and shell-free conversion (`execFile`, timeouts, unprivileged user).
- **Static audit** (`scripts/security-audit.js`): CI-style check that every
  private route calls `getCurrentUser`, file routes check ownership and uploads
  can only be reached through the guarded handler.

## Getting started

Requirements: Node.js 20+, npm. For EPUB conversion and PDF compression you also
need `calibre`, `ghostscript` and `poppler-utils` on the PATH (the Docker image
installs them).

```bash
npm install
cp .env.example .env.local      # then edit the values
npm run dev                      # http://localhost:3000
```

In development an `owner` admin account and a `test` account are created on
first start. Set `PDF_LIBRARY_PASSWORD` in `.env.local` to choose the owner
password; production refuses to start without `PDF_LIBRARY_PASSWORD` and
`PDF_LIBRARY_SESSION_SECRET`. Additional users can be created with
`npm run user:create -- <username>` or via invite codes (`npm run invite:create`).

Environment variables are documented in [`.env.example`](.env.example). All AI,
OCR, TTS, translation, email and S3 integrations are optional.

### Scripts

```bash
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit
npm test                # Vitest (47 files, 290 tests)
npm run build           # production build (standalone)
npm run security:audit  # static route/auth audit
```

### Docker

```bash
docker compose up -d --build                        # app on 127.0.0.1:3000
docker compose --profile bundled-proxy up -d        # plus the example Nginx proxy
```

Edit `nginx.conf` (domain and certificate paths are placeholders) before using
the bundled proxy.

## Status

Feature-complete for personal and small-group use and was run on a single VPS.
The native clients are prototypes. There is no hosted demo.

## How it was built

Developed with AI coding assistants (Claude Code and OpenAI Codex). I defined
the product, made the architecture and security decisions, reviewed the
changes and tested the app; the assistants wrote much of the implementation
under that direction.

## License

[MIT](LICENSE). Bundled third-party assets and dependencies keep their own
licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
