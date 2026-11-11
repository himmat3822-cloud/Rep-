import type { Metadata } from 'next'
import Link from 'next/link'
import { Award, Crown, EyeOff, Flame, Lock, Trophy } from 'lucide-react'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { BodyLog, Heatmap, PhotoGallery, RecordsPanel, WeightChart } from '@/components/athlete/progress'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { translator } from '@/lib/i18n'
import { afterCheckIn, loadBadgeRules } from '@/lib/athlete/badge-rules'
import { attendanceHeatmap, leaderboard, monthSummary } from '@/lib/athlete/progress'
import { cloudinaryConfigured, privateImageUrl } from '@/lib/integrations/cloudinary'
import { formatIstDate, istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'Progress - Rep+' }

const TABS = ['overview', 'body', 'photos', 'records', 'ranks'] as const
type Tab = (typeof TABS)[number]
const TAB_KEY = { overview: 'tabOverview', body: 'tabBody', photos: 'tabPhotos', records: 'tabRecords', ranks: 'tabRanks' } as const

export default async function ProgressPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params
  const requested = (await searchParams).tab
  const tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : 'overview'
  const { athlete, gym } = await requireAthletePage(slug)
  const db = tenantDb(gym.id)
  const t = translator(athlete.language)
  const features = await getGymFeatures(gym.id)
  const tracking = features.includes('progress_tracking')
  const base = `/g/${slug}/progress`
  const date = (value: Date) => formatIstDate(value, { day: 'numeric', month: 'short' })

  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <div className="a-page">
        <div className="a-head">
          <h1>{t('prog', 'title')}</h1>
        </div>
        <nav className="a-tabs">
          {TABS.filter((key) => tracking || key === 'overview' || key === 'ranks').map((key) => (
            <Link key={key} href={key === 'overview' ? base : `${base}?tab=${key}`} className={tab === key ? 'on' : ''}>
              {t('prog', TAB_KEY[key])}
            </Link>
          ))}
        </nav>
        {tab === 'overview' ? await Overview() : null}
        {tab === 'body' && tracking ? await Body() : null}
        {tab === 'photos' && tracking ? await Photos() : null}
        {tab === 'records' && tracking ? await Records() : null}
        {tab === 'ranks' ? await Ranks() : null}
      </div>
    </AthleteChrome>
  )

  async function Overview() {
    await afterCheckIn(db, { id: gym.id, slug }, athlete.id)
    const [cells, summary, rules, owned] = await Promise.all([attendanceHeatmap(db, athlete.id), monthSummary(db, athlete.id), loadBadgeRules(), db.athleteBadge.findMany({ where: { athleteId: athlete.id } })])
    const earned = new Map(owned.map((b) => [b.badgeKey, b.earnedAt]))
    const total = cells.reduce((sum, cell) => sum + (cell.count ? 1 : 0), 0)
    return (
      <>
        <section className="a-card">
          <div className="row-between">
            <h3>{t('prog', 'heatmap')}</h3>
            <span className="pill">
              {total} {t('prog', 'visits')}
            </span>
          </div>
          <Heatmap cells={cells} />
        </section>
        <section className="a-card">
          <h3>{t('prog', 'monthSummary', { month: summary.month })}</h3>
          <div className="stat-grid">
            <div>
              <strong>{summary.visits}</strong>
              <small>{t('prog', 'visitsMonth')}</small>
            </div>
            <div>
              <strong>
                {summary.bestStreak} <Flame className="inline-icon" />
              </strong>
              <small>{t('prog', 'bestStreak')}</small>
            </div>
            <div>
              <strong>{summary.weightChange === null ? '-' : `${summary.weightChange > 0 ? '+' : ''}${summary.weightChange} kg`}</strong>
              <small>{t('prog', 'weightChange')}</small>
            </div>
            <div>
              <strong>{summary.newRecords}</strong>
              <small>{t('prog', 'newRecords')}</small>
            </div>
          </div>
        </section>
        <section className="a-card">
          <h3>
            <Award /> {t('prog', 'badges')}
          </h3>
          <div className="badge-grid">
            {rules
              .filter((rule) => rule.metric !== 'challenge' || earned.has(rule.key))
              .map((rule) => {
                const at = earned.get(rule.key)
                return (
                  <div key={rule.key} className={`badge-tile ${at ? 'earned' : ''}`}>
                    <span className="badge-icon">{at ? <Trophy /> : <Lock />}</span>
                    <strong>{rule.name}</strong>
                    <small>{rule.description}</small>
                    <em>{at ? t('prog', 'badgeEarned', { date: date(at) }) : t('prog', 'badgeLocked')}</em>
                  </div>
                )
              })}
          </div>
        </section>
      </>
    )
  }

  async function Body() {
    const logs = await db.progressLog.findMany({ where: { athleteId: athlete.id }, orderBy: { loggedOn: 'desc' }, take: 60 })
    const today = logs.find((log) => log.loggedOn.getTime() === istDateOnly().getTime())
    return (
      <>
        <BodyLog slug={slug} lang={athlete.language} today={today ? { weightKg: today.weightKg, chestCm: today.chestCm, waistCm: today.waistCm, hipsCm: today.hipsCm, armsCm: today.armsCm, thighsCm: today.thighsCm, bodyFatPct: today.bodyFatPct } : null} />
        <section className="a-card">
          <h3>{t('prog', 'weightChart')}</h3>
          <WeightChart points={logs.filter((log) => log.weightKg !== null).reverse().map((log) => ({ date: log.loggedOn.toISOString().slice(0, 10), value: log.weightKg! }))} empty={t('prog', 'noData')} />
        </section>
        <section className="a-card">
          <h3>{t('prog', 'history')}</h3>
          {logs.length === 0 ? (
            <p className="muted">{t('prog', 'noData')}</p>
          ) : (
            <div className="table-scroll">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>{t('prog', 'date')}</th>
                    <th>kg</th>
                    <th>{t('prog', 'chest').split(' ')[0]}</th>
                    <th>{t('prog', 'waist').split(' ')[0]}</th>
                    <th>{t('prog', 'arms').split(' ')[0]}</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{date(log.loggedOn)}</td>
                      <td>{log.weightKg ?? '-'}</td>
                      <td>{log.chestCm ?? '-'}</td>
                      <td>{log.waistCm ?? '-'}</td>
                      <td>{log.armsCm ?? '-'}</td>
                      <td>{log.bodyFatPct ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    )
  }

  async function Photos() {
    const photos = await db.progressPhoto.findMany({ where: { athleteId: athlete.id }, orderBy: { takenOn: 'desc' }, take: 120 })
    return (
      <PhotoGallery
        slug={slug}
        lang={athlete.language}
        enabled={cloudinaryConfigured()}
        photos={photos.map((photo) => ({ id: photo.id, pose: photo.pose, takenOn: photo.takenOn.toISOString().slice(0, 10), label: date(photo.takenOn), thumb: privateImageUrl(photo.publicId, 'c_fill,g_auto,w_300,h_400,q_auto,f_auto'), full: privateImageUrl(photo.publicId) }))}
      />
    )
  }

  async function Records() {
    const records = await db.personalRecord.findMany({ where: { athleteId: athlete.id }, orderBy: { achievedOn: 'desc' }, take: 100 })
    return <RecordsPanel slug={slug} lang={athlete.language} records={records.map((r) => ({ id: r.id, exercise: r.exercise, weightKg: r.weightKg, reps: r.reps, achievedOn: r.achievedOn.toISOString().slice(0, 10), label: date(r.achievedOn) }))} />
  }

  async function Ranks() {
    const today = istDateOnly()
    const [board, challenge] = await Promise.all([leaderboard(db, athlete.id), db.challenge.findFirst({ where: { startsAt: { lte: today }, endsAt: { gte: today } }, orderBy: { startsAt: 'desc' } })])
    const entry = challenge ? await db.challengeEntry.findFirst({ where: { challengeId: challenge.id, athleteId: athlete.id } }) : null
    return (
      <>
        {challenge ? (
          <section className="a-card challenge-mini">
            <h3>
              <Trophy /> {t('prog', 'challenge')}: {challenge.title}
            </h3>
            <p className="muted">{challenge.description}</p>
            <div className="slot-bar big">
              <span style={{ width: `${Math.min(100, Math.round(((entry?.progress ?? 0) / challenge.target) * 100))}%` }} />
            </div>
            <strong>{entry?.completedAt ? t('prog', 'challengeDone') : `${Math.min(entry?.progress ?? 0, challenge.target)} / ${challenge.target}`}</strong>
          </section>
        ) : null}
        <section className="a-card">
          <h3>
            <Crown /> {t('prog', 'leaderboard')}
          </h3>
          <p className="hint">{t('prog', 'leaderNote')}</p>
          {board.hidden ? (
            <p className="tip">
              <EyeOff /> {t('prog', 'hidden')}
            </p>
          ) : null}
          {board.rows.length === 0 ? (
            <p className="muted">{t('prog', 'noData')}</p>
          ) : (
            <ol className="leader-list">
              {board.rows.map((row) => (
                <li key={row.athleteId} className={row.me ? 'me' : ''}>
                  <span className={`rank r${row.rank}`}>{row.rank}</span>
                  <span className="who">{row.me ? `${row.name} (${t('prog', 'you')})` : row.name}</span>
                  <span className="score">
                    {t('prog', 'rankWorkouts', { count: row.workouts })}
                    <small>
                      <Flame className="inline-icon" /> {row.streak}
                    </small>
                  </span>
                </li>
              ))}
              {board.me && !board.rows.some((row) => row.me) ? (
                <li className="me gap">
                  <span className="rank">{board.me.rank}</span>
                  <span className="who">
                    {board.me.name} ({t('prog', 'you')})
                  </span>
                  <span className="score">{t('prog', 'rankWorkouts', { count: board.me.workouts })}</span>
                </li>
              ) : null}
            </ol>
          )}
        </section>
      </>
    )
  }
}
