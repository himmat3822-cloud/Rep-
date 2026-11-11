import { z } from 'zod'
import { splitDaySchema } from './athlete'
import { NUDGE_KINDS } from '@/lib/messaging/templates'

const uniqueWeekdays = (days: { weekday: number }[]) => new Set(days.map((d) => d.weekday)).size === days.length

export const trainerSplitSchema = z.object({
  days: z.array(splitDaySchema).max(7).refine(uniqueWeekdays, 'Each weekday can appear only once'),
  dietNotes: z.string().trim().max(2000).default(''),
})
export type TrainerSplitInput = z.input<typeof trainerSplitSchema>
export type TrainerSplitOutput = z.output<typeof trainerSplitSchema>

export const templateSchema = z.object({
  name: z.string().trim().min(2, 'Name the plan').max(60),
  goal: z.string().trim().max(80).default(''),
  days: z.array(splitDaySchema).min(1, 'Add at least one training day').max(7).refine(uniqueWeekdays, 'Each weekday can appear only once'),
  dietNotes: z.string().trim().max(2000).default(''),
})
export type TemplateInput = z.input<typeof templateSchema>
export type TemplateOutput = z.output<typeof templateSchema>

export const applyTemplateSchema = z.object({ athleteIds: z.array(z.string().min(10).max(40)).min(1, 'Pick at least one member').max(200) })

export const trainerNoteSchema = z.object({ body: z.string().trim().min(2, 'Write a note').max(1000) })

export const nudgeSchema = z
  .object({ kind: z.enum([...NUDGE_KINDS, 'custom']), text: z.string().trim().max(160).optional() })
  .refine((value) => value.kind !== 'custom' || (value.text ?? '').length >= 3, { message: 'Write a short message', path: ['text'] })
  .refine((value) => !/[\r\n\t]/.test(value.text ?? ''), { message: 'Keep it to one line', path: ['text'] })

export const ptLogSchema = z.object({
  athleteId: z.string().min(10).max(40),
  sessionAt: z.coerce.date(),
  durationMin: z.coerce.number().int().min(15).max(180).default(60),
  notes: z.string().trim().max(500).default(''),
})
export type PtLogInput = z.input<typeof ptLogSchema>
export type PtLogOutput = z.output<typeof ptLogSchema>

export const ptAnswerSchema = z.object({ action: z.enum(['sign', 'dispute']), note: z.string().trim().max(200).optional() })

export const assignTrainerSchema = z.object({ athleteIds: z.array(z.string().min(10).max(40)).min(1).max(500), trainerId: z.string().min(10).max(40).nullable() })
