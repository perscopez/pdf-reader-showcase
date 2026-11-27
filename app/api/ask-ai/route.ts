import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { getCurrentUser, userOwnsBook } from '@/lib/auth'
import { checkAndIncrementAiQuota } from '@/lib/quotas'
import { checkRateLimit } from '@/lib/rateLimit'

interface ChatMessage {
  role: string
  content: string
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

function getGeminiKey() {
  const k = process.env.GEMINI_API_KEY?.trim()
  return k && k !== 'your_gemini_api_key_here' ? k : ''
}

function getGroqKey() {
  const k = process.env.GROQ_API_KEY?.trim()
  return k && k !== 'your_groq_api_key_here' ? k : ''
}

function getOpenAIKey() {
  const k = process.env.OPENAI_API_KEY?.trim()
  return k && k !== 'your_openai_api_key_here' ? k : ''
}
function getGitHubKey() {
  const k = process.env.GITHUB_TOKEN?.trim()
  return k && k !== 'your_github_token_here' ? k : ''
}
function getOpenRouterKey() {
  const k = process.env.OPENROUTER_API_KEY?.trim()
  return k && k !== 'your_openrouter_api_key_here' ? k : ''
}

function buildSystemPrompt(bookTitle: string, bookAuthor: string, bookId: number, context: string): string {
  return `You are a reading assistant built into a PDF reader. You help the user understand the exact book they are reading right now.

CURRENT BOOK: "${bookTitle}"${bookAuthor ? ` — ${bookAuthor}` : ''} (id: ${bookId}).

HOW TO ANSWER:
- Ground your answer first in the book excerpts provided below; they are the pages most relevant to the question. Quote or paraphrase them and cite the page like "(s. 42)".
- You may add relevant general knowledge about this book or author, but clearly separate it from what the text actually says, and never invent quotes, page numbers, characters, or events that are not in the book.
- If the book and your general knowledge conflict, trust the book.
- Be accurate and to the point: give the direct answer first, then only the supporting detail that helps. Use short paragraphs or bullets, not walls of text.
- Reply in the SAME language as the user's question (the books are mostly Turkish, so most questions will be Turkish).
- You can ONLY answer questions. You cannot highlight, take notes, or bookmark. If the user asks you to highlight ("vurgula"), add a note, or bookmark something, briefly tell them they can do it themselves in the reader (select the text, then use the highlight / note / bookmark buttons), and point them to the exact page and passage if you know it.

RELEVANT BOOK EXCERPTS (keyword-matched to the question; page numbers in brackets):
${context.slice(0, 6000)}`
}

function buildFallbackAnswer(question: string, rows: { page_number: number; content: string }[]): string {
  const q = question.toLowerCase()
  const words = q.split(/\s+/).filter(w => w.length > 2 && !['bir','bu','ve','veya','ile','için','ama','sonra','önce','ne','nasıl','neden','hangi','kim','kaç','mı','mu','mi','da','de','daha','en','çok','az','her','tüm','bütün','kendi','gibi','kadar','ancak','ya','ise','eğer','ki','üzere','yani','çünkü','fakat','lakin','oysa','madem','rağmen','karşın','bile','hiç','değil','hem','ya da','kitapta'].includes(w))
  const matches: { page_number: number; score: number }[] = []
  for (const w of words) {
    for (const r of rows) {
      if (r.content.toLowerCase().includes(w)) {
        const existing = matches.find(m => m.page_number === r.page_number)
        if (existing) existing.score++
        else matches.push({ page_number: r.page_number, score: 1 })
      }
    }
  }
  matches.sort((a, b) => b.score - a.score)
  if (matches.length > 0) {
    const top = matches.slice(0, 3).map(m => {
      const row = rows.find(r => r.page_number === m.page_number)!
      // Find the snippet around the best matching word
      const lower = row.content.toLowerCase()
      let start = 0
      for (const w of words) {
        const idx = lower.indexOf(w)
        if (idx >= 0) { start = Math.max(0, idx - 150); break }
      }
      return `**Page ${m.page_number}:** ${row.content.slice(start, start + 400)}...`
    })
    return `Found relevant content on ${matches.slice(0, 3).map(m => `page ${m.page_number}`).join(', ')}:\n\n${top.join('\n\n')}`
  }
  return `The PDF content has been indexed (${rows.length} pages). I couldn't find a direct match for "${question}". Try rephrasing or ask about a specific topic.`
}

async function executeToolCall(toolCall: { name: string; arguments: string }, userId: number, bookId: number): Promise<string> {
  const args = JSON.parse(toolCall.arguments)

  switch (toolCall.name) {
    case 'add_note': {
      const page = Number(args.page)
      const content = cleanText(String(args.content || '')).slice(0, 2000)
      if (!page || !content) return 'Error: page and content are required.'
      const result = db.prepare(
        'INSERT INTO annotations (user_id, book_id, type, content, page) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, bookId, 'note', JSON.stringify({ note: content }), page)
      return `Note added to page ${page}. (id: ${result.lastInsertRowid})`
    }

    case 'add_highlight': {
      const page = Number(args.page)
      const text = cleanText(String(args.text || '')).slice(0, 500)
      if (!page || !text) return 'Error: page and text are required.'
      const color = typeof args.color === 'string' ? args.color : '#facc15'
      const result = db.prepare(
        'INSERT INTO annotations (user_id, book_id, type, content, page) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, bookId, 'highlight', JSON.stringify({ text, color }), page)
      return `Text highlighted on page ${page}. (id: ${result.lastInsertRowid})`
    }

    case 'add_bookmark': {
      const page = Number(args.page)
      if (!page) return 'Error: page is required.'
      const exists = db.prepare(
        'SELECT id FROM bookmarks WHERE user_id = ? AND book_id = ? AND page = ?'
      ).get(userId, bookId, page)
      if (exists) return `Page ${page} is already bookmarked.`
      db.prepare(
        'INSERT INTO bookmarks (user_id, book_id, page) VALUES (?, ?, ?)'
      ).run(userId, bookId, page)
      return `Page ${page} bookmarked.`
    }

    case 'list_books': {
      const books = db.prepare(
        'SELECT id, title, author, total_pages, category FROM books WHERE user_id = ? ORDER BY title'
      ).all(userId) as { id: number; title: string; author: string; total_pages: number; category: string }[]
      return JSON.stringify(books.map(b => ({ id: b.id, title: b.title, author: b.author, pages: b.total_pages, category: b.category })))
    }

    case 'get_book_info': {
      const targetId = Number(args.book_id)
      if (!targetId) return 'Error: book_id is required.'
      if (!userOwnsBook(userId, targetId)) return 'Book not found.'
      const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(targetId, userId) as Record<string, unknown> | undefined
      if (!book) return 'Book not found.'
      return JSON.stringify({
        id: book.id,
        title: book.title,
        author: book.author,
        totalPages: book.total_pages,
        category: book.category,
        tags: book.tags ? JSON.parse(book.tags as string) : [],
        status: book.status,
      })
    }

    case 'get_page_content': {
      const targetId = Number(args.book_id) || bookId
      const page = Number(args.page)
      if (!page) return 'Error: page is required.'
      if (!userOwnsBook(userId, targetId)) return 'Book not found.'
      const row = db.prepare(
        'SELECT content FROM book_pages WHERE book_id = ? AND page_number = ? LIMIT 1'
      ).get(targetId, page) as { content: string } | undefined
      if (!row) return `Page ${page} has no indexed content.`
      return `[Page ${page}]: ${row.content.slice(0, 3000)}`
    }

    default:
      return `Unknown tool: ${toolCall.name}`
  }
}

async function callGeminiWithTools(messages: ChatMessage[], userId: number, bookId: number, maxTurns = 5): Promise<string> {
  const key = getGeminiKey()
  if (!key) return ''

  const contents: { role: string; parts: Record<string, unknown>[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    if (m.role === 'tool') {
      contents.push({ role: 'function', parts: [{ functionResponse: { name: '', response: { result: m.content } } }] })
    } else {
      contents.push({ role, parts: [{ text: m.content || '' }] })
    }
  }

  const systemInstruction = messages.find(m => m.role === 'system')?.content || ''

  let finalAnswer = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: 512, temperature: 0.3 },
    }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const data = await res.json()

    if (!res.ok || data?.error) {
      const errMsg = data?.error?.message || `API error (${res.status})`
      console.error('[ask-ai Gemini API]', errMsg)
      throw new Error(`Gemini: ${errMsg}`)
    }

    const candidate = data?.candidates?.[0]
    if (!candidate) throw new Error('Gemini: no candidate in response')
    const part = candidate?.content?.parts?.[0]
    if (!part) throw new Error('Gemini: empty response part')

    if (part.functionCall) {
      const tc = part.functionCall
      const result = await executeToolCall({ name: tc.name, arguments: JSON.stringify(tc.args || {}) }, userId, bookId)
      contents.push(candidate.content)
      contents.push({
        role: 'function',
        parts: [{ functionResponse: { name: tc.name, response: { result } } }],
      })
    } else {
      finalAnswer = part.text || ''
      break
    }

    if (turn === maxTurns - 1) {
      finalAnswer = part.text || ''
    }
  }

  return finalAnswer
}

async function fetchWithRetry(url: string, options: Record<string, unknown>, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options as RequestInit)
    if (res.status !== 429) return res
    const body = await res.json().catch(() => ({}))
    const waitMs = Math.min(1000 * Math.pow(2, i) + Math.random() * 500, 10000)
    console.error(`[ask-ai retry] 429, attempt ${i + 1}, waiting ${waitMs}ms: ${body?.error?.message || ''}`)
    if (i < retries - 1) await new Promise(r => setTimeout(r, waitMs))
  }
  return fetch(url, options as RequestInit)
}

async function callOpenAICompatible(
  messages: ChatMessage[], userId: number, bookId: number,
  apiKey: string, baseUrl: string, model: string,
  label: string, path = '/v1/chat/completions', maxTurns = 5
): Promise<string> {
  if (!apiKey) return ''
  const currentMessages = [...messages]
  let finalAnswer = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetchWithRetry(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: currentMessages, max_tokens: 512, temperature: 0.3 }),
    })
    const data = await res.json()
    if (!res.ok || data?.error) {
      const errMsg = data?.error?.message || `API error (${res.status})`
      console.error(`[ask-ai ${label} API]`, errMsg)
      throw new Error(`${label}: ${errMsg}`)
    }
    const message = data?.choices?.[0]?.message
    if (!message) throw new Error(`${label}: empty response message`)

    if (message.tool_calls && message.tool_calls.length > 0) {
      currentMessages.push({ role: 'assistant', content: message.content || '', tool_calls: message.tool_calls.map((tc: { id?: string; function: { name: string; arguments: string }; type?: string }) => ({ id: tc.id || `call_${turn}`, type: 'function', function: tc.function })) })
      for (const tc of message.tool_calls) {
        const result = await executeToolCall(tc.function, userId, bookId)
        currentMessages.push({ role: 'tool', content: result, tool_call_id: tc.id || `call_${turn}` })
      }
    } else {
      finalAnswer = message.content || ''
      break
    }
    if (turn === maxTurns - 1) finalAnswer = message.content || ''
  }
  return finalAnswer
}

const callGroqWithTools = (messages: ChatMessage[], userId: number, bookId: number) =>
  callOpenAICompatible(messages, userId, bookId, getGroqKey(), 'https://api.groq.com', 'llama-3.3-70b-versatile', 'Groq', '/openai/v1/chat/completions')

const callOpenAIWithTools = (messages: ChatMessage[], userId: number, bookId: number) =>
  callOpenAICompatible(messages, userId, bookId, getOpenAIKey(), 'https://api.openai.com', 'gpt-4o-mini', 'OpenAI')

const callGitHubWithTools = (messages: ChatMessage[], userId: number, bookId: number) =>
  callOpenAICompatible(messages, userId, bookId, getGitHubKey(), 'https://models.inference.ai.azure.com', 'gpt-4o-mini', 'GitHub', '/chat/completions')

const callOpenRouterWithTools = (messages: ChatMessage[], userId: number, bookId: number) =>
  callOpenAICompatible(messages, userId, bookId, getOpenRouterKey(), 'https://openrouter.ai/api', 'openai/gpt-4o-mini', 'OpenRouter')

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'ask-ai-rate', 100, 60 * 60 * 1000)
  if (limited) return limited

  const allowed = checkAndIncrementAiQuota(user.id, 50)
  if (!allowed) {
    return NextResponse.json({ error: 'Daily AI request limit (50 requests) exceeded.' }, { status: 429 })
  }

  try {
    const body = await req.json()
    const bookId = Number(body.bookId)
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    const currentPage = body.currentPage ? Number(body.currentPage) : null

    if (!bookId || !question) {
      return NextResponse.json({ error: 'bookId and question are required' }, { status: 400 })
    }
    if (!userOwnsBook(user.id, bookId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const allPages = db.prepare(
      'SELECT page_number, content FROM book_pages WHERE book_id = ? ORDER BY page_number'
    ).all(bookId) as { page_number: number; content: string }[]

    if (allPages.length === 0) {
      return NextResponse.json({ answer: 'This PDF has not been indexed yet. Try opening it in the reader first to trigger indexing.' })
    }

    let contextPages = allPages
    if (currentPage) {
      const nearby = allPages.filter(p => Math.abs(p.page_number - currentPage) <= 2)
      if (nearby.length > 0) contextPages = nearby
    }

    // Search entire book for keywords from the question
    const stopWords = new Set(['bir','bu','ve','veya','ile','için','ama','sonra','önce','ne','nasıl','neden','hangi','kim','kaç','mı','mu','mi','da','de','daha','en','çok','az','her','tüm','bütün','kendi','gibi','kadar','ancak','veya','ya','ise','eğer','ki','üzere','yani','çünkü','fakat','lakin','oysa','madem','rağmen','karşın','bile','hiç','değil','hem','ya da','kitapta'])
    const words = question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2 && !stopWords.has(w))
    // Also search for the full question as a phrase (minus stop words)
    const searchTerms = [...words]
    if (words.length > 1) {
      searchTerms.push(words.join(' '))
    }
    if (searchTerms.length > 0) {
      const scored = allPages.map(p => {
        const lower = p.content.toLowerCase()
        const score = searchTerms.reduce((sum: number, term: string) => sum + (lower.includes(term) ? 2 : 0), 0)
        return { ...p, score }
      }).filter((p: { score: number }) => p.score > 0).sort((a: { score: number }, b: { score: number }) => b.score - a.score).slice(0, 5)
      if (scored.length > 0) {
        const seen = new Set(contextPages.map(p => p.page_number))
        for (const p of scored) {
          if (!seen.has(p.page_number)) {
            contextPages.push(p)
            seen.add(p.page_number)
          }
        }
      }
    }
    contextPages = contextPages.slice(0, 8)

    const book = db.prepare('SELECT title, author FROM books WHERE id = ?').get(bookId) as { title: string; author: string } | undefined
    const bookTitle = book?.title || 'Unknown'
    const bookAuthor = book?.author || ''

    // Build context with snippets centered around keyword matches when possible
    const contextText = contextPages.map(r => {
      const content = r.content
      // Try to find a keyword match and center the snippet around it
      const lower = content.toLowerCase()
      let start = 0
      for (const term of searchTerms) {
        const idx = lower.indexOf(term)
        if (idx >= 0) {
          start = Math.max(0, idx - 200)
          break
        }
      }
      const snippet = content.slice(start, start + 800)
      return `[Page ${r.page_number}]: ${snippet}`
    }).join('\n\n')
    const systemPrompt = buildSystemPrompt(bookTitle, bookAuthor, bookId, contextText)

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ]

    const providers = [
      { key: getGitHubKey(), call: callGitHubWithTools, name: 'GitHub' },
      { key: getGroqKey(), call: callGroqWithTools, name: 'Groq' },
      { key: getGeminiKey(), call: callGeminiWithTools, name: 'Gemini' },
      { key: getOpenRouterKey(), call: callOpenRouterWithTools, name: 'OpenRouter' },
      { key: getOpenAIKey(), call: callOpenAIWithTools, name: 'OpenAI' },
    ]
    let answer: string | null = null
    const isError = (s: string | null) => s && (s.startsWith('Rate limit') || s.startsWith('API error') || s.startsWith('AI is temporarily unavailable') || s.startsWith('This model is currently experiencing') || s.startsWith('Failed to call') || s.startsWith('Insufficient credits') || s.startsWith('You exceeded your current quota') || s.startsWith('Resource has been exhausted'))

    for (const p of providers) {
      if (!p.key) continue
      try {
        answer = await p.call(messages, user.id, bookId)
        if (isError(answer)) { answer = null; continue }
        break
      } catch (err) {
        console.error(`[ask-ai ${p.name}]`, err)
      }
    }

    if (!answer) {
      answer = buildFallbackAnswer(question, allPages)
    }

    return NextResponse.json({ answer })
  } catch (err) {
    console.error('[ask-ai POST]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
