// Always-running background behind every dashboard and the member app: a
// gym floor grid moving like a treadmill belt (same loop as the landing hero),
// dumbbells doing reps, weight plates spinning, kettlebells swinging, a
// barbell rolling across, and a heart-rate line along the bottom. Pure SVG +
// CSS transforms (cheap on phones), drawn in line art at low opacity so it
// never competes with the data. Paused under prefers-reduced-motion.

type Item = { shape: 'dumbbell' | 'plate' | 'kettlebell' | 'barbell'; x: string; y: string; size: number; motion: 'rep' | 'spin' | 'swing' | 'roll' | 'drift'; dur: number; delay: number; tilt?: number }

const STAFF: Item[] = [
  { shape: 'dumbbell', x: '78%', y: '16%', size: 120, motion: 'rep', dur: 3.6, delay: 0, tilt: -18 },
  { shape: 'plate', x: '90%', y: '58%', size: 150, motion: 'spin', dur: 38, delay: 0 },
  { shape: 'kettlebell', x: '58%', y: '74%', size: 84, motion: 'swing', dur: 4.2, delay: -1 },
  { shape: 'barbell', x: '0%', y: '86%', size: 300, motion: 'roll', dur: 46, delay: -12 },
  { shape: 'plate', x: '30%', y: '12%', size: 70, motion: 'spin', dur: 26, delay: -6 },
  { shape: 'dumbbell', x: '18%', y: '58%', size: 90, motion: 'rep', dur: 4.4, delay: -2, tilt: 24 },
  { shape: 'kettlebell', x: '92%', y: '30%', size: 60, motion: 'drift', dur: 14, delay: -4 },
  { shape: 'plate', x: '46%', y: '40%', size: 46, motion: 'drift', dur: 18, delay: -9 },
]

const MEMBER: Item[] = [
  { shape: 'dumbbell', x: '70%', y: '10%', size: 96, motion: 'rep', dur: 3.6, delay: 0, tilt: -20 },
  { shape: 'plate', x: '88%', y: '46%', size: 120, motion: 'spin', dur: 34, delay: 0 },
  { shape: 'kettlebell', x: '6%', y: '64%', size: 70, motion: 'swing', dur: 4.2, delay: -1 },
  { shape: 'barbell', x: '0%', y: '82%', size: 240, motion: 'roll', dur: 40, delay: -8 },
  { shape: 'plate', x: '10%', y: '24%', size: 54, motion: 'drift', dur: 16, delay: -5 },
]

function Shape({ shape }: { shape: Item['shape'] }) {
  switch (shape) {
    case 'dumbbell':
      return (
        <svg viewBox="0 0 120 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
          <rect x="4" y="12" width="10" height="24" rx="3" />
          <rect x="14" y="6" width="12" height="36" rx="3" />
          <rect x="94" y="6" width="12" height="36" rx="3" />
          <rect x="106" y="12" width="10" height="24" rx="3" />
          <path d="M26 24h68" strokeWidth="4" strokeLinecap="round" />
          <path d="M44 20v8M52 20v8M60 20v8M68 20v8M76 20v8" strokeWidth="1.4" opacity=".7" />
        </svg>
      )
    case 'plate':
      return (
        <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="50" cy="50" r="46" />
          <circle cx="50" cy="50" r="38" strokeDasharray="3 5" />
          <circle cx="50" cy="50" r="22" />
          <circle cx="50" cy="50" r="7" strokeWidth="3" />
          <path d="M50 4v10M50 86v10M4 50h10M86 50h10" />
          <path d="M26 30l6 5M74 70l-6-5" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )
    case 'kettlebell':
      return (
        <svg viewBox="0 0 80 96" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
          <path d="M24 34c-4-10-2-26 16-26s20 16 16 26" />
          <path d="M30 34c-2-8 0-16 10-16s12 8 10 16" />
          <path d="M18 40c-10 8-12 24-6 36 4 8 10 12 28 12s24-4 28-12c6-12 4-28-6-36-6-5-14-7-22-7s-16 2-22 7z" />
          <path d="M28 70h24" strokeWidth="1.6" opacity=".7" />
        </svg>
      )
    case 'barbell':
      return (
        <svg viewBox="0 0 300 70" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
          <path d="M2 35h296" strokeWidth="3.5" strokeLinecap="round" />
          <rect x="30" y="4" width="14" height="62" rx="4" />
          <rect x="46" y="12" width="10" height="46" rx="3" />
          <rect x="58" y="22" width="6" height="26" rx="2" />
          <rect x="236" y="22" width="6" height="26" rx="2" />
          <rect x="244" y="12" width="10" height="46" rx="3" />
          <rect x="256" y="4" width="14" height="62" rx="4" />
        </svg>
      )
  }
}

export function GymBackdrop({ variant = 'staff' }: { variant?: 'staff' | 'member' }) {
  const items = variant === 'member' ? MEMBER : STAFF
  return (
    <div className={`k-gym k-gym-${variant}`} aria-hidden="true">
      {/* Gym floor: a grid in perspective running like a treadmill belt. */}
      <div className="k-floor" />
      <div className="k-horizon" />
      {items.map((item, i) => (
        <span
          key={i}
          className={`k-gym-item k-${item.motion}`}
          style={{
            left: item.x,
            top: item.y,
            width: item.size,
            ['--dur' as string]: `${item.dur}s`,
            ['--delay' as string]: `${item.delay}s`,
            ['--tilt' as string]: `${item.tilt ?? 0}deg`,
          }}
        >
          <Shape shape={item.shape} />
        </span>
      ))}
      {/* Heart-rate line across the bottom, beating continuously. */}
      <svg className="k-gym-pulse" viewBox="0 0 1200 80" preserveAspectRatio="none" fill="none">
        <path d="M0 50h180l18-30 22 56 20-44 14 18h160l14-22 18 40 16-34 12 16h170l20-36 24 64 22-50 14 22h170l16-26 20 46 18-38 12 18h150" />
      </svg>
    </div>
  )
}
