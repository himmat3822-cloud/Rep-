import en from '@/locales/en.json'
import hi from '@/locales/hi.json'
import pa from '@/locales/pa.json'

// WhatsApp template catalog. The body text for each language lives in
// /locales/*.json under "wa" (Hindi and Punjabi stay out of .ts files).
// The same text is what you submit to Meta for approval - run
// `pnpm wa:templates` to print the submission JSON.

export type WaLang = 'EN' | 'HI' | 'PA'

// critical  - always sent, never blocked by quota or quiet hours (OTP)
// normal    - blocked at 100% of the monthly quota
// low       - blocked at 90%, so nice-to-have messages never eat the
//             quota that dues reminders need
export type MessagePriority = 'critical' | 'normal' | 'low'

export interface TemplateDef {
  name: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  audience: 'member' | 'owner'
  priority: MessagePriority
  params: string[]
  example: string[]
  // Rep+'s own platform messages do not count against the gym's quota.
  platform?: boolean
  label: string
}

export const TEMPLATES = {
  kasrat_due_soft: {
    name: 'kasrat_due_soft',
    category: 'UTILITY',
    audience: 'member',
    priority: 'normal',
    params: ['member first name', 'gym name', 'amount', 'due date', 'note', 'pay link'],
    example: ['Arjun', 'Forge Fitness', 'Rs 1,500', '12 Nov', 'Renew on time and keep the momentum going.', 'https://kasrat.app/p/abc'],
    label: 'Soft reminder (before due date)',
  },
  kasrat_due_today: {
    name: 'kasrat_due_today',
    category: 'UTILITY',
    audience: 'member',
    priority: 'normal',
    params: ['member first name', 'gym name', 'amount', 'due date', 'note', 'pay link'],
    example: ['Arjun', 'Forge Fitness', 'Rs 1,500', '12 Nov', 'Pay today so your training continues without a break.', 'https://kasrat.app/p/abc'],
    label: 'Friendly reminder (on due date)',
  },
  kasrat_due_followup: {
    name: 'kasrat_due_followup',
    category: 'UTILITY',
    audience: 'member',
    priority: 'normal',
    params: ['member first name', 'gym name', 'amount', 'due date', 'note', 'pay link'],
    example: ['Arjun', 'Forge Fitness', 'Rs 1,500', '12 Nov', 'If anything is wrong, just reply or talk to us at the desk.', 'https://kasrat.app/p/abc'],
    label: 'Gentle follow-up (after due date)',
  },
  kasrat_due_owner_alert: {
    name: 'kasrat_due_owner_alert',
    category: 'UTILITY',
    audience: 'owner',
    priority: 'normal',
    params: ['owner first name', 'member name', 'member code', 'amount', 'days late', 'dues link'],
    example: ['Gurpreet', 'Arjun Mehta', 'FF1001', 'Rs 1,500', '5', 'https://kasrat.app/owner/payments?tab=dues'],
    label: 'Owner alert (call the member)',
  },
  kasrat_renewal_reminder: {
    name: 'kasrat_renewal_reminder',
    category: 'UTILITY',
    audience: 'member',
    priority: 'normal',
    params: ['member first name', 'gym name', 'plan name', 'end date', 'days left', 'app link'],
    example: ['Arjun', 'Forge Fitness', 'Quarterly', '18 Nov', '7', 'https://kasrat.app/g/forge-fitness'],
    label: 'Plan ending soon',
  },
  kasrat_slot_reminder: {
    name: 'kasrat_slot_reminder',
    category: 'UTILITY',
    audience: 'member',
    priority: 'normal',
    params: ['member first name', 'when', 'gym / branch'],
    example: ['Arjun', 'today at 6 PM', 'Forge Fitness, Phase 7'],
    label: 'Slot reminder',
  },
  kasrat_birthday: {
    name: 'kasrat_birthday',
    category: 'MARKETING',
    audience: 'member',
    priority: 'low',
    params: ['member first name', 'gym name'],
    example: ['Arjun', 'Forge Fitness'],
    label: 'Birthday wish',
  },
  kasrat_anniversary: {
    name: 'kasrat_anniversary',
    category: 'MARKETING',
    audience: 'member',
    priority: 'low',
    params: ['member first name', 'years', 'gym name', 'total workouts'],
    example: ['Arjun', '1', 'Forge Fitness', '182'],
    label: 'Membership anniversary',
  },
  kasrat_weekly_report: {
    name: 'kasrat_weekly_report',
    category: 'UTILITY',
    audience: 'member',
    priority: 'low',
    params: ['member first name', 'days trained', 'streak', 'favourite time', 'progress line', 'gym name'],
    example: ['Arjun', '4', '9', '6 PM', 'Body weight -1.2 kg in 4 weeks.', 'Forge Fitness'],
    label: 'Weekly report card',
  },
  kasrat_trainer_nudge: {
    name: 'kasrat_trainer_nudge',
    category: 'MARKETING',
    audience: 'member',
    priority: 'low',
    params: ['member first name', 'trainer first name', 'message', 'gym name'],
    example: ['Arjun', 'Vikram', 'We have not seen you for 6 days. Your spot on the floor is waiting.', 'Forge Fitness'],
    label: 'Trainer nudge',
  },
  kasrat_quota_warning: {
    name: 'kasrat_quota_warning',
    category: 'UTILITY',
    audience: 'owner',
    priority: 'critical',
    params: ['owner first name', 'percent used', 'messages used', 'monthly quota'],
    example: ['Gurpreet', '80', '1600', '2000'],
    platform: true,
    label: 'WhatsApp quota warning (from Rep+)',
  },
} as const satisfies Record<string, TemplateDef>

export type TemplateName = keyof typeof TEMPLATES

export const DUE_MEMBER_TEMPLATES = ['kasrat_due_soft', 'kasrat_due_today', 'kasrat_due_followup'] as const
export const DUE_OWNER_TEMPLATE = 'kasrat_due_owner_alert'
export const DUE_STAGE_TEMPLATES = [...DUE_MEMBER_TEMPLATES, DUE_OWNER_TEMPLATE] as const
export type DueStageTemplate = (typeof DUE_STAGE_TEMPLATES)[number]

type WaTable = Record<TemplateName, string>
const BODIES: Record<WaLang, WaTable> = { EN: en.wa as WaTable, HI: (hi as typeof en).wa as WaTable, PA: (pa as typeof en).wa as WaTable }
const NOTES: Record<WaLang, Record<string, string>> = { EN: en.waNote, HI: (hi as typeof en).waNote, PA: (pa as typeof en).waNote }
const TEXTS: Record<WaLang, Record<string, string>> = { EN: en.waText, HI: (hi as typeof en).waText, PA: (pa as typeof en).waText }

export function isTemplateName(value: string): value is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, value)
}

export function templateBody(name: TemplateName, lang: WaLang): string {
  return BODIES[lang]?.[name] ?? BODIES.EN[name]
}

// WhatsApp rejects template parameters with new lines, tabs or more than
// four spaces in a row, and empty parameters. Clean everything we send.
export function cleanParam(value: string, max = 300): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max)
  return cleaned.length ? cleaned : '-'
}

export function renderTemplate(name: TemplateName, lang: WaLang, params: string[]): string {
  return templateBody(name, lang).replace(/\{\{(\d+)\}\}/g, (match, index: string) => params[Number(index) - 1] ?? match)
}

// The {{5}} note in dues reminders: the owner's own text for the stage,
// else the default line for the gym's tone in the member's language.
export function dueNote(template: DueStageTemplate, lang: WaLang, tone: 'friendly' | 'firm', customText?: string | null): string {
  if (customText && customText.trim()) return cleanParam(customText, 160)
  const kind = template === 'kasrat_due_soft' ? 'soft' : template === 'kasrat_due_today' ? 'today' : 'followup'
  const table = NOTES[lang] ?? NOTES.EN
  return table[`${tone}_${kind}`] ?? NOTES.EN[`${tone}_${kind}`]
}

export function waText(lang: WaLang, key: 'todayAt' | 'tomorrowAt' | 'noFavourite' | 'progressWeight' | 'progressSteady' | 'progressNone', vars: Record<string, string> = {}): string {
  const template = (TEXTS[lang] ?? TEXTS.EN)[key] ?? TEXTS.EN[key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match)
}

// Body for Meta's template creation API, one entry per language.
export function metaTemplateDefinitions() {
  const languages: { lang: WaLang; code: string }[] = [
    { lang: 'EN', code: 'en' },
    { lang: 'HI', code: 'hi' },
    { lang: 'PA', code: 'pa' },
  ]
  return Object.values(TEMPLATES).flatMap((template) =>
    languages.map(({ lang, code }) => ({
      name: template.name,
      language: code,
      category: template.category,
      components: [
        {
          type: 'BODY',
          text: templateBody(template.name, lang),
          example: { body_text: [template.example] },
        },
      ],
    })),
  )
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

const NUDGES: Record<WaLang, Record<string, string>> = { EN: en.waNudge, HI: (hi as typeof en).waNudge, PA: (pa as typeof en).waNudge }
export const NUDGE_KINDS = ['missed', 'streak', 'plan', 'pt', 'comeback'] as const
export type NudgeKind = (typeof NUDGE_KINDS)[number]

export function nudgeLine(lang: WaLang, kind: NudgeKind, days: number): string {
  const template = (NUDGES[lang] ?? NUDGES.EN)[kind] ?? NUDGES.EN[kind]
  return template.replace('{days}', String(days))
}
