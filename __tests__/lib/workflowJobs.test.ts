import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearFinishedWorkflowJobs,
  readWorkflowJobs,
  recoverInterruptedWorkflowJobs,
  upsertWorkflowJob,
  workflowJobId,
  WORKFLOW_JOBS_EVENT,
} from '@/lib/workflowJobs'

describe('workflow job persistence', () => {
  const storage = new Map<string, string>()
  const dispatchEvent = vi.fn()

  beforeEach(() => {
    storage.clear()
    dispatchEvent.mockClear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', class TestCustomEvent {
      constructor(public type: string) {}
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses a stable identity so reselecting the same file resumes the same job', () => {
    expect(workflowJobId('upload', 'book.pdf:1024:123')).toBe(
      workflowJobId('upload', 'book.pdf:1024:123'),
    )
    expect(workflowJobId('upload', 'book.pdf:1024:123')).not.toBe(
      workflowJobId('upload', 'book.pdf:2048:123'),
    )
  })

  it('updates a persisted job without losing its original creation metadata', () => {
    const initial = upsertWorkflowJob({
      id: 'upload-1', kind: 'upload', title: 'Kitap.pdf', status: 'running', progress: 12, attempts: 1,
    })
    const updated = upsertWorkflowJob({
      id: 'upload-1', kind: 'upload', title: 'Kitap.pdf', status: 'paused', progress: 41,
      message: 'Bağlantı kesildi',
    })

    expect(updated.createdAt).toBe(initial.createdAt)
    expect(updated.attempts).toBe(1)
    expect(readWorkflowJobs()).toEqual([updated])
    expect(dispatchEvent).toHaveBeenCalledTimes(2)
    expect(dispatchEvent.mock.calls[0][0].type).toBe(WORKFLOW_JOBS_EVENT)
  })

  it('clamps malformed progress and only clears completed jobs', () => {
    upsertWorkflowJob({ id: 'done', kind: 'import', title: 'Bitti', status: 'completed', progress: 500 })
    upsertWorkflowJob({ id: 'retry', kind: 'upload', title: 'Bekliyor', status: 'paused', progress: -10 })

    expect(readWorkflowJobs().find(job => job.id === 'done')?.progress).toBe(100)
    expect(readWorkflowJobs().find(job => job.id === 'retry')?.progress).toBe(0)

    clearFinishedWorkflowJobs()
    expect(readWorkflowJobs().map(job => job.id)).toEqual(['retry'])
  })

  it('does not crash when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
    })

    expect(() => upsertWorkflowJob({
      id: 'upload-2', kind: 'upload', title: 'Kitap.pdf', status: 'queued',
    })).not.toThrow()
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })

  it('recovers a request interrupted by reload as retryable work', () => {
    upsertWorkflowJob({ id: 'import-1', kind: 'import', title: 'Kaynak kitap', status: 'running', progress: 35 })

    const [recovered] = recoverInterruptedWorkflowJobs()

    expect(recovered.status).toBe('paused')
    expect(recovered.progress).toBe(35)
    expect(recovered.message).toContain('Yeniden')
    expect(readWorkflowJobs()[0].status).toBe('paused')
  })
})
