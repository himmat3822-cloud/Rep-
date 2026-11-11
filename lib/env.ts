// Central env access. Values are read lazily so `next build` works without
// every integration configured. Call requireEnv() at the point of use.

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value : undefined
}

export const isProduction = process.env.NODE_ENV === 'production'

export function appUrl(): string {
  return (optionalEnv('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '')
}

export function rootDomain(): string {
  return optionalEnv('ROOT_DOMAIN') ?? 'kasrat.app'
}

// In development, when WhatsApp is not configured, OTPs are printed to the
// server terminal instead of being sent. Never active in production.
export function devLogOtp(): boolean {
  return !isProduction && optionalEnv('DEV_LOG_OTP') === 'true'
}
