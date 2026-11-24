import { z } from 'zod'

// Member queries to their trainer (diet, workout split, plan change ...).

export const QUERY_TOPICS = ['DIET', 'WORKOUT', 'PLAN', 'PT', 'OTHER'] as const

export const queryCreateSchema = z.object({
  topic: z.enum(QUERY_TOPICS),
  body: z.string().trim().min(3, 'Write a few words').max(1000, 'Keep it under 1000 characters'),
  // Picked trainer; null = any trainer; missing = my own trainer.
  trainerId: z.string().min(10).max(40).nullable().optional(),
})
export type QueryCreateInput = z.input<typeof queryCreateSchema>

export const queryMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(1000, 'Keep it under 1000 characters'),
})

export const queryReplySchema = z.object({
  body: z.string().trim().max(1000, 'Keep it under 1000 characters').default(''),
  // Close the query after replying (done), or just answer and keep it open.
  close: z.boolean().default(false),
})
export type QueryReplyInput = z.input<typeof queryReplySchema>
