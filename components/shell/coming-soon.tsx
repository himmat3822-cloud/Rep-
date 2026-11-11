import { Sparkles } from 'lucide-react'

// Empty state for areas whose screens ship in a later phase.
export function ComingSoon({ title, text, items }: { title: string; text: string; items: string[] }) {
  return (
    <section className="panel empty-panel">
      <div className="round-icon">
        <Sparkles />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <ul className="empty-list">
        {items.map((item) => (
          <li key={item}>
            <span />
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
