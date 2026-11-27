# Native Client API Contract

Default server (placeholder): `https://library.example.com`

The native MVP uses the existing cookie session API directly:

1. `POST /api/auth/login`
   - JSON: `{ "username": "...", "password": "..." }`
   - Stores `pdf_library_auth` HTTP-only cookie from `Set-Cookie`.
2. `GET /api/books`
   - Returns the authenticated user's books.
3. `GET /uploads/{filename}`
   - Downloads the authenticated user's PDF bytes.
4. `PATCH /api/books/{id}`
   - JSON: `{ "last_page": 12, "last_opened_at": "ISO_DATE" }`
   - Saves native reading progress.

Scope intentionally excluded from the MVP:
- App Store / Play Store / Microsoft Store public release flow.
- Public marketing assets.
- Full native E2EE PDF decryption for encrypted uploads. Unencrypted PDFs work first; encrypted native support is a follow-up.
