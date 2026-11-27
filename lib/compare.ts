export interface CompareBookOption {
  id: number
  title: string
  author?: string | null
  filename?: string | null
  last_page?: number | null
  total_pages?: number | null
  is_encrypted?: number
}

export function isComparablePdf(book: CompareBookOption) {
  return !book.is_encrypted && Boolean(book.filename?.toLocaleLowerCase().endsWith('.pdf'))
}

export function normalizeCompareSelection(first: unknown, second: unknown): [number, number] {
  const a = Number(first)
  const b = Number(second)
  return [
    Number.isInteger(a) && a > 0 ? a : 0,
    Number.isInteger(b) && b > 0 && b !== a ? b : 0,
  ]
}
