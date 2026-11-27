'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ExternalLink, GitBranch, Highlighter, StickyNote } from 'lucide-react'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { useI18n } from '@/components/I18nProvider'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import type { KnowledgeGraph } from '@/lib/knowledgeGraph'

export default function KnowledgeGraphPage() {
  const { t } = useI18n()
  const theme = useLibraryTheme()
  const th = LIBRARY_THEME[theme]
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { fetch('/api/knowledge-graph').then(res => res.ok ? res.json() : Promise.reject()).then(setGraph).catch(() => setError(true)) }, [])
  const visibleNodes = useMemo(() => graph?.nodes.filter(node => node.type !== 'annotation' || node.label.length > 0) || [], [graph])
  const positions = useMemo(() => {
    const books = visibleNodes.filter(node => node.type === 'book')
    const concepts = visibleNodes.filter(node => node.type === 'concept')
    const annotations = visibleNodes.filter(node => node.type === 'annotation')
    const map = new Map<string, { x: number; y: number }>()
    books.forEach((node, i) => map.set(node.id, { x: 13 + (i % 4) * 24, y: 18 + Math.floor(i / 4) * 25 }))
    concepts.forEach((node, i) => map.set(node.id, { x: 50 + (i % 4) * 13, y: 14 + Math.floor(i / 4) * 22 }))
    annotations.forEach((node, i) => map.set(node.id, { x: 18 + (i % 5) * 16, y: 78 + Math.floor(i / 5) * 14 }))
    return map
  }, [visibleNodes])
  const statCards: Array<{ icon: typeof BookOpen; value: number; label: string }> = [
    { icon: BookOpen, value: graph?.stats.books || 0, label: t('graph.books') },
    { icon: GitBranch, value: graph?.stats.concepts || 0, label: t('graph.concepts') },
    { icon: StickyNote, value: graph?.stats.annotations || 0, label: t('graph.annotations') },
    { icon: ExternalLink, value: graph?.stats.backlinks || 0, label: t('graph.backlinks') },
  ]
  return <LibraryPageShell title={t('graph.title')} subtitle={t('graph.subtitle')} libraryTheme={theme} active="graph">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p className={`text-sm ${th.cardMuted}`}>{t('graph.hint')}</p><Link href="/notes" className={`rounded-lg px-3 py-2 text-xs font-bold ${th.navBtn}`}>{t('graph.openNotes')}</Link></div>
    {error && <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-6 text-sm text-red-100">{t('graph.loadFailed')}</div>}
    {!graph && !error && <div className={`rounded-2xl border p-8 text-center text-sm ${th.card} ${th.cardMuted}`}>{t('common.loading')}</div>}
    {graph && <>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{statCards.map(({ icon: Icon, value, label }) => <div key={label} className={`rounded-xl border p-3 ${th.card}`}><Icon size={16} className="mb-2 text-[var(--lib-accent)]" /><p className={`text-xl font-black ${th.cardText}`}>{value}</p><p className={`text-[11px] ${th.cardMuted}`}>{label}</p></div>)}</div>
      <section aria-label={t('graph.visualization')} className={`relative mb-4 h-[520px] overflow-hidden rounded-2xl border ${th.card}`}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>{graph.edges.map(edge => { const a = positions.get(edge.source); const b = positions.get(edge.target); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.kind === 'book-backlink' ? 'var(--lib-accent)' : 'var(--lib-border-strong)'} strokeWidth={edge.kind === 'book-backlink' ? 0.45 : 0.25} strokeDasharray={edge.kind === 'book-backlink' ? '1.2 1.2' : undefined} opacity=".75" /> : null })}</svg>
        {visibleNodes.map(node => { const point = positions.get(node.id); if (!point) return null; const active = selected === node.id; const color = node.type === 'book' ? 'var(--lib-accent)' : node.type === 'concept' ? 'var(--lib-accent-soft)' : 'var(--lib-text-secondary)'; return <button key={node.id} onClick={() => setSelected(active ? null : node.id)} style={{ left: `${point.x}%`, top: `${point.y}%`, borderColor: active ? 'var(--lib-accent)' : 'var(--lib-border)' }} className={`absolute max-w-36 -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2 py-1.5 text-left text-[10px] shadow-lg backdrop-blur ${active ? 'ring-2 ring-[var(--lib-accent)]/40' : ''} ${th.card}`}><span className="block truncate font-bold" style={{ color }}>{node.label}</span>{node.subtitle && <span className={`block truncate text-[9px] ${th.cardMuted}`}>{node.subtitle}</span>}</button> })}
      </section>
      <section className="grid gap-3 md:grid-cols-2" aria-label={t('graph.listFallback')}>
        {visibleNodes.filter(node => node.type !== 'concept').map(node => <div key={node.id} className={`flex items-start gap-3 rounded-xl border p-3 ${th.card}`}><div className="mt-0.5 text-[var(--lib-accent)]">{node.type === 'book' ? <BookOpen size={16} /> : node.annotationType === 'highlight' ? <Highlighter size={16} /> : <StickyNote size={16} />}</div><div className="min-w-0 flex-1"><p className={`font-bold ${th.cardText}`}>{node.label}</p><p className={`mt-1 text-xs ${th.cardMuted}`}>{node.subtitle}</p>{node.sourceLinks && node.sourceLinks.length > 1 && <div className="mt-2 flex flex-wrap gap-1.5">{node.sourceLinks.map(source => <Link key={source.href} href={source.href} className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${th.navBtn}`}>{source.label}</Link>)}</div>}</div>{node.href && <Link href={node.href} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${th.navBtn}`}>{t('graph.openSource')}</Link>}</div>)}
      </section>
    </>}
  </LibraryPageShell>
}
