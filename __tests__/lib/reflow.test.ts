import { describe, it, expect } from 'vitest'
import { buildReflowPage, buildReflowPageFromText, fallbackReflowPage } from '@/lib/reflow'

describe('buildReflowPage', () => {
  it('should return empty page for empty input', () => {
    const result = buildReflowPage([])
    expect(result.version).toBe(1)
    expect(result.blocks).toHaveLength(0)
    expect(result.text).toBe('')
  })

  it('should create a paragraph block for simple text', () => {
    const items = [
      { str: 'Hello World', transform: [12, 0, 0, 12, 50, 700], hasEOL: true, width: 100, height: 12 },
    ]
    const result = buildReflowPage(items)
    expect(result.blocks.length).toBeGreaterThan(0)
    expect(result.blocks[0].type).toBe('paragraph')
    expect(result.text).toContain('Hello World')
  })

  it('should detect heading based on font size', () => {
    const items = [
      { str: 'Some body text', transform: [12, 0, 0, 12, 50, 720], hasEOL: true, width: 100, height: 12 },
      { str: 'Chapter 1', transform: [24, 0, 0, 24, 50, 750], hasEOL: true, width: 80, height: 24 },
    ]
    const result = buildReflowPage(items)
    const headingBlock = result.blocks.find(b => b.type === 'heading')
    expect(headingBlock).toBeDefined()
    expect(headingBlock!.text).toContain('Chapter 1')
  })

  it('should order lines by position', () => {
    const items = [
      { str: 'Second line', transform: [12, 0, 0, 12, 50, 600], hasEOL: true, width: 80, height: 12 },
      { str: 'First line', transform: [12, 0, 0, 12, 50, 700], hasEOL: true, width: 80, height: 12 },
    ]
    const result = buildReflowPage(items)
    expect(result.blocks.length).toBeGreaterThanOrEqual(1)
    expect(result.blocks[0].text).toContain('First line')
  })
})

describe('buildReflowPageFromText', () => {
  it('should return empty page for empty input', () => {
    const result = buildReflowPageFromText('')
    expect(result.version).toBe(1)
    expect(result.blocks).toHaveLength(0)
  })

  it('should create paragraph blocks from plain text', () => {
    const text = 'This is a simple paragraph.\nAnother line in the same paragraph.'
    const result = buildReflowPageFromText(text)
    expect(result.blocks.length).toBeGreaterThan(0)
    expect(result.blocks[0].type).toBe('paragraph')
    expect(result.text).toContain('simple paragraph')
  })

  it('should detect heading by uppercase ratio', () => {
    const text = 'CHAPTER ONE'
    const result = buildReflowPageFromText(text, text)
    expect(result.blocks[0].type).toBe('heading')
  })

  it('should not treat short lowercase text as heading', () => {
    const text = 'hello world'
    const result = buildReflowPageFromText(text, text)
    expect(result.blocks[0].type).toBe('paragraph')
  })

  it('should detect list items', () => {
    const text = '- First item\n- Second item'
    const result = buildReflowPageFromText(text, text)
    expect(result.blocks.every(b => b.type === 'list')).toBe(true)
  })

  it('should handle numbered list items', () => {
    const text = '1. First\n2. Second'
    const result = buildReflowPageFromText(text, text)
    expect(result.blocks.every(b => b.type === 'list')).toBe(true)
  })

  it('should separate blocks by paragraph breaks', () => {
    const text = 'First paragraph.\n\nSecond paragraph.'
    const result = buildReflowPageFromText(text, text)
    expect(result.blocks.length).toBe(2)
    expect(result.blocks[0].type).toBe('paragraph')
    expect(result.blocks[1].type).toBe('paragraph')
  })
})

describe('fallbackReflowPage', () => {
  it('should split by double newlines', () => {
    const content = 'Block one.\n\nBlock two.\n\nBlock three.'
    const result = fallbackReflowPage(content)
    expect(result.blocks).toHaveLength(3)
    expect(result.blocks.every(b => b.type === 'paragraph')).toBe(true)
  })

  it('should handle single paragraph', () => {
    const content = 'Just one paragraph.'
    const result = fallbackReflowPage(content)
    expect(result.blocks).toHaveLength(1)
    expect(result.text).toBe('Just one paragraph.')
  })

  it('should return empty for empty input', () => {
    const result = fallbackReflowPage('')
    expect(result.blocks).toHaveLength(0)
  })

  it('should clean inline text in blocks', () => {
    const content = '\u0000Hello\u0000 \u0000World\u0000'
    const result = fallbackReflowPage(content)
    expect(result.text).toBe('Hello World')
  })
})
