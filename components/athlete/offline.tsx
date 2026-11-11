'use client'

import { useEffect, useState } from 'react'
import { Dumbbell, QrCode, RotateCw, WifiOff } from 'lucide-react'
import type { WorkoutDay } from '@/lib/athlete/home'

export function OfflineView({ slug, labels }: { slug: string; labels: { title: string; note: string; openQr: string; today: string; retry: string } }) {
  const [workout, setWorkout] = useState<WorkoutDay | null>(null)
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`kasrat-today:${slug}`) ?? 'null') as { savedAt: string; workout: WorkoutDay | null } | null
      if (saved && new Date(saved.savedAt).toDateString() === new Date().toDateString()) setWorkout(saved.workout)
    } catch {
      // nothing saved
    }
  }, [slug])
  return (
    <main className="pay-page">
      <div className="pay-card">
        <div className="join-gift">
          <WifiOff />
        </div>
        <h1>{labels.title}</h1>
        <p className="muted">{labels.note}</p>
        <a className="btn btn-lime btn-block" href={`/g/${slug}/qr`} style={{ marginTop: 16 }}>
          <QrCode /> {labels.openQr}
        </a>
        {workout ? (
          <div className="offline-workout">
            <h3>
              <Dumbbell /> {labels.today}: {workout.title}
            </h3>
            <ol className="ex-list">
              {workout.exercises.map((exercise, index) => (
                <li key={index}>
                  <span>{exercise.name}</span>
                  <strong>
                    {exercise.sets} x {exercise.reps}
                  </strong>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
          <RotateCw /> {labels.retry}
        </button>
      </div>
    </main>
  )
}
