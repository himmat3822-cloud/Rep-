'use client'

import { FEATURES, isComingSoon } from '@/lib/features'

const SOON_CHIP = (label: string) => (
  <span key={label} className="feature-chip soon" title="Not built yet. Cannot be switched on.">
    <input type="checkbox" disabled checked={false} readOnly tabIndex={-1} />
    {label}
    <small style={{ marginLeft: 'auto' }}>Coming soon</small>
  </span>
)

// Checkbox grid for feature flags. In "override" mode each feature cycles
// through: plan default -> force on -> force off.

export function FeaturePicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="feature-grid">
      {FEATURES.map((feature) => {
        if (isComingSoon(feature.key)) return SOON_CHIP(feature.label)
        const on = value.includes(feature.key)
        return (
          <label key={feature.key} className={`feature-chip ${on ? 'on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((key) => key !== feature.key) : [...value, feature.key])} />
            {feature.label}
          </label>
        )
      })}
    </div>
  )
}

export function OverridePicker({ planFeatures, extra, removed, onChange }: { planFeatures: string[]; extra: string[]; removed: string[]; onChange: (next: { extra: string[]; removed: string[] }) => void }) {
  function cycle(key: string) {
    const inPlan = planFeatures.includes(key)
    if (extra.includes(key)) {
      onChange({ extra: extra.filter((item) => item !== key), removed: inPlan ? [...removed, key] : removed })
    } else if (removed.includes(key)) {
      onChange({ extra, removed: removed.filter((item) => item !== key) })
    } else if (inPlan) {
      onChange({ extra, removed: [...removed, key] })
    } else {
      onChange({ extra: [...extra, key], removed })
    }
  }
  return (
    <div className="feature-grid">
      {FEATURES.map((feature) => {
        if (isComingSoon(feature.key)) return SOON_CHIP(feature.label)
        const inPlan = planFeatures.includes(feature.key)
        const isExtra = extra.includes(feature.key)
        const isRemoved = removed.includes(feature.key)
        const effective = (inPlan || isExtra) && !isRemoved
        const tag = isExtra ? ' (granted)' : isRemoved ? ' (removed)' : inPlan ? ' (plan)' : ''
        return (
          <button type="button" key={feature.key} className={`feature-chip ${isRemoved ? 'off' : effective ? 'on' : ''}`} onClick={() => cycle(feature.key)} title="Click to cycle: plan default, grant, remove">
            <input type="checkbox" readOnly checked={effective} tabIndex={-1} />
            {feature.label}
            <small style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{tag}</small>
          </button>
        )
      })}
    </div>
  )
}
