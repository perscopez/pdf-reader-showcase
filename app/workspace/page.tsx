'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Check,
  Edit3,
  ExternalLink,
  Layers,
  Link2,
  Maximize2,
  Menu,
  Plus,
  Save,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { buildAnnotationDeepLink } from '@/lib/annotations'
import AnnotationEditor from '@/components/AnnotationEditor'
import type { Annotation } from '@/components/ReaderTypes'
import { cleanText } from '@/lib/text'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { getLibraryThemeStyle } from '@/lib/libraryTheme'

type Source = { page: number; text?: string }

type ResearchAnnotation = Annotation & { book_id: number; book_title?: string }
type NotebookSummary = { id: number; title: string; item_count: number }

interface CanvasNode {
  id: string
  annotationId: number
  sourceIndex?: number
  text: string
  bookId: number
  bookTitle: string
  page: number
  x: number
  y: number
}

interface Connection { fromId: string; toId: string }

const STORAGE_KEY = 'pdf-research-workspace:v1'

function annotationSources(annotation: ResearchAnnotation): Source[] {
  const sources = annotation.content?.sources?.filter(source => Number.isInteger(source.page) && source.page > 0) || []
  if (sources.length > 0) return sources
  return [{ page: annotation.page, text: annotation.content?.text }]
}

function sourceText(annotation: ResearchAnnotation, sourceIndex?: number) {
  const source = annotationSources(annotation)[sourceIndex || 0]
  return cleanText(source?.text || annotation.content?.note || annotation.content?.text || 'Kaynak metni bulunmuyor.')
}

function sourceKey(annotationId: number, sourceIndex?: number) {
  return `${annotationId}:${sourceIndex ?? 0}`
}

function WorkspaceCanvas({
  nodes,
  connections,
  selectedNodeId,
  connectingNodeId,
  onSelect,
  onConnect,
  onDelete,
  onMove,
}: {
  nodes: CanvasNode[]
  connections: Connection[]
  selectedNodeId: string | null
  connectingNodeId: string | null
  onSelect: (id: string) => void
  onConnect: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)

  function startDrag(id: string, event: React.PointerEvent<HTMLElement>) {
    const node = nodes.find(item => item.id === id)
    const canvas = canvasRef.current
    if (!node || !canvas) return
    const rect = canvas.getBoundingClientRect()
    dragRef.current = { id, dx: event.clientX - rect.left - node.x, dy: event.clientY - rect.top - node.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(id)
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const canvas = canvasRef.current
    if (!drag || !canvas) return
    const rect = canvas.getBoundingClientRect()
    onMove(drag.id, Math.max(12, event.clientX - rect.left - drag.dx), Math.max(12, event.clientY - rect.top - drag.dy))
  }

  return (
    <div
      ref={canvasRef}
      className="relative min-h-[32rem] flex-1 overflow-auto bg-[var(--lib-surface-strong)] [background-image:radial-gradient(var(--lib-border)_1px,transparent_1px)] [background-size:18px_18px]"
      onPointerMove={moveDrag}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
      onClick={() => onSelect('')}
    >
      <svg className="pointer-events-none absolute inset-0 h-full min-h-[32rem] w-full" aria-hidden="true">
        {connections.map(connection => {
          const from = nodes.find(node => node.id === connection.fromId)
          const to = nodes.find(node => node.id === connection.toId)
          if (!from || !to) return null
          return <line key={`${connection.fromId}-${connection.toId}`} x1={from.x + 128} y1={from.y + 54} x2={to.x + 128} y2={to.y + 54} stroke="var(--lib-accent)" strokeWidth="2" strokeDasharray="6 5" />
        })}
      </svg>
      {nodes.length === 0 && <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-[var(--lib-text-muted)]"><div><Layers className="mx-auto mb-3 text-[var(--lib-accent)]" size={28} /><p>Kaynak railinden alıntıları panoya sabitleyin.</p><p className="mt-1 text-xs">Kartları sürükleyin, sonra iki kartı bağlayın.</p></div></div>}
      {nodes.map(node => {
        const selected = selectedNodeId === node.id
        const connecting = connectingNodeId === node.id
        return <article
          key={node.id}
          style={{ left: node.x, top: node.y }}
          className={`absolute w-64 touch-none rounded-2xl border bg-[var(--lib-surface)] p-4 shadow-2xl backdrop-blur-xl ${selected ? 'border-[var(--lib-accent)] ring-2 ring-[var(--lib-accent)]/30' : 'border-[var(--lib-border)]'}`}
          onPointerDown={event => startDrag(node.id, event)}
          onClick={event => event.stopPropagation()}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--lib-accent-soft)]">{node.bookTitle}</p>
              <p className="text-[10px] text-[var(--lib-text-muted)]">Sayfa {node.page}{node.sourceIndex !== undefined ? ` · Kaynak ${node.sourceIndex + 1}` : ''}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" title="İlişkilendir" aria-label="İlişkilendir" onClick={() => onConnect(node.id)} className={`rounded-lg p-1.5 ${connecting ? 'bg-[var(--lib-accent)] text-white' : 'text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white'}`}><Link2 size={14} /></button>
              <button type="button" title="Kartı kaldır" aria-label="Kartı kaldır" onClick={() => onDelete(node.id)} className="rounded-lg p-1.5 text-[var(--lib-text-secondary)] hover:bg-red-500/15 hover:text-red-200"><Trash2 size={14} /></button>
            </div>
          </div>
          <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-[var(--lib-text)]">{node.text}</p>
        </article>
      })}
    </div>
  )
}

export default function WorkspacePage() {
  const libraryTheme = useLibraryTheme()
  const [annotations, setAnnotations] = useState<ResearchAnnotation[]>([])
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [connectingNodeId, setConnectingNodeId] = useState<string | null>(null)
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null)
  const [sourceBookId, setSourceBookId] = useState<number | null>(null)
  const [sourceLink, setSourceLink] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingAnnotation, setEditingAnnotation] = useState<ResearchAnnotation | null>(null)
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([])
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null)
  const [notebookMessage, setNotebookMessage] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch('/api/annotations?all=1&limit=500')
        .then(response => response.ok ? response.json() : [])
        .then(data => setAnnotations(Array.isArray(data) ? (data as ResearchAnnotation[]).filter(annotation => annotation.type === 'note' || annotation.type === 'highlight') : []))
        .catch(() => setAnnotations([]))
        .finally(() => setLoading(false))
      fetch('/api/research-notebooks', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : [])
        .then(data => {
          const rows = Array.isArray(data) ? data as NotebookSummary[] : []
          setNotebooks(rows)
          setSelectedNotebookId(rows[0]?.id || null)
        })
        .catch(() => setNotebooks([]))
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const value = JSON.parse(raw) as { nodes?: CanvasNode[]; connections?: Connection[] }
          if (Array.isArray(value.nodes)) setNodes(value.nodes)
          if (Array.isArray(value.connections)) setConnections(value.connections)
        }
      } catch { /* local layout is optional */ }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const sources = useMemo(() => annotations.flatMap(annotation => annotationSources(annotation).map((source, sourceIndex) => ({ annotation, source, sourceIndex, key: sourceKey(annotation.id, sourceIndex) }))), [annotations])

  function saveBoard() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, connections }))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  function openSource(annotation: ResearchAnnotation, sourceIndex = 0) {
    const page = annotationSources(annotation)[sourceIndex]?.page || annotation.page
    const link = buildAnnotationDeepLink(annotation.book_id, page, annotation.id, sourceIndex)
    setSelectedSourceKey(sourceKey(annotation.id, sourceIndex))
    setSourceBookId(annotation.book_id)
    setSourceLink(link)
    setRailOpen(false)
  }

  function pinSource(annotation: ResearchAnnotation, sourceIndex = 0) {
    const key = sourceKey(annotation.id, sourceIndex)
    if (nodes.some(node => sourceKey(node.annotationId, node.sourceIndex) === key)) {
      openSource(annotation, sourceIndex)
      return
    }
    const column = nodes.length % 3
    const row = Math.floor(nodes.length / 3)
    const source = annotationSources(annotation)[sourceIndex]
    const node: CanvasNode = {
      id: `source-${annotation.id}-${sourceIndex}-${nodes.length}`,
      annotationId: annotation.id,
      sourceIndex,
      text: sourceText(annotation, sourceIndex),
      bookId: annotation.book_id,
      bookTitle: annotation.book_title || `Kitap #${annotation.book_id}`,
      page: source?.page || annotation.page,
      x: 24 + column * 286,
      y: 24 + row * 190,
    }
    setNodes(current => [...current, node])
    openSource(annotation, sourceIndex)
  }

  function connectNode(id: string) {
    if (!connectingNodeId) { setConnectingNodeId(id); setSelectedNodeId(id); return }
    if (connectingNodeId !== id) {
      setConnections(current => current.some(connection => connection.fromId === connectingNodeId && connection.toId === id) ? current : [...current, { fromId: connectingNodeId, toId: id }])
    }
    setConnectingNodeId(null)
  }

  function deleteNode(id: string) {
    setNodes(current => current.filter(node => node.id !== id))
    setConnections(current => current.filter(connection => connection.fromId !== id && connection.toId !== id))
    if (selectedNodeId === id) setSelectedNodeId(null)
  }

  async function addSourceToNotebook(annotation: ResearchAnnotation, sourceIndex: number) {
    if (!selectedNotebookId) {
      setNotebookMessage('Önce bir not defteri oluşturup seçin.')
      return
    }
    const response = await fetch(`/api/research-notebooks/${selectedNotebookId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotation_id: annotation.id, source_index: sourceIndex, heading: annotation.book_title || `Kitap #${annotation.book_id}` }),
    })
    const data = await response.json().catch(() => null) as { error?: string } | null
    setNotebookMessage(response.ok ? 'Kaynak not defterine eklendi.' : data?.error || 'Kaynak eklenemedi.')
  }

  async function saveAnnotation(content: Partial<Annotation['content']>) {
    if (!editingAnnotation) return
    const response = await fetch('/api/annotations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingAnnotation.id, content }),
    })
    if (!response.ok) throw new Error('annotation update failed')
    const updated = await response.json() as ResearchAnnotation
    setAnnotations(current => current.map(annotation => annotation.id === updated.id ? { ...annotation, ...updated } : annotation))
    setEditingAnnotation(null)
  }

  const selectedSource = sources.find(source => source.key === selectedSourceKey)

  return <div style={getLibraryThemeStyle(libraryTheme) as React.CSSProperties} className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--lib-bg)] text-[var(--lib-text)]">
    <header className="z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--lib-border)] bg-[var(--lib-header)] px-3 backdrop-blur-xl sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3"><Link href="/" className="rounded-xl p-2 text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white" aria-label="Kütüphaneye dön" title="Kütüphaneye dön"><ArrowLeft size={18} /></Link><Layers className="shrink-0 text-[var(--lib-accent)]" size={19} /><div className="min-w-0"><h1 className="truncate text-sm font-bold sm:text-base">Kaynaklı araştırma çalışma alanı</h1><p className="hidden truncate text-[11px] text-[var(--lib-text-muted)] sm:block">Alıntıları sabitleyin, kaynaklarına dönün ve ilişkileri görün.</p></div></div>
      <div className="flex shrink-0 items-center gap-1.5"><Link href="/notebooks" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--lib-border)] px-2.5 py-2 text-xs font-semibold text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white" title="Not defterlerini aç"><BookMarked size={14} /> <span className="hidden sm:inline">Not defterleri</span></Link><button type="button" onClick={() => setRailOpen(current => !current)} className="rounded-lg border border-[var(--lib-border)] p-2 text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white lg:hidden" aria-label="Kaynak railini aç"><Menu size={16} /></button><button type="button" onClick={saveBoard} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--lib-border)] px-2.5 py-2 text-xs font-semibold text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white"><Save size={14} /> <span className="hidden sm:inline">{saved ? 'Kaydedildi' : 'Panoyu kaydet'}</span></button></div>
    </header>
    <main className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="relative flex min-h-[42%] min-w-0 flex-1 flex-col border-b border-[var(--lib-border)] lg:min-h-0 lg:border-b-0 lg:border-r" aria-label="Kaynak okuyucu">
        {sourceBookId ? <iframe key={sourceLink} title="Kaynak okuyucu" src={sourceLink} className="h-full min-h-0 w-full border-0 bg-[var(--lib-bg)]" /> : <div className="grid h-full place-items-center p-8 text-center text-sm text-[var(--lib-text-muted)]"><div><BookOpen className="mx-auto mb-3 text-[var(--lib-accent)]" size={28} /><p>Bir alıntının <span className="text-[var(--lib-text)]">Kaynağı aç</span> düğmesine basın.</p><p className="mt-1 text-xs">Okuyucu PDF, sürekli okuma ve metin akışı modlarını korur.</p></div></div>}
        {sourceBookId && selectedSource && <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--lib-border)] bg-[var(--lib-surface)] p-2.5 text-xs shadow-xl backdrop-blur-xl"><span className="min-w-0 truncate text-[var(--lib-text-secondary)]">{selectedSource.annotation.book_title || `Kitap #${sourceBookId}`} · Sayfa {selectedSource.source.page}</span><Link href={sourceLink} className="shrink-0 rounded-lg border border-[var(--lib-border)] p-1.5 text-[var(--lib-accent-soft)] hover:bg-[var(--lib-surface-subtle)]" title="Kaynağı yeni sekmede aç" aria-label="Kaynağı yeni sekmede aç" target="_blank"><ExternalLink size={14} /></Link></div>}
      </section>
      <section className="relative flex min-h-0 min-w-0 flex-[1.1] flex-col" aria-label="Araştırma panosu"><div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--lib-border)] bg-[var(--lib-header)] px-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--lib-text-secondary)]"><StickyNote size={14} className="text-[var(--lib-accent)]" /> Alıntı panosu <span className="text-[var(--lib-text-muted)]">{nodes.length}</span></div>{connectingNodeId && <button type="button" onClick={() => setConnectingNodeId(null)} className="text-xs text-[var(--lib-accent-soft)]">Bağlantıyı iptal et</button>}</div><WorkspaceCanvas nodes={nodes} connections={connections} selectedNodeId={selectedNodeId} connectingNodeId={connectingNodeId} onSelect={id => setSelectedNodeId(id || null)} onConnect={connectNode} onDelete={deleteNode} onMove={(id, x, y) => setNodes(current => current.map(node => node.id === id ? { ...node, x, y } : node))} /></section>
      <aside className={`absolute inset-y-0 right-0 z-10 flex w-[min(22rem,92vw)] flex-col border-l border-[var(--lib-border)] bg-[var(--lib-header)] shadow-2xl transition-transform lg:static lg:w-80 lg:translate-x-0 lg:shadow-none ${railOpen ? 'translate-x-0' : 'translate-x-full'}`} aria-label="Kaynak raili"><div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--lib-border)] px-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--lib-text-secondary)]">Kaynak raili</p><p className="text-[10px] text-[var(--lib-text-muted)]">{sources.length} kaynak</p></div><button type="button" onClick={() => setRailOpen(false)} className="rounded-lg p-2 text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] lg:hidden" aria-label="Kaynak railini kapat"><X size={16} /></button></div><div className="min-h-0 flex-1 overflow-y-auto p-3"><div className="mb-3 rounded-xl border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] p-3 text-xs leading-relaxed text-[var(--lib-text-secondary)]"><p className="font-semibold text-[var(--lib-accent-soft)]">Kaynak bağlantısı korunur</p><p className="mt-1">Her kart orijinal kitap ve sayfaya bağlıdır. Tam konuma dönmek için Kaynağı açın.</p></div>{sources.length > 0 && <div className="mb-3 rounded-xl border border-[var(--lib-border)] bg-[var(--lib-surface-subtle)] p-3"><label htmlFor="workspace-notebook" className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--lib-text-muted)]">Kaynakları şu deftere ekle</label><div className="flex gap-2"><select id="workspace-notebook" value={selectedNotebookId || ''} onChange={event => setSelectedNotebookId(Number(event.target.value) || null)} className="min-w-0 flex-1 rounded-lg border border-[var(--lib-border)] bg-[var(--lib-surface)] px-2 py-2 text-xs text-[var(--lib-text)]"><option value="">Defter seçin</option>{notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.title}</option>)}</select><Link href="/notebooks" className="rounded-lg border border-[var(--lib-border)] p-2 text-[var(--lib-accent-soft)]" title="Not defteri oluştur"><Plus size={14} /></Link></div>{notebookMessage && <p role="status" className="mt-2 text-[10px] text-[var(--lib-accent-soft)]">{notebookMessage}</p>}</div>}{loading ? <p className="py-10 text-center text-sm text-[var(--lib-text-muted)]">Kaynaklar yükleniyor…</p> : sources.length === 0 ? <p className="py-10 text-center text-sm text-[var(--lib-text-muted)]">Henüz not veya vurgu yok.</p> : <div className="space-y-2">{sources.map(({ annotation, source, sourceIndex, key }) => { const pinned = nodes.some(node => sourceKey(node.annotationId, node.sourceIndex) === key); return <article key={key} className={`rounded-xl border p-3 ${pinned ? 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)]' : 'border-[var(--lib-border)] bg-[var(--lib-surface-subtle)]'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-wide text-[var(--lib-accent-soft)]">{annotation.book_title || `Kitap #${annotation.book_id}`}</p><p className="text-[10px] text-[var(--lib-text-muted)]">Sayfa {source.page}{annotation.content?.pageNote ? ' · Sayfa notu' : ''}</p></div>{pinned && <Check size={14} className="shrink-0 text-[var(--lib-accent)]" />}</div><p className="mt-2 line-clamp-4 text-xs leading-relaxed text-[var(--lib-text)]">{sourceText(annotation, sourceIndex)}</p><div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => pinSource(annotation, sourceIndex)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-[var(--lib-accent)] px-2 text-[11px] font-bold text-white hover:bg-[var(--lib-accent-strong)]"><Plus size={13} /> {pinned ? 'Panoda' : 'Sabitle'}</button><button type="button" onClick={() => openSource(annotation, sourceIndex)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--lib-border)] px-2 text-[11px] font-semibold text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white"><Maximize2 size={13} /> Aç</button><button type="button" onClick={() => addSourceToNotebook(annotation, sourceIndex)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--lib-border)] px-2 text-[11px] font-semibold text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)] hover:text-white"><BookMarked size={13} /> Deftere ekle</button></div><div className="mt-2 flex items-center justify-between gap-2"><Link href={buildAnnotationDeepLink(annotation.book_id, source.page, annotation.id, sourceIndex)} className="inline-flex items-center gap-1 text-[10px] text-[var(--lib-accent-soft)] hover:underline" target="_blank"><ExternalLink size={11} /> Kalıcı kaynak bağlantısı</Link>{annotation.type === 'note' && <button type="button" onClick={() => setEditingAnnotation(annotation)} className="inline-flex items-center gap-1 text-[10px] text-[var(--lib-text-secondary)] hover:text-white"><Edit3 size={11} /> Düzenle</button>}</div></article> })}</div>}</div></aside>
    </main>
    {editingAnnotation && <AnnotationEditor bookId={editingAnnotation.book_id} page={editingAnnotation.page} annotation={editingAnnotation} themeStyle={{ panel: 'border-[var(--lib-border)] bg-[var(--lib-surface)] text-[var(--lib-text)]', button: 'border-[var(--lib-border)] bg-[var(--lib-surface-subtle)] text-[var(--lib-text-secondary)] hover:bg-[var(--lib-surface-subtle)]', active: 'border-[var(--lib-accent)] bg-[var(--lib-accent-surface)] text-[var(--lib-text)]', subtle: 'text-[var(--lib-text-muted)]', text: 'text-[var(--lib-text)]', accent: 'var(--lib-accent)' }} onSave={saveAnnotation} onClose={() => setEditingAnnotation(null)} />}
  </div>
}
