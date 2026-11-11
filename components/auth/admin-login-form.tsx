'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, ApiClientError } from '@/lib/api/client'
import type { LoginResponse } from '@/lib/api/types'
import { adminLoginSchema, safeNextPath } from '@/lib/validation/auth'

export function AdminLoginForm({ next }: { next?: string }) {
  const router = useRouter()
  const form = useForm<z.input<typeof adminLoginSchema>, unknown, z.output<typeof adminLoginSchema>>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { adminId: '', password: '', totp: '' },
  })

  async function submit(values: z.output<typeof adminLoginSchema>) {
    try {
      const result = await api<LoginResponse>('/api/admin/auth/login', { method: 'POST', body: values, session: 'admin' })
      toast.success('Welcome back')
      router.replace(safeNextPath(next, result.redirectTo))
      router.refresh()
    } catch (error) {
      form.setValue('totp', '')
      toast.error(error instanceof ApiClientError ? error.message : 'Could not log in.')
    }
  }

  const { errors, isSubmitting } = form.formState
  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate>
      <div className="field">
        <label htmlFor="adminId">Admin ID</label>
        <input id="adminId" autoComplete="username" aria-invalid={Boolean(errors.adminId)} {...form.register('adminId')} />
        {errors.adminId ? <span className="field-error">{errors.adminId.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} {...form.register('password')} />
        {errors.password ? <span className="field-error">{errors.password.message}</span> : null}
      </div>
      <div className="field">
        <label htmlFor="totp">Authenticator code</label>
        <input id="totp" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="------" aria-invalid={Boolean(errors.totp)} {...form.register('totp')} />
        {errors.totp ? <span className="field-error">{errors.totp.message}</span> : null}
      </div>
      <Button type="submit" className="lime-button auth-submit" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Log in to admin
      </Button>
    </form>
  )
}
