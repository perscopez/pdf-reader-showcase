'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users,
  BookOpen,
  Shield,
  Trash2,
  Key,
  Search,
  RefreshCw,
  HardDrive,
  Bug,
  Sparkles,
  UserCheck,
  UserX,
  FileText,
  CheckCircle2,
  Copy,
  FolderOpen,
  Send,
} from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { useI18n } from '@/components/I18nProvider'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { getLibraryThemeStyle, LIBRARY_THEME } from '@/lib/libraryTheme'
import { ToastContainer, useToast } from '@/components/Toast'
import { getAssetUrl } from '@/lib/api'
import BookTransferModal from '@/components/BookTransferModal'
import { useSession } from '@/components/SessionProvider'

type AdminUser = {
  id: number
  username: string
  role: string
  is_test: number
  email: string | null
  is_email_verified: number
  created_at: string
  book_count: number
}

type AdminBook = {
  id: number
  user_id: number
  username: string
  title: string
  author: string
  category: string
  filename: string
  filepath: string
  thumbnail: string | null
  total_pages: number
  favorite: number
  created_at: string
}

type AdminStats = {
  totalUsers: number
  totalBooks: number
  totalAnnotations: number
  dbSizeBytes: number
}

export default function AdminPage() {
  const { t } = useI18n()
  const router = useRouter()
  const { messages, toast, remove } = useToast()
  const libraryTheme = useLibraryTheme()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [currentUser, setCurrentUser] = useState<{ id: number; username: string; role: string } | null>(null)
  const { user: sessionUser, loading: sessionLoading } = useSession()

  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [books, setBooks] = useState<AdminBook[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)

  const [activeTab, setActiveTab] = useState<'users' | 'books' | 'system'>('users')
  const [searchQuery, setSearchQuery] = useState('')

  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [transferBookIds, setTransferBookIds] = useState<number[]>([])
  const [transferBookTitles, setTransferBookTitles] = useState<string[]>([])

  const handleOpenTransferModal = (ids: number[]) => {
    const selectedBooks = books.filter(b => ids.includes(b.id))
    setTransferBookIds(ids)
    setTransferBookTitles(selectedBooks.map(b => b.title))
    setTransferModalOpen(true)
  }

  // Modals state
  const [passwordModalUser, setPasswordModalUser] = useState<AdminUser | null>(null)
  const [userBooksModalUser, setUserBooksModalUser] = useState<AdminUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  const th = LIBRARY_THEME[libraryTheme]

  const loadAdminData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) {
        if (res.status === 403) router.replace('/')
        return
      }
      const data = await res.json()
      if (data.success) {
        setUsers(data.users || [])
        setBooks(data.books || [])
        setStats(data.stats || null)
      }
    } catch {
      toast('Yönetim verileri yüklenirken hata oluştu', 'error')
    } finally {
      setLoading(false)
    }
  }, [router, toast])

  useEffect(() => {
    if (sessionLoading) return
    if (sessionUser?.role === 'admin') {
      const timer = window.setTimeout(() => {
        setCurrentUser({ id: Number(sessionUser.id || 0), username: sessionUser.username, role: sessionUser.role })
        setAllowed(true)
        void loadAdminData()
      }, 0)
      return () => window.clearTimeout(timer)
    } else {
      router.replace('/')
    }
  }, [loadAdminData, router, sessionLoading, sessionUser])

  const handleRoleChange = async (targetUser: AdminUser, newRole: string) => {
    if (targetUser.username === 'owner') {
      toast('Ana yönetici (owner) rolü değiştirilemez!', 'error')
      return
    }

    if (!confirm(`${targetUser.username} kullanıcısının rolünü ${newRole.toUpperCase()} yapmak istediğinize emin misiniz?`)) {
      return
    }

    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_role', targetUserId: targetUser.id, role: newRole }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'Rol güncellendi', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleToggleVerifyEmail = async (targetUser: AdminUser) => {
    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_verify_email', targetUserId: targetUser.id }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'E-posta doğrulama durumu güncellendi', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleResetPassword = async () => {
    if (!passwordModalUser) return
    if (!newPassword || newPassword.trim().length < 4) {
      toast('Şifre en az 4 karakter olmalıdır', 'error')
      return
    }

    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', targetUserId: passwordModalUser.id, newPassword }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'Şifre başarıyla yenilendi', 'success')
        setPasswordModalUser(null)
        setNewPassword('')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleDeleteUser = async (targetUser: AdminUser) => {
    if (targetUser.username === 'owner') {
      toast('Ana yönetici hesabı silinemez!', 'error')
      return
    }
    if (targetUser.id === currentUser?.id) {
      toast('Kendi hesabınızı silemezsiniz!', 'error')
      return
    }

    if (!confirm(`DİKKAT: "${targetUser.username}" kullanıcısını ve bu kullanıcıya ait TÜM KİTAPLARI silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`)) {
      return
    }

    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_user', targetUserId: targetUser.id }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'Kullanıcı silindi', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const triggerBulkReindex = async () => {
    if (!confirm('Tüm kütüphaneyi yeniden indekslemek ve arama dizinlerini güncellemek istiyor musunuz?')) return
    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/reindex', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        toast('Tüm kitaplar başarıyla yeniden indekslendi!', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İndeksleme başarısız', 'error')
      }
    } catch {
      toast('İndeksleme hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleDistributeOwnerBooks = async () => {
    if (!confirm('Owner hesabındaki tüm kitapları diğer kullanıcılara (annotasyonsuz, sıfır ekstra disk alanıyla) kopyalamak istiyor musunuz?')) return
    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'distribute_owner_books', targetUserId: 1 }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'Kitaplar aktarıldı!', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleDistributeToSingleUser = async (targetUser: AdminUser) => {
    if (!confirm(`Tüm owner kitapları ${targetUser.username} kullanıcısının kütüphanesine kopyalansın mı?`)) return
    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'distribute_to_single_user', userId: targetUser.id }),
      })
      const data = await res.json()
      if (data.success) {
        toast(data.message || `Kitaplar ${targetUser.username} kullanıcısına aktarıldı.`, 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız.', 'error')
      }
    } catch {
      toast('Sunucu hatası.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleEnrichSingleBook = async (bookId: number) => {
    setActionBusy(true)
    try {
      const res = await fetch('/api/books/enrich-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      const data = await res.json()
      if (data.updatedCount > 0 && data.updatedBooks?.[0]?.changes) {
        toast(`Metaveri İyileştirildi: ${data.updatedBooks[0].changes.join(' • ')}`, 'success')
      } else {
        toast('Kitap metaverileri zaten güncel.', 'info')
      }
      await loadAdminData()
    } catch {
      toast('Metaveri iyileştirme sırasında hata oluştu.', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const handleRemoveUserBook = async (targetUser: AdminUser, bookId: number) => {
    if (!confirm('Bu kitabı kullanıcının kütüphanesinden kaldırmak istediğinize emin misiniz?')) return
    setActionBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_user_book', targetUserId: targetUser.id, targetBookId: bookId }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast(data.message || 'Kitap hesaptan kaldırıldı', 'success')
        await loadAdminData()
      } else {
        toast(data.error || 'İşlem başarısız', 'error')
      }
    } catch {
      toast('Sunucu hatası', 'error')
    } finally {
      setActionBusy(false)
    }
  }

  if (allowed !== true) {
    return (
      <div style={getLibraryThemeStyle(libraryTheme) as React.CSSProperties} className={`library-page flex min-h-screen items-center justify-center ${th.bg} ${th.cardMuted}`}>
        {t('common.loading')}
      </div>
    )
  }

  const filteredUsers = users.filter(
    u => u.username.toLowerCase().includes(searchQuery.toLowerCase()) || (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const filteredBooks = books.filter(
    b =>
      b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedUserBooks = userBooksModalUser ? books.filter(b => b.user_id === userBooksModalUser.id) : []

  return (
    <LibraryPageShell
      title="Sistem Yönetim Paneli"
      subtitle="Kullanıcıları, kütüphanedeki tüm kitapları ve sistem sağlık durumunu yönetin"
      libraryTheme={libraryTheme}
      active="admin"
      showBackups={currentUser?.username === 'owner'}
      showBugs
      showAdmin
    >
      <ToastContainer messages={messages} onRemove={remove} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
              activeTab === 'users'
                ? th.filterActive
                : th.filterInactive
            }`}
          >
            <Users size={15} />
            Kullanıcılar ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('books')}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
              activeTab === 'books'
                ? th.filterActive
                : th.filterInactive
            }`}
          >
            <BookOpen size={15} />
            Tüm Kitaplar ({books.length})
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all ${
              activeTab === 'system'
                ? th.filterActive
                : th.filterInactive
            }`}
          >
            <Shield size={15} />
            Sistem Durumu
          </button>
        </div>

        <div className="flex items-center gap-2">
          <SyncStatusBadge compact={false} />
          <LanguageSwitcher compact />
          <button
            onClick={loadAdminData}
            disabled={loading}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${th.filterInactive}`}
            title="Yenile"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Header Bar */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={`rounded-2xl border p-4 backdrop-blur-xl ${th.card}`}>
            <div className={`flex items-center justify-between text-xs ${th.cardMuted}`}>
              <span>Toplam Kullanıcı</span>
              <Users size={16} className="text-[var(--lib-accent-soft)]" />
            </div>
            <p className={`mt-2 text-2xl font-black ${th.cardText}`}>{stats.totalUsers}</p>
          </div>
          <div className={`rounded-2xl border p-4 backdrop-blur-xl ${th.card}`}>
            <div className={`flex items-center justify-between text-xs ${th.cardMuted}`}>
              <span>Toplam Kitap</span>
              <BookOpen size={16} className="text-[var(--lib-accent-soft)]" />
            </div>
            <p className={`mt-2 text-2xl font-black ${th.cardText}`}>{stats.totalBooks}</p>
          </div>
          <div className={`rounded-2xl border p-4 backdrop-blur-xl ${th.card}`}>
            <div className={`flex items-center justify-between text-xs ${th.cardMuted}`}>
              <span>Alıntı / Notlar</span>
              <FileText size={16} className="text-[var(--lib-accent-soft)]" />
            </div>
            <p className={`mt-2 text-2xl font-black ${th.cardText}`}>{stats.totalAnnotations}</p>
          </div>
          <div className={`rounded-2xl border p-4 backdrop-blur-xl ${th.card}`}>
            <div className={`flex items-center justify-between text-xs ${th.cardMuted}`}>
              <span>Veritabanı</span>
              <HardDrive size={16} className="text-[var(--lib-accent-soft)]" />
            </div>
            <p className={`mt-2 text-2xl font-black ${th.cardText}`}>
              {(stats.dbSizeBytes / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
        </div>
      )}

      {/* Search Input */}
      {activeTab !== 'system' && (
        <div className="mb-4 relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--lib-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'users' ? 'Kullanıcı adı veya e-posta ile ara...' : 'Kitap başlığı, yazar veya yükleyen ile ara...'}
            className={`w-full rounded-xl border py-2.5 pl-10 pr-4 text-xs outline-none ${th.input}`}
          />
        </div>
      )}

      {/* TAB 1: USERS */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          {filteredUsers.length === 0 ? (
            <div className={`rounded-2xl border p-8 text-center text-xs ${th.emptyPanel} ${th.cardMuted}`}>
              Kullanıcı bulunamadı.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredUsers.map(userItem => {
                const isAdmin = userItem.role === 'admin'
                const isOwner = userItem.username === 'owner'
                const isVerified = Boolean(userItem.is_email_verified)
                return (
                  <div
                    key={userItem.id}
                    className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all ${
                      isAdmin
                        ? 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)]'
                        : th.card
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border font-black uppercase text-sm ${
                          isAdmin ? 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]' : 'border-[var(--lib-border-strong)] bg-[var(--lib-surface-muted)] text-[var(--lib-text)]'
                        }`}>
                          {userItem.username.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`truncate text-sm font-bold ${th.cardText}`}>{userItem.username}</p>
                            {isAdmin && (
                              <span className="rounded-md border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--lib-accent-soft)]">
                                {isOwner ? 'OWNER' : 'ADMIN'}
                              </span>
                            )}
                          </div>
                          <p className={`truncate text-[11px] ${th.cardMuted}`}>
                            {userItem.email || 'E-posta tanımlı değil'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className={`mt-4 flex items-center justify-between border-t border-[var(--lib-border)] pt-3 text-xs ${th.cardMuted}`}>
                      <div>
                        <span className={`font-semibold ${th.cardText}`}>{userItem.book_count}</span> kitap
                      </div>
                      <div className="text-[11px] opacity-75">
                        Kayıt: {userItem.created_at ? new Date(userItem.created_at).toLocaleDateString('tr-TR') : '-'}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-[var(--lib-border)] pt-2.5">
                      <button
                        onClick={() => setUserBooksModalUser(userItem)}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${th.filterInactive}`}
                        title="Kitapları Yönet / İncele"
                      >
                        <FolderOpen size={13} />
                        Kitaplar ({userItem.book_count})
                      </button>

                      <button
                        onClick={() => handleToggleVerifyEmail(userItem)}
                        disabled={actionBusy}
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all ${
                          isVerified
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]'
                        }`}
                        title={isVerified ? 'E-posta Doğrulanmış' : 'E-posta Doğrula / Kilidi Kaldır'}
                      >
                        <CheckCircle2 size={13} />
                        {isVerified ? 'Doğrulanmış' : 'Doğrula'}
                      </button>

                      {!isOwner && (
                        <button
                          onClick={() => handleRoleChange(userItem, isAdmin ? 'user' : 'admin')}
                          disabled={actionBusy}
                          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-all ${
                            isAdmin
                              ? 'border-[var(--lib-border)] bg-[var(--lib-surface-muted)] text-[var(--lib-text-secondary)]'
                              : 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]'
                          }`}
                          title={isAdmin ? 'Normal Kullanıcı Yap' : 'Admin Yap'}
                        >
                          {isAdmin ? <UserX size={13} /> : <UserCheck size={13} />}
                          {isAdmin ? 'User Yap' : 'Admin Yap'}
                        </button>
                      )}
                      <button
                        onClick={() => setPasswordModalUser(userItem)}
                        disabled={actionBusy}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${th.filterInactive}`}
                        title="Şifre Sıfırla"
                      >
                        <Key size={13} />
                        Şifre
                      </button>
                      {!isOwner && userItem.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDeleteUser(userItem)}
                          disabled={actionBusy}
                          className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                          title="Kullanıcıyı Sil"
                        >
                          <Trash2 size={13} />
                          Sil
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BOOKS */}
      {activeTab === 'books' && (
        <div className="space-y-2">
          {filteredBooks.length === 0 ? (
            <div className={`rounded-2xl border p-8 text-center text-xs ${th.emptyPanel} ${th.cardMuted}`}>
              Kitap bulunamadı.
            </div>
          ) : (
            <div className={`overflow-x-auto rounded-2xl border ${th.card}`}>
              <table className={`w-full text-left text-xs ${th.cardSub}`}>
                <thead className="border-b border-[var(--lib-border)] bg-[var(--lib-surface-subtle)] font-medium text-[var(--lib-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Kapak</th>
                    <th className="px-4 py-3">Başlık</th>
                    <th className="px-4 py-3">Yazar</th>
                    <th className="px-4 py-3">Yükleyen</th>
                    <th className="px-4 py-3">Sayfa</th>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--lib-border)]">
                  {filteredBooks.map(book => (
                    <tr key={book.id} className="hover:bg-[var(--lib-surface-subtle)]">
                      <td className="px-4 py-2">
                        <div className="flex h-12 w-9 items-center justify-center overflow-hidden rounded border border-[var(--lib-border)] bg-[var(--lib-surface-muted)]">
                          {book.thumbnail ? (
                            <img src={getAssetUrl(book.thumbnail)} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <BookOpen size={16} className="text-[var(--lib-text-muted)]" />
                          )}
                        </div>
                      </td>
                      <td className={`max-w-xs truncate px-4 py-3 font-semibold ${th.cardText}`}>{book.title}</td>
                      <td className={`max-w-xs truncate px-4 py-3 ${th.cardMuted}`}>{book.author || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-mono ${th.cardBadge}`}>
                          {book.username || `User #${book.user_id}`}
                        </span>
                      </td>
                      <td className={`px-4 py-3 ${th.cardMuted}`}>{book.total_pages || '-'}</td>
                      <td className={`px-4 py-3 text-[11px] ${th.bookMeta}`}>
                        {book.created_at ? new Date(book.created_at).toLocaleDateString('tr-TR') : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleEnrichSingleBook(book.id)}
                          disabled={actionBusy}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${th.filterInactive}`}
                          title="Google Books / Open Library ile metaveriyi otomatik iyileştir"
                        >
                          <Sparkles size={13} />
                          İyileştir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SYSTEM ACTIONS */}
      {activeTab === 'system' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={`rounded-2xl border p-5 backdrop-blur-xl ${th.card}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]">
                <Sparkles size={20} />
              </div>
              <div>
                <h4 className={`text-sm font-bold ${th.cardText}`}>Yeniden İndeksleme</h4>
                <p className={`text-xs ${th.cardMuted}`}>Kütüphanedeki tüm kitap metinlerini ve arama dizinlerini günceller</p>
              </div>
            </div>
            <button
              onClick={triggerBulkReindex}
              disabled={actionBusy}
              className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold ${th.filterActive}`}
            >
              Toplu Yeniden İndekslemeyi Başlat
            </button>
          </div>

          <div className={`rounded-2xl border p-5 backdrop-blur-xl ${th.card}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]">
                <Copy size={20} />
              </div>
              <div>
                <h4 className={`text-sm font-bold ${th.cardText}`}>Owner Kitaplarını Dağıt</h4>
                <p className={`text-xs ${th.cardMuted}`}>Owner hesabındaki tüm kitapları (notlar olmadan, 0 ekstra disk kullanımıyla) tüm kullanıcılara aktarır</p>
              </div>
            </div>
            <button
              onClick={handleDistributeOwnerBooks}
              disabled={actionBusy}
              className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold ${th.filterActive}`}
            >
              Kitapları Tüm Kullanıcılara Kopyala (Sıfır Ekstra Disk Alanı)
            </button>
          </div>

          <div className={`rounded-2xl border p-5 backdrop-blur-xl ${th.card}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]">
                <HardDrive size={20} />
              </div>
              <div>
                <h4 className={`text-sm font-bold ${th.cardText}`}>Sistem Yedekleme</h4>
                <p className={`text-xs ${th.cardMuted}`}>Veritabanı ve yüklenen kitapların yedeğini yönetin</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/backups')}
              className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold ${th.filterActive}`}
            >
              Yedekleme Paneline Git
            </button>
          </div>

          <div className={`rounded-2xl border p-5 backdrop-blur-xl ${th.card}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)] text-[var(--lib-accent-soft)]">
                <Bug size={20} />
              </div>
              <div>
                <h4 className={`text-sm font-bold ${th.cardText}`}>Hata Bildirimleri (Bugs)</h4>
                <p className={`text-xs ${th.cardMuted}`}>Kullanıcılardan gelen geribildirim ve hata raporları</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/bugs')}
              className={`mt-4 w-full rounded-xl py-2.5 text-xs font-bold ${th.filterActive}`}
            >
              Hata Raporlarını İncele
            </button>
          </div>
        </div>
      )}

      {/* USER BOOKS MANAGEMENT MODAL */}
      {userBooksModalUser && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className={`w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border p-5 shadow-2xl ${th.card} ${th.cardText}`}>
            <div className="flex items-center justify-between border-b border-[var(--lib-border)] pb-3">
              <div className="flex items-center gap-2">
                <FolderOpen size={18} className="text-[var(--lib-accent-soft)]" />
                <h3 className="font-bold text-sm">{userBooksModalUser.username} — Kütüphane Kitapları ({selectedUserBooks.length})</h3>
              </div>
              <button onClick={() => setUserBooksModalUser(null)} className="rounded-lg p-1 text-[var(--lib-text-muted)] hover:text-[var(--lib-text)]">
                ✕
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between border-b border-[var(--lib-border)] pb-3">
              <p className={`text-xs ${th.cardMuted}`}>Bu kullanıcının kütüphanesindeki tüm aktif kitaplar listeleniyor.</p>
              {userBooksModalUser.username !== 'owner' && (
                <button
                  onClick={() => handleDistributeToSingleUser(userBooksModalUser)}
                  disabled={actionBusy}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold ${th.filterActive}`}
                >
                  <Copy size={13} />
                  Owner Kitaplarını Bu Hesaba Kopyala
                </button>
              )}
            </div>

            <div className="mt-3 flex-1 overflow-y-auto space-y-2 pr-1">
              {selectedUserBooks.length === 0 ? (
                <div className={`p-8 text-center text-xs ${th.cardMuted}`}>
                  Bu kullanıcının kütüphanesinde henüz kitap yok.
                </div>
              ) : (
                selectedUserBooks.map(book => (
                  <div key={book.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${th.cardBadge}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--lib-border)] bg-[var(--lib-surface-muted)]">
                        {book.thumbnail ? (
                          <img src={getAssetUrl(book.thumbnail)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <BookOpen size={16} className="text-[var(--lib-text-muted)]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`truncate text-xs font-bold ${th.cardText}`}>{book.title}</p>
                        <p className={`truncate text-[11px] ${th.cardMuted}`}>{book.author || 'Yazar belirtilmedi'} • {book.total_pages || '?'} sayfa</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenTransferModal([book.id])}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${th.filterInactive}`}
                        title="Kitabı başka bir kullanıcıya anotasyonlu/anotasyonsuz gönder"
                      >
                        <Send size={13} />
                        Transfer
                      </button>
                      <button
                        onClick={() => handleRemoveUserBook(userBooksModalUser, book.id)}
                        disabled={actionBusy}
                        className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20"
                      >
                        <Trash2 size={13} />
                        Kaldır
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end border-t border-[var(--lib-border)] pt-3">
              <button
                onClick={() => setUserBooksModalUser(null)}
                className={`rounded-xl px-4 py-2 text-xs font-semibold ${th.filterInactive}`}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PASSWORD RESET MODAL */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className={`w-full max-w-md overflow-hidden rounded-2xl border p-5 shadow-2xl ${th.card} ${th.cardText}`}>
            <div className="flex items-center justify-between border-b border-[var(--lib-border)] pb-3">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-[var(--lib-accent-soft)]" />
                <h3 className="font-bold text-sm">Şifre Yenile - {passwordModalUser.username}</h3>
              </div>
              <button onClick={() => setPasswordModalUser(null)} className="rounded-lg p-1 text-[var(--lib-text-muted)] hover:text-[var(--lib-text)]">
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className={`mb-1 block text-xs font-semibold ${th.cardMuted}`}>Yeni Şifre</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="En az 4 karakter girin"
                  className={`w-full rounded-xl border p-2.5 text-xs outline-none ${th.input}`}
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setPasswordModalUser(null)}
                className={`rounded-xl px-4 py-2 text-xs font-semibold ${th.filterInactive}`}
              >
                İptal
              </button>
              <button
                onClick={handleResetPassword}
                disabled={actionBusy}
                className={`rounded-xl px-4 py-2 text-xs font-bold ${th.filterActive}`}
              >
                Şifreyi Güncelle
              </button>
            </div>
          </div>
        </div>
      )}

      <BookTransferModal
        isOpen={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        bookIds={transferBookIds}
        bookTitles={transferBookTitles}
        onSuccess={msg => {
          toast(msg, 'success')
          void loadAdminData()
        }}
        onError={err => toast(err, 'error')}
      />
    </LibraryPageShell>
  )
}
