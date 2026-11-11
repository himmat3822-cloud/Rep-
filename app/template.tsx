import type { ReactNode } from 'react'

// A template remounts on every navigation (a layout does not), so the
// .route-enter entrance animations in app/motion.css replay on each page.
// display: contents keeps it out of the layout.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="route-enter">{children}</div>
}
