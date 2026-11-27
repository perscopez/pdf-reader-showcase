'use client'

import { useEffect, useState } from 'react'
import { Activity, RefreshCw, Trash2, X } from 'lucide-react'
import {
  clearFinishedWorkflowJobs,
  readWorkflowJobs,
  recoverInterruptedWorkflowJobs,
  WORKFLOW_JOBS_EVENT,
  WORKFLOW_RETRY_EVENT,
  upsertWorkflowJob,
  type WorkflowJob,
} from '@/lib/workflowJobs'
import { fetchWithTimeout } from '@/lib/request'
import { LIBRARY_THEME, type LibraryTheme } from '@/lib/libraryTheme'

export const WORKFLOW_IMPORT_COMPLETED_EVENT = 'library-workflow-import-completed'

export default function WorkflowJobCenter({ libraryTheme }: { libraryTheme: LibraryTheme }) {
  const th = LIBRARY_THEME[libraryTheme]
  const [jobs, setJobs] = useState<WorkflowJob[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const refresh = () => setJobs(readWorkflowJobs())
    recoverInterruptedWorkflowJobs()
    const initialRefresh = window.setTimeout(refresh, 0)
    window.addEventListener(WORKFLOW_JOBS_EVENT, refresh)
    return () => {
      window.clearTimeout(initialRefresh)
      window.removeEventListener(WORKFLOW_JOBS_EVENT, refresh)
    }
  }, [])
  const active = jobs.filter(job => job.status === 'running' || job.status === 'queued').length

  async function retry(job: WorkflowJob) {
    if (job.kind !== 'import' || !job.payload) {
      window.dispatchEvent(new CustomEvent(WORKFLOW_RETRY_EVENT, { detail: job }))
      return
    }
    upsertWorkflowJob({ ...job, status: 'running', progress: 15, attempts: job.attempts + 1, message: 'Yeniden deneniyor' })
    try {
      const response = await fetchWithTimeout('/api/books/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.payload),
      }, 180_000)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'İçe aktarma başarısız')
      upsertWorkflowJob({ ...job, status: 'completed', progress: 100, attempts: job.attempts + 1, message: 'Kütüphaneye eklendi.' })
      window.dispatchEvent(new CustomEvent(WORKFLOW_IMPORT_COMPLETED_EVENT))
    } catch (error) {
      upsertWorkflowJob({ ...job, status: 'failed', attempts: job.attempts + 1, message: error instanceof Error ? error.message : 'İçe aktarma başarısız' })
    }
  }

  return <div className="relative shrink-0">
    <button onClick={() => setOpen(value => !value)} className={`relative flex h-9 w-9 items-center justify-center rounded-lg border ${th.languageButton}`} title="İşlem merkezi" aria-label="İşlem merkezi">
      <Activity size={16} />
      {active > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#e50914] px-1 text-[9px] font-black text-white">{active}</span>}
    </button>
    {open && <div className={`fixed inset-x-3 top-16 z-[240] max-h-[70vh] overflow-auto rounded-2xl border p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] ${th.languagePanel}`}>
      <div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-black">İşlem merkezi</p><p className="text-[11px] opacity-60">Yükleme ve içe aktarma işlemleri</p></div><button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10"><X size={15}/></button></div>
      {!jobs.length && <p className={`rounded-xl border p-4 text-center text-xs ${th.cardMuted} ${th.headerBorder}`}>Bekleyen işlem yok.</p>}
      <div className="grid gap-2">{jobs.map(job => <div key={job.id} className={`rounded-xl border p-3 ${th.card}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-bold">{job.title}</p><p className="mt-0.5 text-[10px] uppercase tracking-wider opacity-55">{job.kind === 'upload' ? 'Yükleme' : 'İçe aktarma'} · {job.status}</p></div>{(job.status === 'failed' || job.status === 'paused') && <button onClick={() => void retry(job)} className="rounded-lg p-2 text-[#ffb4aa] hover:bg-white/10" title="Yeniden dene"><RefreshCw size={14}/></button>}</div>
        <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${th.bookProgressBg}`}><div className="h-full rounded-full bg-[var(--lib-accent)] transition-[width]" style={{ width: `${job.progress}%` }}/></div>
        {job.message && <p className="mt-2 text-[10px] opacity-65">{job.message}</p>}
      </div>)}</div>
      {jobs.some(job => job.status === 'completed') && <button onClick={clearFinishedWorkflowJobs} className="mt-3 inline-flex items-center gap-2 text-[11px] opacity-65 hover:opacity-100"><Trash2 size={13}/>Tamamlananları temizle</button>}
    </div>}
  </div>
}
