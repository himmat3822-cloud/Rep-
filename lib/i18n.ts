import en from '@/locales/en.json'
import hi from '@/locales/hi.json'
import pa from '@/locales/pa.json'

// Translation helper. Hindi and Punjabi strings live only in /locales/*.json.
// {placeholders} are interpolated; {label} is the gym's name for its
// customers ("Athlete" by default, renamable per gym).

export type Lang = 'EN' | 'HI' | 'PA'
type Dictionary = typeof en

const DICTIONARIES: Record<Lang, Dictionary> = { EN: en, HI: hi as Dictionary, PA: pa as Dictionary }

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'EN', label: 'English' },
  { code: 'HI', label: 'Hindi' },
  { code: 'PA', label: 'Punjabi' },
]

type Section = Exclude<keyof Dictionary, 'motivation' | 'motivationAvoid'>

export function translate<S extends Section>(lang: Lang, section: S, key: keyof Dictionary[S] & string, vars: Record<string, string | number> = {}): string {
  const dictionary = DICTIONARIES[lang] ?? en
  const table = dictionary[section] as Record<string, string>
  const fallback = en[section] as Record<string, string>
  const template = table[key] ?? fallback[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function translator(lang: Lang, defaults: Record<string, string | number> = {}) {
  return <S extends Section>(section: S, key: keyof Dictionary[S] & string, vars: Record<string, string | number> = {}) => translate(lang, section, key, { ...defaults, ...vars })
}

// Static fallback motivation line, stable for a given athlete and day.
export function fallbackMotivation(lang: Lang, seed: string): string {
  const lines = (DICTIONARIES[lang] ?? en).motivation
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return lines[hash % lines.length]
}

export function motivationLines(lang: Lang): string[] {
  return (DICTIONARIES[lang] ?? en).motivation
}

// Words a motivation line must never contain (body shaming, insults),
// in English plus the language of the line.
export function motivationAvoidList(lang: Lang): string[] {
  return [...en.motivationAvoid, ...(lang === 'EN' ? [] : (DICTIONARIES[lang] ?? en).motivationAvoid)]
}
