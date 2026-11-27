'use client'

import { useParams } from 'next/navigation'
import ReadingGroupDetail from '@/components/ReadingGroupDetail'

export default function ReadingGroupDetailPage() {
  const params = useParams<{ groupId: string }>()
  return <ReadingGroupDetail groupId={String(params.groupId || '')} />
}
