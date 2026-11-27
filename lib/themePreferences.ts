export const THEME_STORAGE = {
  library: 'library-theme',
  reader: 'reader-settings',
  readerBook: (bookId: number) => `reader-settings:${bookId}`,
  rsvp: 'rsvp-theme',
  rsvpPreviewBackground: 'rsvp-preview-background',
} as const
