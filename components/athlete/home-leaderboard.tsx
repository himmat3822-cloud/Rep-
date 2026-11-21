import Link from 'next/link'
import { ChevronRight, Crown, EyeOff, Flame, Target } from 'lucide-react'
import type { Leaderboard } from '@/lib/athlete/progress'
import { translator, type Lang } from '@/lib/i18n'

// Member home: this month's top 3, my rank and who to chase next.
// Ranked by workout days and streak only (never weight or money).
export function HomeLeaderboard({ slug, lang, board }: { slug: string; lang: Lang; board: Leaderboard }) {
  const t = translator(lang)
  const podium = board.rows.slice(0, 3)
  const me = board.me
  const meInPodium = podium.some((row) => row.me)

  let line: { icon: 'target' | 'crown'; text: string }
  if (board.hidden) line = { icon: 'target', text: t('home', 'lbHidden') }
  else if (!me) line = { icon: 'target', text: t('home', 'lbJoin') }
  else if (me.rank === 1) line = { icon: 'crown', text: t('home', 'lbLeading') }
  else if (board.chase) line = { icon: 'target', text: board.chase.workoutsToPass === 1 ? t('home', 'lbChaseOne', { name: board.chase.name }) : t('home', 'lbChase', { count: board.chase.workoutsToPass, name: board.chase.name }) }
  else line = { icon: 'target', text: t('home', 'lbJoin') }

  return (
    <section className="home-board" aria-label={t('home', 'lbTitle')}>
      <div className="home-board-head">
        <span className="kicker">
          <Crown /> {t('home', 'lbTitle')}
        </span>
        <Link href={`/g/${slug}/progress?tab=ranks`} className="home-board-all">
          {t('home', 'lbAll')} <ChevronRight />
        </Link>
      </div>

      {podium.length > 0 ? (
        <ol className="home-podium">
          {podium.map((row) => (
            <li key={row.athleteId} className={`p${row.rank}${row.me ? ' me' : ''}`}>
              <span className="medal">{row.rank}</span>
              <span className="who">{row.me ? t('prog', 'you') : row.name}</span>
              <span className="score">{t('home', 'lbWorkouts', { count: row.workouts })}</span>
              <span className="streak">
                <Flame /> {row.streak}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="home-board-me">
        {me && !meInPodium && !board.hidden ? (
          <div className="home-board-rank">
            <strong>#{me.rank}</strong>
            <span>{t('home', 'lbYou', { rank: me.rank, total: board.total })}</span>
          </div>
        ) : null}
        <p className={`home-board-line ${line.icon}`}>
          {board.hidden ? <EyeOff /> : line.icon === 'crown' ? <Crown /> : <Target />}
          {line.text}
        </p>
      </div>
    </section>
  )
}
