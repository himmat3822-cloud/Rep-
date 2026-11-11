import { z } from 'zod'

const id = z.string().min(1).max(40)

export const scanSchema = z.object({ token: z.string().trim().min(10).max(200), branchId: id.optional() })
export const manualCheckinSchema = z.object({ athleteId: id, branchId: id.optional() })
export const checkoutSchema = z.object({ checkInId: id })
export const todayQuerySchema = z.object({ branchId: id.optional() })

export const registerSchema = z.object({
  branchId: id,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  entries: z.array(z.object({ athleteId: id, hour: z.coerce.number().int().min(4).max(23) })).min(1, 'Tick at least one member').max(1000),
})

export const attendanceSettingsSchema = z
  .object({
    deskQr: z.boolean(),
    selfCheckin: z.boolean(),
    biometric: z.boolean(),
    manual: z.boolean(),
    selfRequireEntranceQr: z.boolean(),
    selfRequireLocation: z.boolean(),
    manualAllowWithoutPlan: z.boolean(),
  })
  .refine((value) => value.deskQr || value.selfCheckin || value.biometric || value.manual, { message: 'Keep at least one way to mark attendance', path: ['manual'] })
  .refine((value) => !value.selfCheckin || value.selfRequireEntranceQr || value.selfRequireLocation, { message: 'Self check-in needs the entrance QR, the location check, or both', path: ['selfRequireLocation'] })

export const deviceSchema = z.object({
  name: z.string().trim().min(2).max(60),
  branchId: id,
  kind: z.enum(['API', 'ADMS']),
  vendor: z.string().trim().max(40).default(''),
  serialNumber: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/, 'Serial number from the device (Menu > System info)').optional()),
  allowedIps: z.array(z.string().trim().regex(/^[0-9a-fA-F:.]{3,45}$/)).max(10).default([]),
  active: z.boolean().default(true),
})

export const selfCheckinSchema = z.object({
  branchId: id,
  sig: z.string().max(40).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).max(10000).optional(),
})

export const punchesSchema = z.object({
  punches: z
    .array(
      z.object({
        userId: z.string().trim().min(1).max(40),
        timestamp: z.string().trim().min(10).max(40),
        direction: z.enum(['in', 'out']).default('in'),
      }),
    )
    .min(1)
    .max(500),
})
