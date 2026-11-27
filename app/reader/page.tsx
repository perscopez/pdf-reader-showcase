'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ReaderPageContent from '@/components/ReaderPageContent'

function ReaderQueryParamsWrapper() {
  const searchParams = useSearchParams()
  const id = searchParams ? searchParams.get('id') || '' : ''
  return <ReaderPageContent id={id} />
}

export default function ReaderStaticPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400 bg-[#050312]">Loading...</div>}>
      <ReaderQueryParamsWrapper />
    </Suspense>
  )
}
