import type { ReactNode } from 'react'
import { Dumbbell } from 'lucide-react'
import { Brand } from '@/components/brand'

export function AuthHero({ title, accent, text, points, badge }: { title: string; accent: string; text: string; points: string[]; badge?: ReactNode }) {
  return (
    <section className="auth-hero">
      <div className="hero-noise" />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Brand />
        {badge}
      </div>
      <div>
        <h1>
          {title}
          <br />
          <em>{accent}</em>
        </h1>
        <p>{text}</p>
      </div>
      <div className="auth-points">
        {points.map((point) => (
          <span key={point}>{point}</span>
        ))}
      </div>
      <div className="hero-orbit">
        <div className="orbit-ring ring-one" />
        <div className="orbit-ring ring-two" />
        <Dumbbell className="orbit-dumbbell" />
      </div>
    </section>
  )
}
