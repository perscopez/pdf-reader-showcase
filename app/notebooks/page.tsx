'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, BookMarked, ExternalLink, FileJson, FileText, Plus, Save, Trash2 } from 'lucide-react'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import type { ResearchNotebook, ResearchNotebookSummary } from '@/lib/researchNotebooks'

type Annotation = {
  id: number
  book_id: number
  book_title?: string
  page: number
  type: string
  content?: { text?: string; note?: string; sources?: Array<{ page?: number; text?: string }> }
}

function sourcePreview(annotation: Annotation) {
  const source = annotation.content?.sources?.[0]
  return source?.text || annotation.content?.text || annotation.content?.note || 'Kaynak metni bulunmuyor.'
}

export default function NotebooksPage() {
  const theme = useLibraryTheme()
  const th = LIBRARY_THEME[theme]
  const [notebooks, setNotebooks] = useState<ResearchNotebookSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [notebook, setNotebook] = useState<ResearchNotebook | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [title, setTitle] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function loadNotebooks(preferredId?: number | null) {
    const response = await fetch('/api/research-notebooks', { cache: 'no-store' })
    if (!response.ok) throw new Error('Notebook list failed')
    const rows = await response.json() as ResearchNotebookSummary[]
    setNotebooks(rows)
    const nextId = preferredId && rows.some(row => row.id === preferredId) ? preferredId : rows[0]?.id || null
    setSelectedId(nextId)
    return nextId
  }

  async function loadNotebook(id: number) {
    const response = await fetch(`/api/research-notebooks/${id}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Notebook load failed')
    const value = await response.json() as ResearchNotebook
    setNotebook(value)
    setTitle(value.title)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      Promise.all([
        loadNotebooks(),
        fetch('/api/annotations?all=1&limit=500').then(response => response.ok ? response.json() : []).then(value => setAnnotations(Array.isArray(value) ? value : [])),
      ]).catch(() => setMessage('Not defterleri yüklenemedi.')).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedId) loadNotebook(selectedId).catch(() => setMessage('Not defteri açılamadı.'))
      else setNotebook(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedId])

  const availableAnnotations = useMemo(() => {
    const existing = new Set(notebook?.items.map(item => `${item.annotation_id}:${item.source_index}`) || [])
    return annotations.filter(annotation => !existing.has(`${annotation.id}:0`) && annotation.type !== 'drawing')
  }, [annotations, notebook])

  async function createNotebook(event: React.FormEvent) {
    event.preventDefault()
    if (!newTitle.trim()) return
    setSaving(true)
    try {
      const response = await fetch('/api/research-notebooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle }) })
      if (!response.ok) throw new Error('create failed')
      const created = await response.json() as ResearchNotebook
      setNewTitle('')
      await loadNotebooks(created.id)
      setMessage('Not defteri oluşturuldu.')
    } catch { setMessage('Not defteri oluşturulamadı.') } finally { setSaving(false) }
  }

  async function saveTitle() {
    if (!notebook || !title.trim()) return
    setSaving(true)
    try {
      const response = await fetch(`/api/research-notebooks/${notebook.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
      if (!response.ok) throw new Error('save failed')
      const value = await response.json() as ResearchNotebook
      setNotebook(value)
      setNotebooks(current => current.map(item => item.id === value.id ? { ...item, title: value.title, updated_at: value.updated_at } : item))
      setMessage('Başlık kaydedildi.')
    } catch { setMessage('Başlık kaydedilemedi.') } finally { setSaving(false) }
  }

  async function addAnnotation(annotation: Annotation) {
    if (!notebook) return
    const response = await fetch(`/api/research-notebooks/${notebook.id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ annotation_id: annotation.id, heading: annotation.book_title || `Kitap #${annotation.book_id}` }) })
    if (!response.ok) { setMessage((await response.json().catch(() => null))?.error || 'Kaynak eklenemedi.'); return }
    setNotebook(await response.json() as ResearchNotebook)
    setMessage('Kaynak not defterine eklendi.')
  }

  async function updateItem(itemId: number, heading: string, commentary: string) {
    if (!notebook) return
    const response = await fetch(`/api/research-notebooks/${notebook.id}/items`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId, heading, commentary }) })
    if (!response.ok) { setMessage('Blok kaydedilemedi.'); return }
    setNotebook(await response.json() as ResearchNotebook)
    setMessage('Blok kaydedildi.')
  }

  async function removeItem(itemId: number) {
    if (!notebook) return
    const response = await fetch(`/api/research-notebooks/${notebook.id}/items?item_id=${itemId}`, { method: 'DELETE' })
    if (response.ok) await loadNotebook(notebook.id)
  }

  async function moveItem(itemId: number, direction: -1 | 1) {
    if (!notebook) return
    const ids = notebook.items.map(item => item.id)
    const index = ids.indexOf(itemId)
    const next = index + direction
    if (index < 0 || next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next], ids[index]]
    const response = await fetch(`/api/research-notebooks/${notebook.id}/items/reorder`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_ids: ids }) })
    if (response.ok) setNotebook(await response.json() as ResearchNotebook)
  }

  async function deleteNotebook() {
    if (!notebook || !window.confirm('Bu not defteri silinsin mi?')) return
    const response = await fetch(`/api/research-notebooks/${notebook.id}`, { method: 'DELETE' })
    if (response.ok) { setNotebook(null); await loadNotebooks(); setMessage('Not defteri silindi.') }
  }

  return <LibraryPageShell title="Araştırma not defterleri" subtitle="Kaynaklara bağlı, düzenlenebilir çalışma belgeleri" libraryTheme={theme} active="notebooks">
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <form onSubmit={createNotebook} className={`rounded-2xl border p-3 ${th.card}`}>
          <label htmlFor="new-notebook-title" className={`mb-2 block text-xs font-bold uppercase tracking-wider ${th.cardSub}`}>Yeni not defteri</label>
          <div className="flex gap-2"><input id="new-notebook-title" value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={160} placeholder="Örn. Tez notları" className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none ${th.input}`} /><button disabled={saving} className={`rounded-xl px-3 text-white ${th.addBtn}`} title="Not defteri oluştur" aria-label="Not defteri oluştur"><Plus size={17} /></button></div>
        </form>
        <div className={`overflow-hidden rounded-2xl border ${th.card}`}>
          <div className={`border-b p-3 text-xs font-bold uppercase tracking-wider ${th.separator} ${th.cardSub}`}>Not defterlerim <span className={th.cardMuted}>· {notebooks.length}</span></div>
          {loading ? <p className={`p-4 text-sm ${th.cardMuted}`}>Yükleniyor…</p> : notebooks.length === 0 ? <p className={`p-4 text-sm ${th.cardMuted}`}>Henüz not defteri yok.</p> : <div className="max-h-[55vh] overflow-y-auto p-2">{notebooks.map(item => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`mb-1 w-full rounded-xl border p-3 text-left transition ${selectedId === item.id ? 'border-[var(--lib-accent)] bg-[var(--lib-accent-surface)]' : th.filterInactive}`}><span className={`block truncate text-sm font-bold ${th.cardText}`}>{item.title}</span><span className={`mt-1 block text-xs ${th.cardMuted}`}>{item.item_count} kaynak{item.missing_source_count ? ` · ${item.missing_source_count} eksik` : ''}</span></button>)}</div>}
        </div>
      </aside>
      <section className="min-w-0 space-y-4">
        {message && <p role="status" className={`rounded-xl border p-3 text-sm ${th.cardSource} ${th.card}`}>{message}</p>}
        {!notebook ? <div className={`grid min-h-80 place-items-center rounded-2xl border p-8 text-center ${th.emptyPanel}`}><div><BookMarked className="mx-auto mb-3 text-[var(--lib-accent)]" size={32} /><h2 className={`font-bold ${th.title}`}>Bir not defteri seçin</h2><p className={`mt-1 text-sm ${th.cardMuted}`}>Notlar ve vurgularınızı kaynak bağlantılarını koruyarak birleştirin.</p></div></div> : <>
          <section className={`rounded-2xl border p-4 ${th.card}`}>
            <div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><label htmlFor="notebook-title" className={`mb-1 block text-xs font-bold uppercase tracking-wider ${th.cardSub}`}>Başlık</label><input id="notebook-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} className={`w-full rounded-xl border px-3 py-2 text-lg font-black outline-none ${th.input}`} /></div><div className="flex items-end gap-2 pt-5"><button type="button" onClick={saveTitle} disabled={saving} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white ${th.addBtn}`}><Save size={15} /> Kaydet</button><button type="button" onClick={deleteNotebook} className="rounded-xl border border-red-400/30 p-2 text-red-300 hover:bg-red-500/10" title="Not defterini sil" aria-label="Not defterini sil"><Trash2 size={16} /></button></div></div>
            <div className="mt-3 flex flex-wrap items-center gap-2"><a href={`/api/research-notebooks/${notebook.id}/export?format=markdown`} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${th.filterInactive}`}><FileText size={14} /> Markdown dışa aktar</a><a href={`/api/research-notebooks/${notebook.id}/export?format=json`} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${th.filterInactive}`}><FileJson size={14} /> JSON yedekle</a><Link href="/workspace" className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${th.filterInactive}`}><ExternalLink size={14} /> Çalışma alanı</Link></div>
          </section>
          <section className={`rounded-2xl border p-4 ${th.card}`}><div className="mb-3"><h2 className={`font-black ${th.title}`}>Kaynak blokları</h2><p className={`text-xs ${th.cardMuted}`}>{notebook.items.length} blok · kaynak bağlantıları değişmez</p></div>{notebook.items.length === 0 ? <p className={`rounded-xl border border-dashed p-5 text-sm ${th.cardMuted}`}>Aşağıdaki listeden bir not veya vurgu ekleyin.</p> : <div className="space-y-3">{notebook.items.map((item, index) => <NotebookItemEditor key={item.id} item={item} index={index} total={notebook.items.length} theme={theme} onSave={updateItem} onDelete={removeItem} onMove={moveItem} />)}</div>}</section>
          <section className={`rounded-2xl border p-4 ${th.card}`}><h2 className={`mb-3 font-black ${th.title}`}>Kaynak ekle</h2>{availableAnnotations.length === 0 ? <p className={`text-sm ${th.cardMuted}`}>Eklenebilecek kaynak bulunamadı.</p> : <div className="grid gap-2 sm:grid-cols-2">{availableAnnotations.slice(0, 30).map(annotation => <article key={annotation.id} className={`rounded-xl border p-3 ${th.filterInactive}`}><p className={`truncate text-xs font-bold ${th.cardText}`}>{annotation.book_title || `Kitap #${annotation.book_id}`} · s. {annotation.page}</p><p className={`mt-1 line-clamp-2 text-xs ${th.cardSub}`}>{sourcePreview(annotation)}</p><button type="button" onClick={() => addAnnotation(annotation)} className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-white ${th.addBtn}`}><Plus size={13} /> Ekle</button></article>)}</div>}</section>
        </>}
      </section>
    </div>
  </LibraryPageShell>
}

function NotebookItemEditor({ item, index, total, theme, onSave, onDelete, onMove }: {
  item: ResearchNotebook['items'][number]
  index: number
  total: number
  theme: keyof typeof LIBRARY_THEME
  onSave: (id: number, heading: string, commentary: string) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onMove: (id: number, direction: -1 | 1) => Promise<void>
}) {
  const th = LIBRARY_THEME[theme]
  const [heading, setHeading] = useState(item.heading)
  const [commentary, setCommentary] = useState(item.commentary)
  return <article className={`rounded-xl border p-3 ${item.missing_source ? 'border-amber-400/40 bg-amber-500/5' : th.filterInactive}`}>
    <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><input value={heading} onChange={event => setHeading(event.target.value)} placeholder="Bölüm başlığı" maxLength={240} className={`w-full border-b bg-transparent py-1 text-sm font-bold outline-none ${th.input}`} /><div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${th.cardMuted}`}>{item.source ? <Link href={item.source.href} target="_blank" className={`inline-flex items-center gap-1 ${th.cardSource} hover:underline`}><ExternalLink size={12} /> {item.source.book_title} · s. {item.source.page}</Link> : <span>Kaynak bulunamadı · Annotation #{item.annotation_id}</span>}</div></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => onMove(item.id, -1)} disabled={index === 0} className={`rounded-lg border p-1.5 disabled:opacity-30 ${th.filterInactive}`} title="Yukarı taşı" aria-label="Yukarı taşı"><ArrowUp size={14} /></button><button type="button" onClick={() => onMove(item.id, 1)} disabled={index === total - 1} className={`rounded-lg border p-1.5 disabled:opacity-30 ${th.filterInactive}`} title="Aşağı taşı" aria-label="Aşağı taşı"><ArrowDown size={14} /></button><button type="button" onClick={() => onDelete(item.id)} className="rounded-lg border border-red-400/30 p-1.5 text-red-300" title="Bloğu kaldır" aria-label="Bloğu kaldır"><Trash2 size={14} /></button></div></div>
    {item.source && <blockquote className={`mt-3 border-l-2 border-[var(--lib-accent)] pl-3 text-sm leading-relaxed ${th.cardText}`}>{item.source.text || 'Alıntı metni yok.'}</blockquote>}
    <textarea value={commentary} onChange={event => setCommentary(event.target.value)} placeholder="Kendi yorumunuzu ekleyin…" maxLength={12_000} className={`mt-3 min-h-24 w-full rounded-xl border p-3 text-sm leading-relaxed outline-none ${th.input}`} />
    <div className="mt-2 flex justify-end"><button type="button" onClick={() => onSave(item.id, heading, commentary)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${th.filterInactive}`}><Save size={13} /> Bloğu kaydet</button></div>
  </article>
}
