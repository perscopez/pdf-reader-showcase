'use client'

import { useEffect, useState, type MutableRefObject } from 'react'

function formatReadingSeconds(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function ReadingSessionLabel({
  paused,
  active,
  secondsRef,
  onTick,
}: {
  paused: boolean
  active: boolean
  secondsRef: MutableRefObject<number>
  onTick?: (seconds: number) => void
}) {
  const [label, setLabel] = useState('0:00')

  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => {
      const next = secondsRef.current + 1
      secondsRef.current = next
      onTick?.(next)
      if (active) {
        setLabel(formatReadingSeconds(next))
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [paused, active, secondsRef, onTick])

  useEffect(() => {
    if (active) {
      setLabel(formatReadingSeconds(secondsRef.current))
    }
  }, [active, secondsRef])

  return <>{label}</>
}
