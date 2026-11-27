'use client'

import { useParams } from 'next/navigation'
import ReaderPageContent from '@/components/ReaderPageContent'

export default function ReaderPage() {
  const { id } = useParams()
  return <ReaderPageContent id={String(id)} />
}
