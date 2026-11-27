import { mkdir, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function managedFilePath(url: string | null | undefined, folder: string) {
  const prefix = `/uploads/${folder}/`
  if (!url?.startsWith(prefix)) return null
  const filename = path.basename(url)
  if (!filename || `${prefix}${filename}` !== url) return null
  return path.join(process.cwd(), 'public', 'uploads', folder, filename)
}

export async function removeManagedImage(url: string | null | undefined, folder: string) {
  const filePath = managedFilePath(url, folder)
  if (filePath) await unlink(filePath).catch(() => {})
}

export async function persistDataImage(
  value: unknown,
  folder: 'avatars' | 'thumbnails',
  prefix: string,
  previousUrl?: string | null,
) {
  if (typeof value !== 'string') throw new Error('Invalid image')
  if (!value) {
    await removeManagedImage(previousUrl, folder)
    return ''
  }
  if (!value.startsWith('data:image/')) {
    if (value === previousUrl && managedFilePath(value, folder)) return value
    throw new Error('Invalid image')
  }

  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value)
  const extension = match ? IMAGE_TYPES[match[1].toLowerCase()] : undefined
  if (!match || !extension) throw new Error('Invalid image')

  const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!data.length || data.length > MAX_IMAGE_BYTES) throw new Error('Invalid image')

  const directory = path.join(process.cwd(), 'public', 'uploads', folder)
  await mkdir(directory, { recursive: true })
  const filename = `${prefix}-${Date.now()}-${randomBytes(6).toString('hex')}.${extension}`
  await writeFile(path.join(directory, filename), data)
  await removeManagedImage(previousUrl, folder)
  return `/uploads/${folder}/${filename}`
}
