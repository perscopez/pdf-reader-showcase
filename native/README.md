# Native Client Prototypes

Experimental, fully native clients that talk to the same backend API as the web app.

- Apple: SwiftUI + PDFKit (`native/apple`), macOS target; the same sources can be used for iOS from an Xcode app target.
- Android: Kotlin + Jetpack Compose + Android `PdfRenderer` (`native/android`).
- Windows: Windows Forms + a Pdfium-based renderer (`native/windows`).

They use the existing cookie-session API. The default server URL is a placeholder
(`https://library.example.com`) and can be changed in each app's settings screen.

MVP flow:
1. Log in.
2. List `/api/books`.
3. Download `/uploads/{filename}`.
4. Open with the platform-native PDF renderer.
5. Save reading progress via `PATCH /api/books/{id}`.

Encrypted PDFs are supported through the same E2EE format as the web client:
password-derived vault key unwrap, FEK unwrap, then AES-GCM blob decryption.

These clients are prototypes and are not published to any app store.
