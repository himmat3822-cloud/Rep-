// Feature flags. Each PlatformPlan stores a list of these keys and the admin
// can move any feature between plans (or grant it per gym) without code.
// Features marked `soon` are announced on the pricing page as "Coming soon"
// but can never be switched on, so no gym pays for something that is missing.

export const FEATURES = [
  { key: 'owner_desk_mode', label: 'Owner handles front desk mode' },
  { key: 'qr_attendance', label: 'QR attendance' },
  { key: 'member_records', label: 'Member records' },
  { key: 'membership_plans', label: 'Membership plans' },
  { key: 'gst_billing', label: 'GST billing and invoices' },
  { key: 'upi_payments', label: 'UPI and online payments' },
  { key: 'dues_reminders', label: 'Dues reminders' },
  { key: 'athlete_pwa', label: 'Athlete app (home, QR, pay)' },
  { key: 'slot_booking', label: 'Schedule and slot booking' },
  { key: 'basic_reports', label: 'Basic reports' },
  { key: 'trainer_dashboard', label: 'Trainer dashboard' },
  { key: 'workout_diet_plans', label: 'Workout and diet plans' },
  { key: 'pt_tracking', label: 'PT session tracking' },
  { key: 'crowd_meter', label: 'Live crowd meter' },
  { key: 'peak_hours', label: 'Peak-hour analytics' },
  { key: 'at_risk', label: 'At-risk list' },
  { key: 'leads_crm', label: 'Leads CRM' },
  { key: 'progress_tracking', label: 'Progress tracking' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'badges', label: 'Badges' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'birthday_wishes', label: 'Birthday and anniversary wishes' },
  { key: 'weekly_report_card', label: 'Weekly report cards' },
  { key: 'health_sync', label: 'Health app sync (Health Connect, Apple Health)', soon: true },
  { key: 'multi_branch', label: 'Multi-branch dashboard' },
  { key: 'cross_branch_access', label: 'Cross-branch access' },
  { key: 'ai_insights', label: 'AI insights for the owner' },
  { key: 'custom_branding', label: 'Custom subdomain and branding' },
  { key: 'biometric_integration', label: 'Biometric / turnstile integration' },
  { key: 'expenses_profit', label: 'Expenses and profit view' },
  { key: 'priority_support', label: 'Priority support' },
] as const

export type FeatureKey = (typeof FEATURES)[number]['key']

export const COMING_SOON: ReadonlySet<string> = new Set(FEATURES.filter((feature) => 'soon' in feature && feature.soon).map((feature) => feature.key))

export function isComingSoon(key: string): boolean {
  return COMING_SOON.has(key)
}

const FEATURE_SET: ReadonlySet<string> = new Set(FEATURES.map((feature) => feature.key))

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_SET.has(value)
}

export const SOLO_FEATURES: FeatureKey[] = [
  'owner_desk_mode',
  'qr_attendance',
  'member_records',
  'membership_plans',
  'gst_billing',
  'upi_payments',
  'dues_reminders',
  'athlete_pwa',
  'slot_booking',
  'basic_reports',
]

export const PRO_FEATURES: FeatureKey[] = [
  ...SOLO_FEATURES,
  'trainer_dashboard',
  'workout_diet_plans',
  'pt_tracking',
  'crowd_meter',
  'peak_hours',
  'at_risk',
  'leads_crm',
  'progress_tracking',
  'challenges',
  'badges',
  'leaderboard',
  'referrals',
  'birthday_wishes',
  'weekly_report_card',
]

export const ELITE_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
  'multi_branch',
  'cross_branch_access',
  'ai_insights',
  'custom_branding',
  'biometric_integration',
  'expenses_profit',
  'priority_support',
]

// Effective features = plan features + per-gym extras - per-gym removals.
export function resolveFeatures(planFeatures: readonly string[], extra: readonly string[] = [], removed: readonly string[] = []): FeatureKey[] {
  const result = new Set<FeatureKey>()
  for (const key of [...planFeatures, ...extra]) {
    if (isFeatureKey(key) && !isComingSoon(key)) result.add(key)
  }
  for (const key of removed) {
    if (isFeatureKey(key)) result.delete(key)
  }
  return [...result]
}
