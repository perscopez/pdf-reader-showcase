# Reader accessibility notes

The reader exposes keyboard page navigation (Arrow keys, Page Up/Down, Space), labeled controls, visible focus rings, 44px touch targets, reduced motion, high contrast, and an e-ink mode that removes color-dependent decoration and heavy shadows. Reflow mode also exposes an explicit left-to-right/right-to-left direction preference; `auto` leaves direction to the document/browser.

PDF.js renders a PDF page as a canvas plus a positioned text layer. That text layer is useful for selection, search, copy, TTS, and OCR recovery, but it is not a semantic document tree: headings, reading order, tables, figures, links, and language metadata cannot be reliably inferred from arbitrary PDF coordinates. Assistive technology should therefore use the reader chrome and reflow mode for navigation and reading when available. The PDF canvas remains the source-faithful view, and the app does not pretend that its generated spans are equivalent to semantic HTML.

This is an implementation limitation rather than a reason to remove reader capabilities. Future work may add tagged-PDF metadata support and richer source semantics, but must keep the fail-closed encrypted-reader path and existing selection behavior intact.
