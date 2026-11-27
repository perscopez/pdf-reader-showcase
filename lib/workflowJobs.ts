export type WorkflowJobStatus = 'queued' | 'running' | 'paused' | 'failed' | 'completed'
export type WorkflowJobKind = 'upload' | 'import'

export type WorkflowJob = {
  id: string
  kind: WorkflowJobKind
  title: string
  status: WorkflowJobStatus
  progress: number
  attempts: number
  message?: string
  payload?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'library-workflow-jobs-v1'
export const WORKFLOW_JOBS_EVENT = 'library-workflow-jobs-changed'
export const WORKFLOW_RETRY_EVENT = 'library-workflow-job-retry'

export function readWorkflowJobs(): WorkflowJob[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 30) : []
  } catch { return [] }
}

function write(jobs: WorkflowJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, 30)))
  } catch {
    // Storage can be unavailable in private mode or when the quota is exhausted.
    // The in-page event still keeps an open job center in sync with the latest read.
  }
  window.dispatchEvent(new CustomEvent(WORKFLOW_JOBS_EVENT))
}

export function upsertWorkflowJob(input: Partial<WorkflowJob> & Pick<WorkflowJob, 'id' | 'kind' | 'title'>) {
  const now = new Date().toISOString()
  const jobs = readWorkflowJobs()
  const index = jobs.findIndex(job => job.id === input.id)
  const current = index >= 0 ? jobs[index] : undefined
  const next: WorkflowJob = {
    id: input.id,
    kind: input.kind,
    title: input.title,
    status: input.status || current?.status || 'queued',
    progress: Math.max(0, Math.min(100, input.progress ?? current?.progress ?? 0)),
    attempts: input.attempts ?? current?.attempts ?? 0,
    message: input.message ?? current?.message,
    payload: input.payload ?? current?.payload,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  }
  if (index >= 0) jobs[index] = next
  else jobs.unshift(next)
  write(jobs)
  return next
}

export function clearFinishedWorkflowJobs() {
  write(readWorkflowJobs().filter(job => job.status !== 'completed'))
}

/** Turn jobs left mid-request by a reload/crash into explicit retryable work. */
export function recoverInterruptedWorkflowJobs() {
  const jobs = readWorkflowJobs()
  let changed = false
  const recovered = jobs.map(job => {
    if (job.status !== 'running') return job
    changed = true
    return {
      ...job,
      status: 'paused' as const,
      message: job.kind === 'upload'
        ? 'Yükleme kesildi. Devam etmek için aynı dosyayı yeniden seçin.'
        : 'İçe aktarma kesildi. Yeniden deneyebilirsiniz.',
      updatedAt: new Date().toISOString(),
    }
  })
  if (changed) write(recovered)
  return recovered
}

export function workflowJobId(kind: WorkflowJobKind, identity: string) {
  let hash = 2166136261
  for (const character of `${kind}:${identity}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${kind}-${(hash >>> 0).toString(36)}`
}
