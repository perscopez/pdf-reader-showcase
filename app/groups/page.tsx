'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'

type Group = { id: number; name: string; description: string; member_count: number; book_count: number; owner_user_id: number }

export default function ReadingGroupsPage() {
  const libraryTheme = useLibraryTheme()
  const th = LIBRARY_THEME[libraryTheme]
  const [groups, setGroups] = useState<Group[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const response = await fetch('/api/reading-groups')
      if (!response.ok) throw new Error('Gruplar yüklenemedi.')
      setGroups(await response.json() as Group[])
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gruplar yüklenemedi.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createGroup(event: FormEvent) {
    event.preventDefault()
    const response = await fetch('/api/reading-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) })
    if (!response.ok) { const body = await response.json().catch(() => ({})); setError(body.error || 'Grup oluşturulamadı.'); return }
    setName(''); setDescription(''); await load()
  }

  return (
    <LibraryPageShell title="Okuma grupları" subtitle="Özel kitapları üyeler ve ortak notlarla güvenli biçimde paylaş" libraryTheme={libraryTheme} active="groups">
      <div className="mb-4 flex items-center justify-end gap-2"><SyncStatusBadge compact={false} /><LanguageSwitcher compact /></div>
      {error && <div className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={createGroup} className={`rounded-2xl border p-5 shadow-[0_24px_80px_var(--lib-shadow)] ${th.card}`}>
          <h2 className={`text-lg font-black ${th.title}`}>Yeni grup</h2>
          <p className={`mt-1 text-sm ${th.cardMuted}`}>Kitap ve ortak not paylaşımı için yalnızca davet ettiğiniz hesapları ekleyin.</p>
          <label className={`mt-5 block text-xs font-bold ${th.cardMuted}`}>Grup adı<input required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} className={`mt-1 min-h-11 w-full rounded-xl border px-3 text-sm ${th.input}`} /></label>
          <label className={`mt-3 block text-xs font-bold ${th.cardMuted}`}>Açıklama (isteğe bağlı)<textarea maxLength={500} value={description} onChange={event => setDescription(event.target.value)} className={`mt-1 min-h-24 w-full rounded-xl border p-3 text-sm ${th.input}`} /></label>
          <button className={`mt-4 min-h-11 rounded-xl px-4 text-sm font-bold ${th.addBtn}`}>Grup oluştur</button>
        </form>
        <section className={`rounded-2xl border p-5 shadow-[0_24px_80px_var(--lib-shadow)] ${th.card}`}>
          <h2 className={`text-lg font-black ${th.title}`}>Gruplarım</h2>
          {loading ? <p className={`py-8 text-sm ${th.cardMuted}`}>Yükleniyor…</p> : groups.length === 0 ? <p className={`py-8 text-sm ${th.cardMuted}`}>Henüz bir grubunuz yok.</p> : <div className="mt-4 grid gap-3">{groups.map(group => <Link key={group.id} href={`/groups/${group.id}`} className={`block rounded-xl border p-4 transition-transform ${th.bookCard}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className={`truncate font-bold ${th.cardText}`}>{group.name}</h3><p className={`mt-1 line-clamp-2 text-sm ${th.cardSub}`}>{group.description || 'Açıklama eklenmemiş.'}</p></div><span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${th.heroBadge}`}>Aç</span></div><p className={`mt-3 text-xs ${th.cardMuted}`}>{group.member_count} üye · {group.book_count} kitap</p></Link>)}</div>}
        </section>
      </div>
      <p className={`mt-5 text-xs ${th.cardMuted}`}>Şifreli kitaplar grup paylaşımına kapalıdır. Kişisel notlarınız hiçbir gruba otomatik olarak açılmaz.</p>
    </LibraryPageShell>
  )
}
