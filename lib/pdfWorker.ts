export { PDFJS_VERSION, PDF_WORKER_SRC } from './pdfWorker.generated'

// pdf.js needs the standard-14 font programs and CMaps to render (and lay out
// the invisible text layer for) documents whose fonts are not embedded. Without
// them pdf.js substitutes a generic `sans-serif` face and squeezes each line
// with a single `scaleX(...)`. That only matches the total line width, so the
// per-glyph hit boxes drift from the canvas and text selection grabs the wrong
// characters. Serving these assets makes the text layer align with the render.
// pdf.js validates cMapUrl / standardFontDataUrl with `new URL(...)` and only
// fetches them when they are absolute, so a bare `/standard_fonts/` is silently
// ignored (it falls back to system fonts). Resolve against the current origin
// on the client.
const assetOrigin = typeof window !== 'undefined' ? window.location.origin : ''
export const PDF_STANDARD_FONT_DATA_URL = `${assetOrigin}/standard_fonts/`
export const PDF_CMAP_URL = `${assetOrigin}/cmaps/`

// Keep this object referentially stable so react-pdf does not reload the
// document on every render.
export const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: PDF_CMAP_URL,
  cMapPacked: true,
  standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  // With the default `useSystemFonts: true`, pdf.js renders non-embedded fonts
  // with a local system face and a generic `sans-serif` in the text layer,
  // whose metrics do not match the canvas — so selection hit boxes drift.
  // Forcing it off makes pdf.js download the bundled standard font programs
  // (Liberation/Foxit) whose metrics match the render, aligning selection.
  useSystemFonts: false,
} as const
