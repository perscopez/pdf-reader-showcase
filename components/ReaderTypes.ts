export type DrawTool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'sticky'
export type ReaderTheme = 'midnight' | 'slate' | 'paper' | 'sepia' | 'seoul'
export type SidePanel = null | 'progress' | 'notes' | 'highlights' | 'bookmarks' | 'ask-ai' | 'audio-notes' | 'outline' | 'navigator' | 'quality' | 'study'
export type AnnotationFilter = 'all' | 'highlight' | 'note'
export type PageLayout = 'single' | 'double'

export interface Point {
  x: number
  y: number
  pressure?: number
}

export interface DrawPath {
  color: string
  width: number
  points: Point[]
  opacity?: number
  tool?: Exclude<DrawTool, 'eraser'>
  text?: string
  fontSize?: number
}

export interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
}

export interface AnnotationArea {
  left: number
  top: number
  width: number
  height: number
  previewUrl?: string
}

export type SnapshotKind = 'image' | 'table' | 'figure' | 'formula' | 'region'

export interface AnnotationSnapshot {
  rect: AnnotationArea
  previewUrl?: string
  kind?: SnapshotKind
}

export interface AnnotationSource {
  page: number
  text?: string
  rects?: HighlightRect[]
  area?: AnnotationArea
}

export interface AudioCursor {
  page: number
  wordIndex: number
  source: 'tts' | 'rsvp'
  text?: string
  provider?: 'browser' | 'google'
  timeMs?: number
  durationMs?: number
  chunkStartWord?: number
  chunkEndWord?: number
}

export interface Annotation {
  id: number
  type: string
  content: {
    schemaVersion?: 2
    text?: string
    note?: string
    color?: string
    paths?: DrawPath[]
    rects?: HighlightRect[]
    cfi?: string
    source?: string
    pageNote?: boolean
    tags?: string[]
    categoryId?: number | null
    area?: AnnotationArea
    snapshot?: AnnotationSnapshot
    sources?: AnnotationSource[]
    audioCursor?: AudioCursor
    audioNoteSessionId?: number | string
    audioNoteTimestampMs?: number
    audioNoteMarkerPage?: number
  }
  page: number
  created_at?: string
  updated_at?: string
}

export interface BookmarkRow {
  id: number
  page: number
  label: string
}

export interface ReadingSession {
  id: number
  start_page: number
  end_page: number
  pages_read: number
  duration_seconds: number
  started_at: string
  ended_at: string
}

export interface ReadingStats {
  recent: ReadingSession[]
  today: { seconds: number; pages: number }
  last7: { seconds: number; pages: number; active_days: number }
  totals: { total_seconds: number; total_pages: number; session_count: number }
  avg_seconds_per_page: number | null
  daily_pages: number
}
