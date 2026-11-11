import OpenAI from 'openai'
import { optionalEnv } from '@/lib/env'

// Groq (LLaMA 3.3 70B) through the OpenAI SDK with a baseURL override.
// Returns null instead of throwing - every caller has a static fallback.

let client: OpenAI | null = null

export function groqConfigured(): boolean {
  return Boolean(optionalEnv('GROQ_API_KEY'))
}

function groq(): OpenAI | null {
  const apiKey = optionalEnv('GROQ_API_KEY')
  if (!apiKey) return null
  if (!client) client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 20_000, maxRetries: 1 })
  return client
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export async function groqChat(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<string | null> {
  const api = groq()
  if (!api) return null
  try {
    const completion = await api.chat.completions.create({
      model: optionalEnv('GROQ_MODEL') ?? 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature ?? 0.9,
      max_tokens: options.maxTokens ?? 1500,
    })
    return completion.choices[0]?.message?.content ?? null
  } catch (error) {
    console.error('[groq] request failed', error instanceof Error ? error.message : error)
    return null
  }
}
