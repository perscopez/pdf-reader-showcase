import { describe, it, expect } from 'vitest'
import { createZip, parseStoredZip } from '@/lib/zip'

describe('createZip / parseStoredZip', () => {
  it('should create and parse a zip with single entry', () => {
    const entries = [{ name: 'test.txt', data: Buffer.from('Hello World') }]
    const zip = createZip(entries)
    expect(zip.length).toBeGreaterThan(0)
    const parsed = parseStoredZip(zip)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('test.txt')
    expect(parsed[0].data.toString()).toBe('Hello World')
  })

  it('should create and parse a zip with multiple entries', () => {
    const entries = [
      { name: 'file1.txt', data: Buffer.from('Content 1') },
      { name: 'dir/file2.txt', data: Buffer.from('Content 2') },
      { name: 'file3.bin', data: Buffer.from([0, 255, 128, 64]) },
    ]
    const zip = createZip(entries)
    const parsed = parseStoredZip(zip)
    expect(parsed).toHaveLength(3)
    expect(parsed[0].name).toBe('file1.txt')
    expect(parsed[0].data.toString()).toBe('Content 1')
    expect(parsed[1].name).toBe('dir/file2.txt')
    expect(parsed[1].data.toString()).toBe('Content 2')
    expect([...parsed[2].data]).toEqual([0, 255, 128, 64])
  })

  it('should handle empty entries array', () => {
    const zip = createZip([])
    expect(zip.length).toBeGreaterThan(0)
    const parsed = parseStoredZip(zip)
    expect(parsed).toHaveLength(0)
  })

  it('should handle empty file content', () => {
    const entries = [{ name: 'empty.txt', data: Buffer.from([]) }]
    const zip = createZip(entries)
    const parsed = parseStoredZip(zip)
    expect(parsed[0].data).toHaveLength(0)
  })

  it('should produce valid ZIP magic bytes', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('test') }])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  })

  it('should throw on unsupported compression method', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('test') }])
    zip.writeUInt16LE(8, 8)
    expect(() => parseStoredZip(zip)).toThrow('Only stored ZIP entries')
  })

  it('should normalize backslashes to forward slashes', () => {
    const entries = [{ name: 'dir\\file.txt', data: Buffer.from('test') }]
    const zip = createZip(entries)
    const parsed = parseStoredZip(zip)
    expect(parsed[0].name).toBe('dir/file.txt')
  })
})
