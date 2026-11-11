import type { NavItem, NavSection } from '@/components/shell/app-shell'
import type { SubscriptionStatus } from '@/lib/api/types'

// Navigation per role. `ready: false` items render as "soon" until their
// phase ships, so nobody clicks into a 404.

const deskTools = (base: string): NavItem[] => [
  { label: 'Check-in', href: `${base}/scanner`, icon: 'scanner', ready: true },
  { label: 'Quick add', href: `${base}/quick-add`, icon: 'quickAdd', ready: true },
  { label: 'Collect payment', href: `${base}/collect`, icon: 'collect', ready: true },
]

export function ownerNav(ownerHandlesDesk: boolean, athleteLabelPlural: string, atRisk: number): NavSection[] {
  const sections: NavSection[] = [
    {
      items: [
        { label: 'Overview', href: '/owner', icon: 'overview', ready: true },
        { label: athleteLabelPlural, href: '/owner/members', icon: 'members', ready: true },
        { label: 'Attendance', href: '/owner/attendance', icon: 'attendance', ready: true },
        { label: 'Payments and dues', href: '/owner/payments', icon: 'payments', ready: true },
        { label: 'Membership plans', href: '/owner/plans', icon: 'dues', ready: true },
        { label: 'WhatsApp and reminders', href: '/owner/messages', icon: 'messages', ready: true },
        { label: 'Trainers and PT', href: '/owner/trainers', icon: 'sessions', ready: true },
        { label: 'At-risk list', href: '/owner/at-risk', icon: 'risk', ready: true, count: atRisk || undefined },
        { label: 'Leads', href: '/owner/leads', icon: 'leads', ready: true },
        { label: 'Reports', href: '/owner/reports', icon: 'reports', ready: true },
      ],
    },
    {
      title: 'ENGAGE',
      items: [
        { label: 'Announcements', href: '/owner/announcements', icon: 'announcements', ready: true },
        { label: 'Challenges', href: '/owner/challenges', icon: 'challenges', ready: true },
        { label: 'Complaints', href: '/owner/complaints', icon: 'complaints', ready: true },
      ],
    },
  ]
  if (ownerHandlesDesk) sections.push({ title: 'FRONT DESK', items: deskTools('/owner/desk') })
  return sections
}

export const ownerBottomNav: NavItem[] = [
  { label: 'Rep+ billing', href: '/owner/billing', icon: 'collect', ready: true },
  { label: 'Settings', href: '/owner/settings', icon: 'settings', ready: true },
]

export function deskNav(athleteLabelPlural = 'Athletes'): NavSection[] {
  return [
    {
      items: [
        { label: 'Today', href: '/desk', icon: 'overview', ready: true },
        ...deskTools('/desk'),
        { label: athleteLabelPlural, href: '/desk/members', icon: 'members', ready: true },
        { label: 'Leads', href: '/desk/leads', icon: 'leads', ready: true },
        { label: 'Complaints', href: '/desk/complaints', icon: 'complaints', ready: true },
      ],
    },
  ]
}

export function trainerNav(athleteLabelPlural: string): NavSection[] {
  return [
    {
      items: [
        { label: 'Today', href: '/trainer', icon: 'overview', ready: true },
        { label: `My ${athleteLabelPlural.toLowerCase()}`, href: '/trainer/athletes', icon: 'members', ready: true },
        { label: 'Workout plans', href: '/trainer/workouts', icon: 'workouts', ready: true },
        { label: 'PT sessions', href: '/trainer/sessions', icon: 'sessions', ready: true },
      ],
    },
  ]
}

export function adminNav(): NavSection[] {
  return [
    {
      items: [
        { label: 'Platform', href: '/admin', icon: 'overview', ready: true },
        { label: 'Gyms', href: '/admin/gyms', icon: 'gyms', ready: true },
        { label: 'Plans and features', href: '/admin/plans', icon: 'payments', ready: true },
        { label: 'Billing', href: '/admin/billing', icon: 'dues', ready: true },
        { label: 'Announcements', href: '/admin/announcements', icon: 'announcements', ready: true },
        { label: 'Audit log', href: '/admin/audit', icon: 'staff', ready: true },
      ],
    },
  ]
}

export function subscriptionBanner(status: SubscriptionStatus, trialEndsAt?: Date | null): { tone: 'warning' | 'trial'; text: string } | null {
  if (status === 'TRIAL') {
    const days = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000)) : null
    return { tone: 'trial', text: days !== null ? `Free trial: ${days} day(s) left. Pick a plan any time from Settings.` : 'You are on a free trial.' }
  }
  if (status === 'PAST_DUE') return { tone: 'warning', text: 'Your Rep+ payment is overdue. Pay within the grace period to avoid read-only mode.' }
  if (status === 'READ_ONLY') return { tone: 'warning', text: 'Rep+ is read-only because the subscription is unpaid. Members see a paused message.' }
  if (status === 'SUSPENDED' || status === 'CANCELLED') return { tone: 'warning', text: 'Rep+ access is suspended. Only the billing page works until payment is made.' }
  return null
}
