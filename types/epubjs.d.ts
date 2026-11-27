declare module 'epubjs' {
  type RenditionLocation = {
    start?: {
      cfi?: string
      percentage?: number
    }
  }

  type Rendition = {
    display: (target?: string) => Promise<unknown>
    next: () => Promise<unknown>
    prev: () => Promise<unknown>
    on: (event: 'relocated', callback: (location: RenditionLocation) => void) => void
    destroy: () => void
  }

  type Book = {
    ready: Promise<unknown>
    renderTo: (element: HTMLElement, options?: Record<string, unknown>) => Rendition
    destroy: () => void
  }

  export default function ePub(input: string | ArrayBuffer, options?: Record<string, unknown>): Book
}
