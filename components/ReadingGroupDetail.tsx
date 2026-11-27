'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { BookOpen, ChevronDown, ExternalLink, Globe2, Link2, LockKeyhole, MessageCircle, Plus, Trash2, UserMinus, Users } from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { useSession } from '@/components/SessionProvider'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import {
  annotationText,
  canDeleteGroupAnnotation,
  canDeleteGroupReply,
  canManageGroup,
  sourceHref,
} from '@/components/readingGroupDetailModel'

type Group = {
  id: number
  name: string
  description: string
  member_count: number
  book_count: number
  owner_user_id: number
}

type Member = {
  user_id: number
  username: string
  role: 'owner' | 'member'
  created_at: string
}

type GroupBook = {
  id: number
  title: string
  author: string
  filename: string
  total_pages: number | null
  is_encrypted: number
  shared_at: string
}

type OwnedBook = {
  id: number
  title: string
  author: string
  is_encrypted?: number
}

type GroupAnnotation = {
  id: number
  group_id: number
  book_id: number
  author_user_id: number
  author_username: string
  type: string
  content: unknown
  page: number
  visibility: 'group' | 'private'
  created_at: string
  updated_at: string
}

type GroupReply = {
  id: number
  annotation_id: number
  author_user_id: number
  author_username?: string
  content: string
  created_at?: string
  updated_at?: string
}

type ReplyState = {
  open: boolean
  loading: boolean
  items: GroupReply[]
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'İşlem tamamlanamadı.')
  }
  return body as T
}

function formatDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('tr-TR') || '').join('') || 'Ü'
}

export default function ReadingGroupDetail({ groupId }: { groupId: string }) {
  const libraryTheme = useLibraryTheme()
  const th = LIBRARY_THEME[libraryTheme]
  const { user: sessionUser } = useSession()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [books, setBooks] = useState<GroupBook[]>([])
  const [ownedBooks, setOwnedBooks] = useState<OwnedBook[]>([])
  const [annotations, setAnnotations] = useState<GroupAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [memberUsername, setMemberUsername] = useState('')
  const [shareBookId, setShareBookId] = useState('')
  const [annotationBookId, setAnnotationBookId] = useState('')
  const [annotationPage, setAnnotationPage] = useState('1')
  const [annotationContent, setAnnotationContent] = useState('')
  const [annotationVisibility, setAnnotationVisibility] = useState<'group' | 'private'>('group')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [replyStates, setReplyStates] = useState<Record<number, ReplyState>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const groups = await requestJson<Group[]>('/api/reading-groups')
      const nextGroup = groups.find(item => String(item.id) === String(groupId))
      if (!nextGroup) throw new Error('Bu okuma grubu bulunamadı.')

      const [nextMembers, nextBooks, nextAnnotations, nextOwnedBooks] = await Promise.all([
        requestJson<Member[]>(`/api/reading-groups/${encodeURIComponent(groupId)}/members`),
        requestJson<GroupBook[]>(`/api/reading-groups/${encodeURIComponent(groupId)}/books`),
        requestJson<GroupAnnotation[]>(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations`),
        requestJson<OwnedBook[]>('/api/books').catch(() => []),
      ])
      setGroup(nextGroup)
      setMembers(nextMembers)
      setBooks(nextBooks)
      setOwnedBooks(nextOwnedBooks)
      setAnnotations(nextAnnotations)
      setAnnotationBookId(current => current || String(nextBooks[0]?.id || ''))
      setShareBookId(current => current || String(nextOwnedBooks.find(book => !book.is_encrypted && !nextBooks.some(shared => shared.id === book.id))?.id || ''))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Grup yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const currentMember = useMemo(() => members.find(member => (
    (sessionUser?.id !== undefined && member.user_id === sessionUser.id) || member.username === sessionUser?.username
  )), [members, sessionUser])
  const role = currentMember?.role || (group && sessionUser?.id === group.owner_user_id ? 'owner' : null)
  const isOwner = canManageGroup(role)
  const sharedBookIds = useMemo(() => new Set(books.map(book => book.id)), [books])
  const shareableBooks = useMemo(() => ownedBooks.filter(book => !book.is_encrypted && !sharedBookIds.has(book.id)), [ownedBooks, sharedBookIds])
  const bookById = useMemo(() => new Map(books.map(book => [book.id, book])), [books])
  const sharedAnnotations = useMemo(() => annotations.filter(annotation => annotation.visibility === 'group'), [annotations])
  const privateAnnotations = useMemo(() => annotations.filter(annotation => annotation.visibility === 'private'), [annotations])

  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.')
  }

  async function addMember(event: FormEvent) {
    event.preventDefault()
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: memberUsername }),
      })
      setMemberUsername('')
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function removeMember(userId: number, username: string) {
    if (!window.confirm(`${username} grubun üyelerinden çıkarılsın mı?`)) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/members?user_id=${userId}`, { method: 'DELETE' })
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function shareBook(event: FormEvent) {
    event.preventDefault()
    if (!shareBookId) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/books`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book_id: Number(shareBookId) }),
      })
      setShareBookId('')
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function removeBook(book: GroupBook) {
    if (!window.confirm(`“${book.title}” gruptan kaldırılsın mı?`)) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/books?book_id=${book.id}`, { method: 'DELETE' })
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function createAnnotation(event: FormEvent) {
    event.preventDefault()
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: Number(annotationBookId), page: Number(annotationPage), type: 'note', content: { note: annotationContent }, visibility: annotationVisibility }),
      })
      setAnnotationContent('')
      setAnnotationPage('1')
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function updateAnnotationVisibility(annotation: GroupAnnotation, visibility: 'group' | 'private') {
    if (annotation.visibility === visibility) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: annotation.id, visibility }),
      })
      await load()
    } catch (cause) { reportError(cause) }
  }

  async function removeAnnotation(annotation: GroupAnnotation) {
    if (!window.confirm('Bu grup notu ve yanıtları silinsin mi?')) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations?id=${annotation.id}`, { method: 'DELETE' })
      await load()
    } catch (cause) { reportError(cause) }
  }

  const loadReplies = useCallback(async (annotationId: number) => {
    setReplyStates(current => ({ ...current, [annotationId]: { open: true, loading: true, items: current[annotationId]?.items || [] } }))
    try {
      const items = await requestJson<GroupReply[]>(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations/${annotationId}/replies`)
      setReplyStates(current => ({ ...current, [annotationId]: { open: true, loading: false, items } }))
    } catch (cause) {
      reportError(cause)
      setReplyStates(current => ({ ...current, [annotationId]: { open: true, loading: false, items: current[annotationId]?.items || [] } }))
    }
  }, [groupId])

  async function toggleReplies(annotationId: number) {
    if (replyStates[annotationId]?.open) {
      setReplyStates(current => ({ ...current, [annotationId]: { ...current[annotationId], open: false } }))
      return
    }
    await loadReplies(annotationId)
  }

  async function addReply(annotationId: number, event: FormEvent) {
    event.preventDefault()
    const content = (replyDrafts[annotationId] || '').trim()
    if (!content) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations/${annotationId}/replies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
      })
      setReplyDrafts(current => ({ ...current, [annotationId]: '' }))
      await loadReplies(annotationId)
    } catch (cause) { reportError(cause) }
  }

  async function removeReply(annotationId: number, reply: GroupReply) {
    if (!window.confirm('Bu yanıt silinsin mi?')) return
    try {
      await requestJson(`/api/reading-groups/${encodeURIComponent(groupId)}/annotations/${annotationId}/replies?id=${reply.id}`, { method: 'DELETE' })
      await loadReplies(annotationId)
    } catch (cause) { reportError(cause) }
  }

  function renderAnnotation(annotation: GroupAnnotation) {
    const book = bookById.get(annotation.book_id)
    const replyState = replyStates[annotation.id]
    const canDelete = canDeleteGroupAnnotation(annotation, sessionUser?.id, role)
    return (
      <article key={annotation.id} className={`rounded-2xl border p-4 ${th.bookCard}`}>
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${th.heroBadge}`}>{initials(annotation.author_username)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={`font-bold ${th.cardText}`}>{annotation.author_username}</h4>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${th.cardBadge}`}>{annotation.type}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${annotation.visibility === 'private' ? th.cardBadge : th.heroBadge}`}>
                {annotation.visibility === 'private' ? <LockKeyhole size={11} /> : <Globe2 size={11} />}
                {annotation.visibility === 'private' ? 'Özel' : 'Grup'}
              </span>
            </div>
            <p className={`mt-1 text-xs ${th.cardMuted}`}>{book?.title || 'Kitap'} · sayfa {annotation.page} · {formatDate(annotation.created_at)}</p>
          </div>
          {canDelete && <button type="button" onClick={() => { void removeAnnotation(annotation) }} className={`rounded-lg p-2 ${th.actionDel}`} title="Notu sil" aria-label="Notu sil"><Trash2 size={15} /></button>}
        </div>
        <p className={`mt-4 whitespace-pre-wrap text-sm leading-6 ${th.cardSub}`}>{annotationText(annotation.content) || 'Bu notta metin yok.'}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {book && <Link href={sourceHref(book.id, annotation.page)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold ${th.heroSecondary}`}><Link2 size={14} />Kaynağı aç</Link>}
          {(annotation.author_user_id === sessionUser?.id || isOwner) && (
            <label className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${th.input}`}>
              Görünürlük
              <select value={annotation.visibility} onChange={event => { void updateAnnotationVisibility(annotation, event.target.value as 'group' | 'private') }} className="bg-transparent outline-none">
                <option value="group">Grup</option>
                <option value="private">Özel</option>
              </select>
            </label>
          )}
          <button type="button" onClick={() => { void toggleReplies(annotation.id) }} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold ${th.heroSecondary}`}>
            <MessageCircle size={14} />Yanıtlar {replyState?.open ? <ChevronDown size={14} className="rotate-180" /> : <ChevronDown size={14} />}
          </button>
        </div>
        {replyState?.open && (
          <div className={`mt-4 rounded-xl border p-3 ${th.emptyPanel}`}>
            {replyState.loading ? <p className={`text-xs ${th.cardMuted}`}>Yanıtlar yükleniyor…</p> : replyState.items.length === 0 ? <p className={`text-xs ${th.cardMuted}`}>Henüz yanıt yok.</p> : <div className="space-y-3">
              {replyState.items.map(reply => {
                const canDeleteReply = canDeleteGroupReply(reply, sessionUser?.id, role)
                return <div key={reply.id} className="flex items-start gap-2"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${th.cardBadge}`}>{initials(reply.author_username || 'Üye')}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`text-xs font-bold ${th.cardText}`}>{reply.author_username || 'Üye'}</span><span className={`text-[10px] ${th.cardMuted}`}>{formatDate(reply.created_at)}</span></div><p className={`mt-1 whitespace-pre-wrap text-xs leading-5 ${th.cardSub}`}>{reply.content}</p></div>{canDeleteReply && <button type="button" onClick={() => { void removeReply(annotation.id, reply) }} className={`rounded-lg p-1.5 ${th.actionDel}`} title="Yanıtı sil" aria-label="Yanıtı sil"><Trash2 size={13} /></button>}</div>
              })}
            </div>}
            <form onSubmit={event => { void addReply(annotation.id, event) }} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input value={replyDrafts[annotation.id] || ''} onChange={event => setReplyDrafts(current => ({ ...current, [annotation.id]: event.target.value }))} maxLength={2000} placeholder="Yanıt yaz…" className={`min-h-10 min-w-0 flex-1 rounded-lg border px-3 text-xs ${th.input}`} />
              <button type="submit" className={`min-h-10 rounded-lg px-3 text-xs font-bold ${th.addBtn}`}>Yanıtla</button>
            </form>
          </div>
        )}
      </article>
    )
  }

  if (loading && !group) {
    return <LibraryPageShell title="Okuma grubu" subtitle="Güvenli ortak okuma alanı" backHref="/groups" libraryTheme={libraryTheme} active="groups"><p className={`rounded-2xl border p-8 text-sm ${th.card} ${th.cardMuted}`}>Grup yükleniyor…</p></LibraryPageShell>
  }

  return (
    <LibraryPageShell title={group?.name || 'Okuma grubu'} subtitle={group?.description || 'Üyeler, kitaplar ve ortak notlar'} backHref="/groups" libraryTheme={libraryTheme} active="groups">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/groups" className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold ${th.heroSecondary}`}>← Gruplara dön</Link>
        <div className="flex items-center gap-2"><SyncStatusBadge compact={false} /><LanguageSwitcher compact /></div>
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">{error}</div>}
      {!group ? <section className={`rounded-2xl border p-8 text-center ${th.card}`}><Users className={`mx-auto ${th.cardMuted}`} size={30} /><h2 className={`mt-3 text-lg font-black ${th.cardText}`}>Grup bulunamadı</h2><p className={`mt-1 text-sm ${th.cardMuted}`}>Bu gruba erişiminiz olmayabilir veya bağlantı geçersiz.</p></section> : <>
        <section className={`rounded-2xl border p-5 shadow-[0_24px_80px_var(--lib-shadow)] ${th.heroPanel}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${th.heroBadge}`}><Users size={13} />{isOwner ? 'Grup sahibi' : 'Grup üyesi'}</div><h2 className={`text-2xl font-black tracking-tight sm:text-3xl ${th.title}`}>{group.name}</h2><p className={`mt-2 max-w-2xl text-sm leading-6 ${th.subtitle}`}>{group.description || 'Bu grup için henüz açıklama eklenmemiş.'}</p></div>
            <div className="grid grid-cols-2 gap-2 sm:min-w-56"><div className={`rounded-xl border p-3 ${th.card}`}><p className={`text-[10px] font-bold uppercase tracking-wide ${th.cardMuted}`}>Üye</p><p className={`mt-1 text-xl font-black ${th.cardText}`}>{members.length}</p></div><div className={`rounded-xl border p-3 ${th.card}`}><p className={`text-[10px] font-bold uppercase tracking-wide ${th.cardMuted}`}>Kitap</p><p className={`mt-1 text-xl font-black ${th.cardText}`}>{books.length}</p></div></div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className={`rounded-2xl border p-5 shadow-[0_18px_60px_var(--lib-shadow)] ${th.card}`}>
            <div className="flex items-center justify-between gap-3"><div><h3 className={`text-lg font-black ${th.cardText}`}>Üyeler</h3><p className={`mt-1 text-xs ${th.cardMuted}`}>Grup erişimi olan hesaplar</p></div><Users size={20} className={th.cardMuted} /></div>
            <div className="mt-4 space-y-2">{members.map(member => <div key={member.user_id} className={`flex items-center gap-3 rounded-xl border p-3 ${th.emptyPanel}`}><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${member.role === 'owner' ? th.heroBadge : th.cardBadge}`}>{initials(member.username)}</div><div className="min-w-0 flex-1"><p className={`truncate text-sm font-bold ${th.cardText}`}>{member.username}</p><p className={`text-[10px] ${th.cardMuted}`}>{member.role === 'owner' ? 'Sahip' : 'Üye'} · {formatDate(member.created_at)}</p></div>{isOwner && member.role === 'member' && <button type="button" onClick={() => { void removeMember(member.user_id, member.username) }} className={`rounded-lg p-2 ${th.actionDel}`} title="Üyeyi çıkar" aria-label={`${member.username} üyesini çıkar`}><UserMinus size={15} /></button>}</div>)}</div>
            {isOwner && <form onSubmit={addMember} className={`mt-4 rounded-xl border p-3 ${th.emptyPanel}`}><label className={`text-xs font-bold ${th.cardMuted}`}>Kullanıcı adıyla üye ekle<input required maxLength={80} value={memberUsername} onChange={event => setMemberUsername(event.target.value)} placeholder="kullanıcı adı" className={`mt-2 min-h-11 w-full rounded-lg border px-3 text-sm ${th.input}`} /></label><button type="submit" className={`mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold ${th.addBtn}`}><Plus size={14} />Üye ekle</button></form>}
          </section>

          <section className={`rounded-2xl border p-5 shadow-[0_18px_60px_var(--lib-shadow)] ${th.card}`}>
            <div className="flex items-center justify-between gap-3"><div><h3 className={`text-lg font-black ${th.cardText}`}>Paylaşılan kitaplar</h3><p className={`mt-1 text-xs ${th.cardMuted}`}>Yalnızca grup sahibi kendi kitaplarını ekleyebilir.</p></div><BookOpen size={20} className={th.cardMuted} /></div>
            {books.length === 0 ? <p className={`mt-4 rounded-xl border p-4 text-sm ${th.emptyPanel} ${th.cardMuted}`}>Henüz paylaşılmış kitap yok.</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{books.map(book => <div key={book.id} className={`rounded-xl border p-3 ${th.bookCard}`}><div className="flex items-start gap-3"><div className={`flex h-12 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${th.heroBadge}`}>{initials(book.title)}</div><div className="min-w-0 flex-1"><h4 className={`line-clamp-2 text-sm font-bold ${th.cardText}`}>{book.title}</h4><p className={`mt-1 truncate text-xs ${th.cardSub}`}>{book.author || 'Yazar belirtilmemiş'}</p><p className={`mt-1 text-[10px] ${th.cardMuted}`}>{book.total_pages ? `${book.total_pages} sayfa` : 'Sayfa bilgisi yok'}</p></div></div><div className="mt-3 flex flex-wrap gap-2"><Link href={`/reader/${book.id}`} className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold ${th.heroSecondary}`}><ExternalLink size={12} />Kaynağı aç</Link>{isOwner && <button type="button" onClick={() => { void removeBook(book) }} className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold ${th.actionDel}`}><Trash2 size={12} />Kaldır</button>}</div></div>)}</div>}
            {isOwner && <form onSubmit={shareBook} className={`mt-4 rounded-xl border p-3 ${th.emptyPanel}`}><label className={`text-xs font-bold ${th.cardMuted}`}>Kütüphanenden kitap paylaş<select required value={shareBookId} onChange={event => setShareBookId(event.target.value)} className={`mt-2 min-h-11 w-full rounded-lg border px-3 text-sm ${th.select}`}><option value="">Kitap seç…</option>{shareableBooks.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>{shareableBooks.length === 0 && <p className={`mt-2 text-[11px] ${th.cardMuted}`}>Paylaşılabilir şifresiz kitap kalmadı. Şifreli kitaplar grup paylaşımına kapalıdır.</p>}<button type="submit" disabled={!shareBookId} className={`mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${th.addBtn}`}><Plus size={14} />Kitabı paylaş</button></form>}
          </section>
        </div>

        <section className={`mt-4 rounded-2xl border p-5 shadow-[0_18px_60px_var(--lib-shadow)] ${th.card}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className={`text-lg font-black ${th.cardText}`}>Grup notları</h3><p className={`mt-1 text-xs ${th.cardMuted}`}>Notları grup üyeleriyle paylaşabilir veya yalnızca kendin için saklayabilirsin.</p></div><div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold ${th.cardBadge}`}><LockKeyhole size={12} />Özel notlar yalnızca yazarına görünür</div></div>
          <form onSubmit={createAnnotation} className={`mt-4 rounded-2xl border p-4 ${th.emptyPanel}`}><div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_7rem_8rem]"><label className={`text-xs font-bold ${th.cardMuted}`}>Kitap<select required value={annotationBookId} onChange={event => setAnnotationBookId(event.target.value)} className={`mt-2 min-h-11 w-full rounded-lg border px-3 text-sm ${th.select}`}><option value="">Kitap seç…</option>{books.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label><label className={`text-xs font-bold ${th.cardMuted}`}>Sayfa<input required min={1} max={100000} type="number" value={annotationPage} onChange={event => setAnnotationPage(event.target.value)} className={`mt-2 min-h-11 w-full rounded-lg border px-3 text-sm ${th.input}`} /></label><label className={`text-xs font-bold ${th.cardMuted}`}>Görünürlük<select value={annotationVisibility} onChange={event => setAnnotationVisibility(event.target.value as 'group' | 'private')} className={`mt-2 min-h-11 w-full rounded-lg border px-3 text-sm ${th.select}`}><option value="group">Grup</option><option value="private">Özel</option></select></label></div><label className={`mt-3 block text-xs font-bold ${th.cardMuted}`}>Not<textarea required minLength={1} maxLength={10000} value={annotationContent} onChange={event => setAnnotationContent(event.target.value)} placeholder="Bu sayfada neyi tartışmak istiyorsun?" className={`mt-2 min-h-24 w-full rounded-lg border p-3 text-sm ${th.input}`} /></label><button type="submit" disabled={!annotationBookId || !annotationContent.trim()} className={`mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${th.addBtn}`}><Plus size={14} />Not ekle</button></form>

          <div className="mt-5 grid gap-5 xl:grid-cols-2"><div><div className="mb-3 flex items-center gap-2"><Globe2 size={16} className={th.cardSource} /><h4 className={`font-bold ${th.cardText}`}>Paylaşılan notlar <span className={`text-xs font-normal ${th.cardMuted}`}>({sharedAnnotations.length})</span></h4></div>{sharedAnnotations.length === 0 ? <p className={`rounded-xl border p-4 text-sm ${th.emptyPanel} ${th.cardMuted}`}>Henüz grup notu yok.</p> : <div className="space-y-3">{sharedAnnotations.map(renderAnnotation)}</div>}</div><div><div className="mb-3 flex items-center gap-2"><LockKeyhole size={16} className={th.cardMuted} /><h4 className={`font-bold ${th.cardText}`}>Özel notların <span className={`text-xs font-normal ${th.cardMuted}`}>({privateAnnotations.length})</span></h4></div>{privateAnnotations.length === 0 ? <p className={`rounded-xl border p-4 text-sm ${th.emptyPanel} ${th.cardMuted}`}>Bu grupta özel notun yok.</p> : <div className="space-y-3">{privateAnnotations.map(renderAnnotation)}</div>}</div></div>
        </section>
        <p className={`mt-4 flex items-start gap-2 text-xs leading-5 ${th.cardMuted}`}><LockKeyhole size={14} className="mt-0.5 shrink-0" />Kişisel notların otomatik paylaşılmaz. Grup bağlantıları yalnızca bu gruba üyeliği olan hesaplar için çalışır.</p>
      </>}
    </LibraryPageShell>
  )
}
