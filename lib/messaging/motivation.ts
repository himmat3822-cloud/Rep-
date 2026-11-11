import type { PrismaClient } from '@/lib/generated/prisma/client'
import { scopeToGym } from '@/lib/db/tenant-core'
import { groqChat } from '@/lib/integrations/groq'
import { motivationAvoidList, motivationLines, type Lang } from '@/lib/i18n'
import { WEEKDAY_SHORT, istDateOnly, istParts } from '@/lib/time'

// Daily motivation: one line per member per day in their language.
// One Groq call per language per gym, cached in MotivationLine. If Groq is
// down, not configured, or returns something unsafe, the curated static
// lines in /locales are used instead. Tone: energetic, desi, never body
// shaming.

const MAX_LINES_PER_LANGUAGE = 25

const LANGUAGE_PROMPT: Record<Lang, string> = {
  EN: 'English (a few Hinglish words like "chalo" or "josh" are welcome)',
  HI: 'Hindi written in Devanagari script',
  PA: 'Punjabi written in Gurmukhi script',
}

export type LineGenerator = (lang: Lang, count: number, context: { gymName: string; weekday: string }) => Promise<string | null>

export const groqLineGenerator: LineGenerator = (lang, count, context) =>
  groqChat(
    [
      {
        role: 'system',
        content:
          'You write one-line daily gym motivation messages for members of Indian gyms. Rules: energetic, warm, desi flavour; at most 18 words; ' +
          'never mention body weight, body shape, fat, looks, food guilt or dieting; never shame, insult or guilt the reader; no hashtags, no emojis, ' +
          'no quotes from famous people, no links. Output ONLY a JSON array of strings, nothing else.',
      },
      { role: 'user', content: `Write ${count} different lines in ${LANGUAGE_PROMPT[lang]}. The gym is "${context.gymName}". Today is ${context.weekday}.` },
    ],
    { temperature: 0.95, maxTokens: 60 * count + 200 },
  )

// Accepts a JSON array, or one line per row (models sometimes add numbering).
export function parseLines(raw: string | null): string[] {
  if (!raw) return []
  const text = raw.trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string').map((line) => line.trim())
    } catch {
      // fall through to line splitting
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/^"|"$/g, '').trim())
    .filter(Boolean)
}

export function isSafeLine(line: string, lang: Lang): boolean {
  if (line.length < 12 || line.length > 180) return false
  if (/https?:|www\.|#|@/i.test(line)) return false
  const lower = line.toLowerCase()
  return !motivationAvoidList(lang).some((word) => {
    const needle = word.toLowerCase()
    // Whole-word match for Latin words, substring for Indic scripts.
    return /^[a-z ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(lower) : lower.includes(needle)
  })
}

function hash(value: string): number {
  let result = 0
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0
  return result
}

export interface MotivationSummary {
  athletes: number
  created: number
  groq: number
  static: number
}

export async function generateMotivationForGym(base: PrismaClient, gym: { id: string; name: string }, now: Date = new Date(), generate: LineGenerator = groqLineGenerator): Promise<MotivationSummary> {
  const db = scopeToGym(base, gym.id)
  const date = istDateOnly(now)
  const summary: MotivationSummary = { athletes: 0, created: 0, groq: 0, static: 0 }

  const running = await db.membership.findMany({ where: { status: 'ACTIVE', startsAt: { lte: date }, endsAt: { gte: date } }, select: { athleteId: true } })
  const ids = [...new Set(running.map((m) => m.athleteId))]
  if (ids.length === 0) return summary
  const [athletes, existing] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: ids }, archived: false }, select: { id: true, language: true } }),
    db.motivationLine.findMany({ where: { date, athleteId: { in: ids } }, select: { athleteId: true } }),
  ])
  const done = new Set(existing.map((row) => row.athleteId))
  const todo = athletes.filter((athlete) => !done.has(athlete.id))
  summary.athletes = athletes.length
  if (todo.length === 0) return summary

  const weekday = WEEKDAY_SHORT[istParts(now).weekday]
  const rows: { gymId: string; athleteId: string; date: Date; language: Lang; text: string; source: string }[] = []
  for (const lang of ['EN', 'HI', 'PA'] as const) {
    const group = todo.filter((athlete) => athlete.language === lang)
    if (group.length === 0) continue
    const wanted = Math.min(group.length, MAX_LINES_PER_LANGUAGE)
    const generated = [...new Set(parseLines(await generate(lang, wanted, { gymName: gym.name, weekday })).filter((line) => isSafeLine(line, lang)))]
    const fallback = motivationLines(lang)
    const useGroq = generated.length >= Math.min(3, wanted)
    const pool = useGroq ? generated : fallback
    for (const athlete of group) {
      const text = pool[hash(`${athlete.id}:${date.toISOString()}`) % pool.length]
      rows.push({ gymId: gym.id, athleteId: athlete.id, date, language: lang, text, source: useGroq ? 'groq' : 'static' })
      if (useGroq) summary.groq += 1
      else summary.static += 1
    }
  }
  if (rows.length) summary.created = (await db.motivationLine.createMany({ data: rows, skipDuplicates: true })).count
  return summary
}
