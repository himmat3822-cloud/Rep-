'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ApiClientError } from '@/lib/api/client'

// Runs an API call with a pending flag, a toast for the result and a
// server-component refresh so the page shows fresh data.
export function useAction() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function run<T>(fn: () => Promise<T>, success: string | ((result: T) => string), options: { refresh?: boolean } = {}): Promise<T | null> {
    setPending(true)
    try {
      const result = await fn()
      toast.success(typeof success === 'function' ? success(result) : success)
      if (options.refresh !== false) router.refresh()
      return result
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Something went wrong. Try again.')
      return null
    } finally {
      setPending(false)
    }
  }

  return { pending, run, router }
}
