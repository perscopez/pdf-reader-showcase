# Architecture

## Main Surfaces

- `app/page.tsx`: library home, upload/edit/profile dialogs, search, shelves.
- `app/reader/[id]/page.tsx`: loads a book and mounts the PDF reader.
- `components/PDFReader.tsx`: PDF reader behavior and toolbar.
- `components/SelectionPopup.tsx`: selection actions, definitions, translation, word saving.
- `components/ReaderUI.tsx`: reader themes and shared reader controls.
- `components/I18nProvider.tsx`: all visible translations.

## Server And Data

- `lib/db.ts`: SQLite schema and migrations.
- `lib/auth.ts`: signed sessions and current-user lookup.
- `app/api/auth/*`: login, registration, account profile.
- `app/api/books/*`: book metadata and reading sessions.
- `app/api/annotations`, `bookmarks`, `words`: user-owned reader data.

## Reader Text And Geometry

- PDF.js canvas pixels remain the visible source of truth. Its transparent text layer is normalized after rendering into visual top-to-bottom/left-to-right DOM order because PDF object order may interleave headers and footers.
- Search and TTS use named CSS Highlight API ranges. The rules are emitted by `components/PDFReader.tsx` rather than global optimized CSS because the current Next CSS optimizer drops `::highlight()` rules.
- `lib/pdfTextModel.ts` defines the v5 canonical page model, including document revision, extraction provenance, rotation, stable word identity, and text offsets.
- Selection and annotation rectangles are stored in canonical unrotated normalized coordinates; rotation is applied only when displaying them.
- Each visible page in double-page mode owns its canvas, dimensions, page model, OCR job, note rail, and highlight overlay.

## Text Extraction And Cache Invalidation

- `app/api/books/[id]/page-text/route.ts` serves valid revision-matched cache rows immediately and queues missing/stale extraction without blocking the request.
- `lib/indexer.ts` calculates file revision fingerprints and uses a SQLite lease queue so multiple app processes cannot claim the same extraction job.
- `next.config.js` applies `loaders/pdfjs-exports-fix.js` to both modern/legacy and client/server PDF.js bundles; limiting it to the client entrypoint silently disables geometry-aware server extraction in webpack dev/runtime builds.
- Bulk page-text reads use bounded cursor pagination. OCR downgrade protection applies only when the existing model belongs to the current document revision.
- `lib/dbMigrations.ts` owns serialized versioned migrations; destructive page deduplication must not run on every boot.

## Encrypted Book Derivatives

- The server stores encrypted book ciphertext and wrapped keys, but refuses plaintext page text, annotations, previews, bookmarks, words, and sync mutations for encrypted books.
- Decrypted reader derivatives live only in the dedicated non-sync IndexedDB stores defined by `lib/indexedDb.ts` and `lib/encryptedReaderStore.ts`.
- Cloud AI/TTS, server PDF export, online dictionary/translation, and generated page-cover upload are disabled for encrypted books because each would disclose plaintext or page pixels.
- Device-local encrypted-book derivatives are deleted atomically across all stores when the book is removed. They are device-local and do not sync.

## Operational Notes

- Production runs as a non-root Docker container (`Dockerfile`, `docker-compose.yml`) behind an Nginx reverse proxy (`nginx.conf` is an example with placeholder domain and certificate paths).
- `data/` (SQLite database) and `public/uploads/` (book files, covers, avatars, audio notes) are persistent volumes and must be preserved across deploys.
- Uploaded files are never served by Next's static file handler: `/uploads/*` is rewritten to an authenticated route handler that checks ownership before streaming.
- Backups: `scripts/safe-backup.js` creates encrypted tar archives locally and optionally uploads them to S3-compatible storage (`scripts/backup-s3.js`, `scripts/verify-backup-s3.js`).
- Conversions (EPUB to PDF via Calibre, PDF compression via Ghostscript) run through `execFile` without a shell, with timeouts, and as `nobody` when the server runs as root.

## Verification

```bash
npx tsc --noEmit
npx eslint --quiet app components lib proxy.ts
npm run build
```
