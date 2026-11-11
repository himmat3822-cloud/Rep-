// Rep+ brand. The mark is a plus sign whose cross-bar is a dumbbell:
// one more rep, one more member. Lime tile, ink symbol, works at 16 px.

export function BrandMark({ size = 34, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`brand-svg ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="17" fill="#d5f36a" />
      <rect x="27.5" y="12" width="9" height="40" rx="4.5" fill="#18211e" />
      <rect x="15" y="27.5" width="34" height="9" rx="4.5" fill="#18211e" />
      <rect x="8" y="21" width="8" height="22" rx="3" fill="#18211e" />
      <rect x="48" y="21" width="8" height="22" rx="3" fill="#18211e" />
    </svg>
  )
}

export function Brand({ className = '' }: { className?: string }) {
  return (
    <div className={`brand ${className}`} aria-label="Rep+">
      <BrandMark />
      <span className="brand-word" aria-hidden="true">
        REP<span className="brand-plus">+</span>
      </span>
    </div>
  )
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
