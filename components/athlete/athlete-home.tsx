import Link from 'next/link'
import { CalendarCheck, CalendarDays, CreditCard, Dumbbell, Flame, Megaphone, Play, Quote, Wallet } from 'lucide-react'
import type { AthleteHome } from '@/lib/athlete/home'
import { translator, type Lang } from '@/lib/i18n'
import { formatInr } from '@/lib/money'
import { formatIstDate, istParts } from '@/lib/time'

function greetingKey(): 'goodMorning' | 'goodAfternoon' | 'goodEvening' {
  const { hour } = istParts()
  if (hour < 12) return 'goodMorning'
  if (hour < 17) return 'goodAfternoon'
  return 'goodEvening'
}

export function AthleteHomeView({ slug, data, name, lang, athleteLabel, streak, bestStreak }: { slug: string; data: AthleteHome; name: string; lang: Lang; athleteLabel: string; streak: number; bestStreak: number }) {
  const base = `/g/${slug}`
  const t = translator(lang, { label: athleteLabel })
  const crowdText = data.crowd.percent < 35 ? t('home', 'crowdQuiet') : data.crowd.percent < 75 ? t('home', 'crowdBusy') : t('home', 'crowdPacked')
  const workout = data.todayWorkout
  const challengeDots = data.challenge ? Array.from({ length: Math.min(7, data.challenge.target) }, (_, index) => index < data.challenge!.progress) : []

  return (
    <div className="member-layout">
      <section className="member-welcome">
        <div className="eyebrow">
          <span className="live-dot" /> {formatIstDate(new Date()).toUpperCase()}
        </div>
        <h1>
          {t('home', greetingKey())},
          <br />
          <em>{name.split(' ')[0]}.</em>
        </h1>
        <div className="streak-chip">
          <Flame /> <strong>{t('home', 'streak', { days: streak })}</strong>
          <span>- {t('home', 'personalBest', { days: bestStreak })}</span>
        </div>
        <div className="motivation-line">
          <Quote />
          <span>{data.motivation}</span>
        </div>
      </section>

      <div className="member-cards">
        <section className="member-card workout-card">
          <div className="card-top">
            <span className="kicker">{t('home', 'todayWorkout')}</span>
            <span className="round-icon">
              <Dumbbell />
            </span>
          </div>
          {workout ? (
            <>
              <h2>{workout.title}</h2>
              <p>{workout.focus}</p>
              <div className="exercise-progress">
                <span style={{ width: '0%' }} />
              </div>
              <div className="card-meta">
                <span>{t('home', 'exercises', { count: workout.exercises.length })}</span>
                <span>{t('home', 'minutes', { count: workout.minutes })}</span>
                <Link href={`${base}/schedule#workout`} className="button-link dark small-button" style={{ marginLeft: 'auto', height: 30 }}>
                  <Play /> {t('home', 'todayWorkout')}
                </Link>
              </div>
              <ul className="exercise-list">
                {workout.exercises.slice(0, 6).map((exercise, index) => (
                  <li key={index}>
                    <span>{exercise.name}</span>
                    <small>
                      {exercise.sets} x {exercise.reps}
                    </small>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2>{data.isRestDay ? t('home', 'restDay') : t('home', 'noSplit')}</h2>
              <p>{data.isRestDay ? t('home', 'restDayNote') : t('home', 'noSplitNote')}</p>
            </>
          )}
          {data.todaySlot ? (
            <Link href={`${base}/schedule`} className="slot-chip">
              <CalendarCheck /> {t('sched', 'booked')}: {data.todaySlot.time}
            </Link>
          ) : null}
        </section>

        <section className="member-card crowd-card">
          <div className="card-top">
            <span className="kicker">{t('home', 'liveCrowd')}</span>
            <span className="status-pill">
              <span className="live-dot" /> {data.crowd.percent}%
            </span>
          </div>
          <div className="crowd-gauge">
            <div className="gauge-ring">
              <strong>{data.crowd.inside}</strong>
              <span>{t('home', 'peopleNow')}</span>
            </div>
          </div>
          <p className="centered">
            {crowdText}
            {data.crowd.bestTime ? ` ${t('home', 'bestTime', { time: data.crowd.bestTime })}` : ''}
          </p>
          <Link href={`${base}/schedule`} className="button-link outline" style={{ width: '100%', justifyContent: 'space-between' }}>
            {t('home', 'bookSlot')} <CalendarDays />
          </Link>
        </section>

        <section className="member-card plan-card">
          <div className="card-top">
            <span className="kicker">{t('home', 'membership')}</span>
            <CreditCard />
          </div>
          {data.membership ? (
            <>
              <h2>{data.membership.planName}</h2>
              <p>{t('home', 'renewalOn', { date: formatIstDate(data.membership.endsAt, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
              <div className="plan-row">
                <strong>{data.duePaise > 0 ? formatInr(data.duePaise) : data.membership.active ? t('home', 'daysLeft', { days: data.membership.daysLeft }) : t('home', 'expired')}</strong>
                <span>{data.duePaise > 0 ? t('home', 'duePrivate', { amount: formatInr(data.duePaise) }) : ''}</span>
              </div>
            </>
          ) : (
            <h2>{t('home', 'noPlan')}</h2>
          )}
          <Link href={`${base}/pay`} className="button-link dark" style={{ width: '100%', justifyContent: 'space-between' }}>
            {t('home', 'viewPlan')} <Wallet />
          </Link>
        </section>

        <section className="member-card challenge-card">
          <span className="kicker">{t('home', 'challenge')}</span>
          {data.challenge ? (
            <>
              <h2>{data.challenge.title}</h2>
              <p>{data.challenge.description}</p>
              <div className="challenge-dots">
                {challengeDots.map((done, index) => (
                  <span key={index} className={done ? 'done' : ''} />
                ))}
              </div>
              <strong>{t('home', 'challengeProgress', { done: Math.min(data.challenge.progress, data.challenge.target), target: data.challenge.target })}</strong>
            </>
          ) : (
            <>
              <h2>{t('home', 'noChallenge')}</h2>
              <p>{t('home', 'noChallengeNote')}</p>
            </>
          )}
        </section>
      </div>

      {data.announcement ? (
        <div className="motivation-line" style={{ marginTop: 18 }}>
          <Megaphone />
          <span>
            <strong>{data.announcement.title}.</strong> {data.announcement.body}
          </span>
        </div>
      ) : null}
    </div>
  )
}
