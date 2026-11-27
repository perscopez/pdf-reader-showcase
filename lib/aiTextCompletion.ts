interface Message { role: string; content: string }

function key(name: string) {
  const value = process.env[name]?.trim()
  return value && !value.startsWith('your_') ? value : ''
}

export async function runAiTextCompletion(messages: Message[]): Promise<string> {
  const gemini = key('GEMINI_API_KEY')
  if (gemini) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gemini}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: messages[0]?.content || '' }] }, contents: [{ role: 'user', parts: [{ text: messages.at(-1)?.content || '' }] }], generationConfig: { maxOutputTokens: 700, temperature: 0.2 } }),
        signal: AbortSignal.timeout(30_000),
      })
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      if (response.ok) return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    } catch { /* Try the next configured provider. */ }
  }

  const providers = [
    ['GROQ_API_KEY', 'https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile'],
    ['OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/chat/completions', 'openai/gpt-4o-mini'],
    ['OPENAI_API_KEY', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'],
  ] as const
  for (const [envName, url, model] of providers) {
    const apiKey = key(envName)
    if (!apiKey) continue
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, max_tokens: 700, temperature: 0.2 }),
        signal: AbortSignal.timeout(30_000),
      })
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      if (response.ok) return data.choices?.[0]?.message?.content || ''
    } catch { /* Try the next configured provider. */ }
  }
  return ''
}
