import type { Metadata } from 'next'
import Link from 'next/link'
import { MapPin, PauseCircle, QrCode } from 'lucide-react'
import { tenantDb } from '@/lib/db/tenant'
import { loadGymConfig } from '@/lib/gym/context'
import { enabledMethods } from '@/lib/attendance/methods'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { AthleteHomeView } from '@/components/athlete/athlete-home'
import { SaveToday } from '@/components/athlete/pwa'
import { CoachCards } from '@/components/athlete/coach'
import { formatIstDate } from '@/lib/time'
import { requireAthletePage } from '@/lib/auth/page'
import { getAthleteHome } from '@/lib/athlete/home'
import { translate } from '@/lib/i18n'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return { title: `Home - ${slug} - Rep+` }
}

export default async function AthleteHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym, paused } = await requireAthletePage(slug)

  if (paused) {
    return (
      <AthleteChrome slug={slug} lang={athlete.language}>
        <section className="panel empty-panel paused-card">
          <div className="round-icon">
            <PauseCircle />
          </div>
          <h2>{gym.name}</h2>
          <p>{translate(athlete.language, 'home', 'paused')}</p>
        </section>
      </AthleteChrome>
    )
  }

  const db = tenantDb(gym.id)
  const [data, config, note, sessions, trainer] = await Promise.all([
    getAthleteHome(gym.id, athlete, gym.sessionMinutes),
    loadGymConfig(db, gym.id),
    db.trainerNote.findFirst({ where: { athleteId: athlete.id, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }, orderBy: { createdAt: 'desc' }, include: { trainer: { select: { name: true } } } }),
    db.ptSession.findMany({ where: { athleteId: athlete.id, athleteSignedAt: null, athleteDisputedAt: null }, orderBy: { sessionAt: 'desc' }, take: 10, include: { trainer: { select: { name: true } } } }),
    athlete.trainerId ? db.gymUser.findFirst({ where: { id: athlete.trainerId }, select: { name: true } }) : Promise.resolve(null),
  ])
  const short = (d: Date) => formatIstDate(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const methods = enabledMethods(config.settings.attendance, config.features)
  const lang = athlete.language
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      {methods.deskQr || methods.selfCheckin ? (
        <div className="actions" style={{ marginTop: 12 }}>
          {methods.deskQr ? (
            <Link className="btn btn-dark" href={`/g/${slug}/qr`}>
              <QrCode /> {translate(lang, 'checkin', 'myQr')}
            </Link>
          ) : null}
          {methods.selfCheckin && !methods.selfRequireEntranceQr ? (
            <Link className="btn btn-lime" href={`/g/${slug}/checkin`}>
              <MapPin /> {translate(lang, 'checkin', 'checkIn')}
            </Link>
          ) : null}
        </div>
      ) : null}
      <CoachCards
        slug={slug}
        lang={lang}
        trainer={trainer?.name ?? null}
        note={note ? { body: note.body, by: note.trainer.name.split(' ')[0], date: short(note.createdAt) } : null}
        sessions={sessions.map((s) => ({ id: s.id, trainer: s.trainer.name.split(' ')[0], minutes: s.durationMin, date: short(s.sessionAt) }))}
      />
      <SaveToday slug={slug} workout={data.todayWorkout} />
      <AthleteHomeView slug={slug} data={data} name={athlete.name} lang={athlete.language} athleteLabel={gym.athleteLabel} streak={athlete.streakDays} bestStreak={athlete.bestStreak} />
    </AthleteChrome>
  )
}
