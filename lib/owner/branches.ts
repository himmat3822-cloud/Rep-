import type { z } from 'zod'
import type { branchSchema } from '@/lib/validation/owner'

export function branchData(input: z.output<typeof branchSchema>) {
  return {
    name: input.name,
    address: input.address,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    geofenceMeters: input.geofenceMeters,
    hourlyCapacity: input.hourlyCapacity,
    slotMinutes: input.slotMinutes,
    openingHours: input.openingHours,
    holidays: input.holidays.map((day) => new Date(`${day}T00:00:00Z`)),
    archived: input.archived,
  }
}
