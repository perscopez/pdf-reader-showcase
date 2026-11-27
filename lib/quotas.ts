import { stat } from 'fs/promises'
import path from 'path'
import db from './db'

export function getTodayDateString(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function estimateTtsDuration(text: string, speakingRate = 1.0): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  // Average speaking speed: 150 words per minute (2.5 words per second) at 1.0 speed
  const baseWordsPerSecond = 2.5
  const actualWordsPerSecond = baseWordsPerSecond * speakingRate
  return actualWordsPerSecond > 0 ? words / actualWordsPerSecond : 0
}

export async function getUserStorageUsage(userId: number): Promise<number> {
  const books = db.prepare('SELECT filename FROM books WHERE user_id = ?').all(userId) as { filename: string }[]
  let totalSize = 0
  const countedFiles = new Set<string>()

  for (const book of books) {
    if (countedFiles.has(book.filename)) continue
    countedFiles.add(book.filename)
    try {
      const filePath = path.join(process.cwd(), 'public', 'uploads', book.filename)
      const st = await stat(filePath)
      totalSize += st.size
    } catch {
      // File might not exist yet or was deleted
    }
  }
  return totalSize
}

export function checkAndIncrementAiQuota(userId: number, limit = 50): boolean {
  // Exempt admin/owner
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (user?.role === 'admin') return true

  const today = getTodayDateString()

  // Get or create usage row for today
  db.prepare(`
    INSERT OR IGNORE INTO daily_usage (user_id, usage_date, ai_requests_count, tts_duration_seconds)
    VALUES (?, ?, 0, 0.0)
  `).run(userId, today)

  const usage = db.prepare(`
    SELECT ai_requests_count FROM daily_usage WHERE user_id = ? AND usage_date = ?
  `).get(userId, today) as { ai_requests_count: number } | undefined

  if (!usage) return false

  if (usage.ai_requests_count >= limit) {
    return false
  }

  db.prepare(`
    UPDATE daily_usage SET ai_requests_count = ai_requests_count + 1 WHERE user_id = ? AND usage_date = ?
  `).run(userId, today)

  return true
}

export function checkAndIncrementTtsQuota(userId: number, durationSeconds: number, limitSeconds = 1800): boolean {
  // Exempt admin/owner
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
  if (user?.role === 'admin') return true

  const today = getTodayDateString()

  // Get or create usage row for today
  db.prepare(`
    INSERT OR IGNORE INTO daily_usage (user_id, usage_date, ai_requests_count, tts_duration_seconds)
    VALUES (?, ?, 0, 0.0)
  `).run(userId, today)

  const usage = db.prepare(`
    SELECT tts_duration_seconds FROM daily_usage WHERE user_id = ? AND usage_date = ?
  `).get(userId, today) as { tts_duration_seconds: number } | undefined

  if (!usage) return false

  if (usage.tts_duration_seconds + durationSeconds > limitSeconds) {
    return false
  }

  db.prepare(`
    UPDATE daily_usage SET tts_duration_seconds = tts_duration_seconds + ? WHERE user_id = ? AND usage_date = ?
  `).run(durationSeconds, userId, today)

  return true
}
