import Link from 'next/link'

const TABS = [
  { href: '/owner/settings', label: 'Gym profile' },
  { href: '/owner/settings/app', label: 'App settings' },
  { href: '/owner/settings/attendance', label: 'Attendance' },
  { href: '/owner/settings/reminders', label: 'Reminders' },
  { href: '/owner/settings/branches', label: 'Branches and hours' },
  { href: '/owner/settings/staff', label: 'Staff and permissions' },
]

export function SettingsTabs({ active }: { active: string }) {
  return (
    <div className="tab-links">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={tab.href === active ? 'active' : ''}>
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
