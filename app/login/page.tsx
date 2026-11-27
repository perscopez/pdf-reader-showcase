'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  BookOpen,
  LockKeyhole,
  UserRound,
  Mail,
  Key,
  ShieldCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import ThreeLibraryBackground from '@/components/ThreeLibraryBackground'
import { useI18n } from '@/components/I18nProvider'
import { useVault } from '@/components/VaultContext'
import {
  generateSaltHex,
  generateVaultKey,
  deriveKeyFromPassword,
  deriveKeyFromRecoveryCode,
  wrapKey,
  unwrapKey,
  generateRecoveryCode,
  isValidRecoveryCode,
  createRecoveryVerifier,
} from '@/lib/crypto'
import { fetchWithTimeout } from '@/lib/request'
import { fetchJsonWithTimeout } from '@/lib/requestResilience'

// ─── Registration Helpers ─────────────────────────────────────────────────────

type I18nT = ReturnType<typeof useI18n>['t']

function registerErrorMessage(errorCode: unknown, t: I18nT) {
  if (errorCode === 'invalid_invite') return t('login.invalidInvite') || 'Geçersiz veya kullanılmış davet kodu.'
  if (errorCode === 'email_exists') return t('login.emailExists') || 'Bu e-posta adresi zaten kullanımda.'
  if (errorCode === 'Username already exists') return t('login.usernameExists') || 'Bu kullanıcı adı zaten alınmış.'
  if (errorCode === 'registration_temporarily_unavailable') return t('login.registrationUnavailable') || 'Kayıt şu anda kapalı. Daha sonra tekrar deneyin.'
  return t('login.failed')
}

// ─── Recovery Code Display Step ────────────────────────────────────────────────

interface RecoveryCodeStepProps {
  code: string
  onConfirmed: () => void
}

function RecoveryCodeStep({ code, onConfirmed }: RecoveryCodeStepProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  function handleDownload() {
    const blob = new Blob([`${t('login.appTitle')} — ${t('login.recoveryKeyTitle')}\n\n${code}\n\n${t('login.saveRecoveryKeyDesc')}`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kutuphane-kurtarma-kodu.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const words = code.split(' ')

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5">
        <p className="text-xs font-bold text-yellow-200">{t('login.saveRecoveryKey')}</p>
        <p className="mt-1 text-[11px] text-yellow-200/80">
          {t('login.saveRecoveryKeyDesc')}
        </p>
      </div>

      {/* Word Grid */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-black/30 p-3">
        {words.map((word, i) => (
          <div key={i} className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1.5">
            <span className="min-w-[18px] text-[9px] font-bold text-[#e50914]/70">{i + 1}.</span>
            <span className="text-[11px] font-mono font-semibold text-white/90">{word}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all liquid-glass-btn-secondary"
        >
          <Copy size={13} />
          {copied ? t('login.copied') : t('common.copy')}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold transition-all liquid-glass-btn-secondary"
        >
          <Download size={13} />
          {t('login.download')}
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition-all hover:bg-white/[0.06]">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded accent-[#e50914]"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
        />
        <span className="text-[11px] text-[#b3b3b3]">
          {t('login.confirmRecoverySaved')}
        </span>
      </label>

      <button
        type="button"
        disabled={!confirmed}
        onClick={onConfirmed}
        className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-40 liquid-glass-btn-primary"
        style={{ '--btn-color': '#10b981', '--btn-glow': 'rgba(16,185,129,0.55)' } as React.CSSProperties}
      >
        <ShieldCheck size={14} className="mr-2 inline-block" />
        {t('login.confirmAndCreate')}
      </button>
    </div>
  )
}

// ─── Recovery Flow ──────────────────────────────────────────────────────────────

interface RecoveryFlowProps {
  onBack: () => void
  onSuccess: () => void
}

function RecoveryFlow({ onBack, onSuccess }: RecoveryFlowProps) {
  const [username, setUsername] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [accountInfo, setAccountInfo] = useState<{ exists: boolean; hasRecoveryKey: boolean; notice: string | null } | null>(null)
  const { setVaultKey } = useVault()
  const { t } = useI18n()

  useEffect(() => {
    const u = username.trim().toLowerCase()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!u) {
        setAccountInfo(null)
        return
      }
      fetchJsonWithTimeout<{ exists: boolean; hasEmail: boolean; isEmailVerified: boolean; hasRecoveryKey: boolean; notice: string | null }>(`/api/auth/check-account?username=${encodeURIComponent(u)}`, { signal: controller.signal }, 6_000)
        .then(({ response, data }) => {
          if (!response.ok) return setAccountInfo(null)
          if (data && data.exists) setAccountInfo(data)
          else setAccountInfo(null)
        })
        .catch(() => setAccountInfo(null))
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [username])

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const valid = await isValidRecoveryCode(recoveryCode)
      if (!valid) {
        setError(t('login.invalidRecoveryCode'))
        setLoading(false)
        return
      }

      const postRes = await fetch('/api/auth/recover-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })

      if (!postRes.ok) {
        const d = await postRes.json().catch(() => ({}))
        setError(d.error || 'Bu kullanıcı için kurtarma kodu mevcut değil.')
        setLoading(false)
        return
      }

      const { vaultSalt, recoveryWrappedVaultKey } = await postRes.json()
      const recoveryDerivedKey = await deriveKeyFromRecoveryCode(recoveryCode, vaultSalt)

      let vaultKey: CryptoKey
      try {
        vaultKey = await unwrapKey(recoveryWrappedVaultKey, recoveryDerivedKey)
      } catch {
        setError('Kurtarma kodu hatalı. Lütfen tekrar kontrol edin.')
        setLoading(false)
        return
      }

      const newVaultSalt = generateSaltHex(32)
      const newPasswordKey = await deriveKeyFromPassword(newPassword, newVaultSalt)
      const newRecoveryKey = await deriveKeyFromRecoveryCode(recoveryCode, newVaultSalt)

      const newWrappedVaultKey = await wrapKey(vaultKey, newPasswordKey)
      const newRecoveryWrappedVaultKey = await wrapKey(vaultKey, newRecoveryKey)
      const recoveryVerifier = await createRecoveryVerifier(recoveryCode)

      const patchRes = await fetch('/api/auth/recover-vault', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          newPassword,
          newVaultSalt,
          newWrappedVaultKey,
          newRecoveryWrappedVaultKey,
          recoveryVerifier,
        }),
      })

      if (!patchRes.ok) {
        const d = await patchRes.json().catch(() => ({}))
        setError(d.error || 'Şifre güncellenemedi.')
        setLoading(false)
        return
      }

      setVaultKey(vaultKey)
      onSuccess()
    } catch (err) {
      console.error('[RecoveryFlow]', err)
      setError('Kurtarma işlemi başarısız. Kodu ve kullanıcı adını kontrol edin.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleRecover} className="space-y-4">
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2.5">
        <p className="text-xs font-bold text-blue-200">{t('login.recoveryTitle')}</p>
        <p className="mt-1 text-[11px] text-blue-200/80">
          {t('login.recoverySubtitle')}
        </p>
      </div>

      {accountInfo && !accountInfo.hasRecoveryKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 backdrop-blur-md">
          <div className="flex items-center gap-2 font-bold text-amber-300">
            <AlertTriangle size={15} className="shrink-0 text-amber-400" />
            <span>{t('login.betaRestriction')}</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-200/80 leading-relaxed">
            {t('login.noRecoveryKey')}
          </p>
        </div>
      )}

      <div className="relative">
        <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder={t('login.username')}
          className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
          style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
        />
      </div>

      <textarea
        value={recoveryCode}
        onChange={e => setRecoveryCode(e.target.value)}
        placeholder={t('login.recoveryCodePlaceholder')}
        rows={3}
        className="w-full rounded-xl px-4 py-3 text-sm font-mono text-white outline-none placeholder:text-[#666] resize-none liquid-glass-input"
        style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
      />

      <div className="relative">
        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
        <input
          type={showPassword ? 'text' : 'password'}
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          placeholder={t('login.newPasswordPlaceholder')}
          minLength={8}
          className="w-full rounded-xl py-3 pl-10 pr-10 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
          style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => setShowPassword(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999] hover:text-white z-10"
        >
          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-200">{error}</p>}

      <button
        type="submit"
        disabled={loading || !username || !recoveryCode || newPassword.length < 8 || (accountInfo !== null && !accountInfo.hasRecoveryKey)}
        className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-40 liquid-glass-btn-primary"
        style={{ '--btn-color': '#e50914', '--btn-glow': 'rgba(229,9,20,0.55)' } as React.CSSProperties}
      >
        {loading ? t('login.resettingPassword') : t('login.resetPassword')}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-lg py-2 text-xs font-semibold text-[#d6d3d1]/80 hover:text-white transition-all hover:bg-white/[0.05]"
      >
        {t('login.backToLogin')}
      </button>
    </form>
  )
}

// ─── Main Login / Registration Component ────────────────────────────────────────

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [errorState, setErrorState] = useState('')
  const [successMessageState, setSuccessMessageState] = useState('')
  const [showResend, setShowResend] = useState(false)
  const [showRestore, setShowRestore] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const [accountInfo, setAccountInfo] = useState<{
    exists: boolean
    hasEmail: boolean
    isEmailVerified: boolean
    hasRecoveryKey: boolean
    notice: string | null
  } | null>(null)

  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null)
  const [pendingRegData, setPendingRegData] = useState<{
    username: string
    password: string
    email: string
    inviteCode: string
    vaultSalt: string
    wrappedVaultKey: string
    recoveryWrappedVaultKey: string
    recoveryVerifier: string
  } | null>(null)

  const { t } = useI18n()
  const { setVaultKey } = useVault()
  const buildLabel = process.env.NEXT_PUBLIC_BUILD_LABEL || 'build unknown'

  const verifiedParam = params ? params.get('verified') : null
  const errorParam = params ? params.get('error') : null
  const deletedParam = params ? params.get('deleted') : null

  useEffect(() => {
    const u = username.trim().toLowerCase()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!u) {
        setAccountInfo(null)
        return
      }
      fetchJsonWithTimeout<{ exists: boolean; hasEmail: boolean; isEmailVerified: boolean; hasRecoveryKey: boolean; notice: string | null }>(`/api/auth/check-account?username=${encodeURIComponent(u)}`, { signal: controller.signal }, 6_000)
        .then(({ response, data }) => {
          if (!response.ok) return setAccountInfo(null)
          if (data && data.exists) setAccountInfo(data)
          else setAccountInfo(null)
        })
        .catch(() => setAccountInfo(null))
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [username])

  const successMessage =
    successMessageState ||
    (verifiedParam === 'true' ? 'E-posta başarıyla doğrulandı! Giriş yapabilirsiniz.' : '') ||
    (deletedParam === 'true'
      ? t('profile.deleteAccountSuccess') || 'Hesabınız silinmek üzere işaretlendi ve oturumunuz kapatıldı.'
      : '')

  let error = errorState
  if (!error) {
    if (errorParam === 'token_expired') {
      error = 'Doğrulama bağlantısının süresi dolmuş. Lütfen yeni bir bağlantı talep edin.'
    } else if (errorParam === 'invalid_token') {
      error = t('login.invalidVerificationLink')
    }
  }

  async function startRegister() {
    setLoading(true)
    setErrorState('')
    setSuccessMessageState('')

    try {
      const preflightRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preflight', username, password, email, inviteCode }),
      })
      const preflightData = await preflightRes.json().catch(() => ({}))
      if (!preflightRes.ok) {
        setErrorState(registerErrorMessage(preflightData.error, t))
        setLoading(false)
        return
      }

      const vaultSalt = generateSaltHex(32)
      const vaultKey = await generateVaultKey()
      const recoveryCode = await generateRecoveryCode()

      const passwordKey = await deriveKeyFromPassword(password, vaultSalt)
      const recoveryKey = await deriveKeyFromRecoveryCode(recoveryCode, vaultSalt)

      const wrappedVaultKey = await wrapKey(vaultKey, passwordKey)
      const recoveryWrappedVaultKey = await wrapKey(vaultKey, recoveryKey)
      const recoveryVerifier = await createRecoveryVerifier(recoveryCode)

      setPendingRecoveryCode(recoveryCode)
      setPendingRegData({
        username,
        password,
        email,
        inviteCode,
        vaultSalt,
        wrappedVaultKey,
        recoveryWrappedVaultKey,
        recoveryVerifier,
      })
    } catch (err) {
      console.error('[startRegister]', err)
      setErrorState(t('login.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function completeRegister() {
    if (!pendingRegData) return
    setLoading(true)
    setErrorState('')

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', ...pendingRegData }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setErrorState(registerErrorMessage(data.error, t))
        setPendingRecoveryCode(null)
        setPendingRegData(null)
        setLoading(false)
        return
      }

      if (data.requiresVerification) {
        setSuccessMessageState(data.message || 'Doğrulama bağlantısı e-posta adresinize gönderildi.')
        setCreatingAccount(false)
        setPendingRecoveryCode(null)
        setPendingRegData(null)
      } else {
        await authenticate(pendingRegData.username, pendingRegData.password)
      }
    } catch (err) {
      console.error('[completeRegister]', err)
      setErrorState(t('login.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function authenticate(customUser?: string, customPass?: string) {
    setLoading(true)
    setErrorState('')
    setSuccessMessageState('')
    setShowResend(false)
    setShowRestore(false)

    const u = customUser || username
    const p = customPass || password

    try {
      const res = await fetchWithTimeout('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      }, 15_000)

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (data.error === 'email_unverified') {
          setErrorState('Hesap oluştu ama e-posta doğrulanmamış. Gelen kutusunu/spam klasörünü kontrol et veya aşağıdan yeni bağlantı iste.')
          setShowResend(true)
          setUnverifiedEmail(data.email || '')
        } else if (data.error === 'account_pending_deletion') {
          const daysLeft = 7 - Math.floor((Date.now() - new Date(data.deletedAt).getTime()) / (24 * 60 * 60 * 1000))
          setErrorState(`Hesabınız silinmek üzere işaretlenmiş. Kalıcı olarak silinmesine ${Math.max(1, daysLeft)} gün kaldı.`)
          setShowRestore(true)
        } else {
          setErrorState('Kullanıcı adı veya şifre hatalı.')
        }
        setLoading(false)
        return
      }

      const user = data.user
      if (user?.vaultSalt && user?.wrappedVaultKey) {
        try {
          const passwordKey = await deriveKeyFromPassword(p, user.vaultSalt)
          const vaultKey = await unwrapKey(user.wrappedVaultKey, passwordKey)
          setVaultKey(vaultKey)
        } catch (vaultErr) {
          console.error('[authenticate] Vault unwrap failed:', vaultErr)
        }
      }

      router.push('/')
      router.refresh()
    } catch {
      setErrorState(t('login.failed'))
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    if (accountInfo && !accountInfo.hasEmail) {
      setErrorState('Beta Sürümü Uyarısı: Bu hesapta e-posta adresi bulunmadığı için doğrulama e-postası gönderilemez.')
      return
    }

    setLoading(true)
    setErrorState('')
    setSuccessMessageState('')

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email: unverifiedEmail }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setSuccessMessageState(data.message || 'Yeni doğrulama bağlantısı gönderildi.')
        setShowResend(false)
      } else {
        setErrorState(data.error || 'Doğrulama e-postası gönderilemedi.')
      }
    } catch {
      setErrorState('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRestoreAccount() {
    setLoading(true)
    setErrorState('')
    setSuccessMessageState('')

    try {
      const res = await fetch('/api/auth/restore-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        setSuccessMessageState(data.message || 'Hesabınız başarıyla kurtarıldı! Şimdi giriş yapabilirsiniz.')
        setShowRestore(false)
      } else {
        setErrorState(data.error || 'Hesap kurtarılamadı.')
      }
    } catch {
      setErrorState('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (creatingAccount) {
      void startRegister()
    } else {
      void authenticate()
    }
  }

  // Render Recovery Code Display Step if user just created an account
  if (pendingRecoveryCode && pendingRegData) {
    return (
      <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#050505] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[#f8f8f8]">
        <ThreeLibraryBackground />
        <section className="relative z-10 w-full max-w-md rounded-2xl border p-5 shadow-2xl sm:p-6 liquid-glass-panel border-white/10 text-white backdrop-blur-2xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-300">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#e50914] opacity-90">{t('login.appTitle')}</p>
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-extrabold text-amber-400 tracking-wider animate-pulse">{t('login.betaBadge')}</span>
              </div>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-white">{t('login.recoveryKeyTitle')}</h1>
            </div>
          </div>
          {error && <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-200">{error}</p>}
          {loading
            ? <p className="text-center text-sm text-[#b3b3b3]">{t('login.creatingAccount')}</p>
            : <RecoveryCodeStep code={pendingRecoveryCode} onConfirmed={completeRegister} />
          }
        </section>

        <div className="fixed bottom-3 right-3 z-50 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white/65 shadow-lg backdrop-blur-md">
          {buildLabel}
        </div>
      </main>
    )
  }

  // ── Main Login / Register Form ──
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#050505] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-[#f8f8f8]">
      {/* 3D Three.js Floating Library Canvas */}
      <ThreeLibraryBackground />

      {/* Floating Ambient Glow Blobs */}
      <div className="pointer-events-none absolute left-[10%] top-[15%] h-[320px] w-[320px] animate-float-slow rounded-full bg-[#e50914] opacity-[0.08] blur-[110px]" />
      <div className="pointer-events-none absolute bottom-[15%] right-[10%] h-[380px] w-[380px] animate-float-slower rounded-full bg-[#b81d24] opacity-[0.06] blur-[130px]" />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5 w-full liquid-glass-progress-bg">
        <div className="liquid-glass-progress-fill" style={{ width: '100%', '--progress-color': '#e50914', '--progress-glow': 'rgba(229,9,20,0.65)' } as React.CSSProperties} />
      </div>

      <section className="relative z-10 w-full max-w-sm rounded-2xl border p-5 shadow-2xl sm:p-6 liquid-glass-panel border-white/10 text-white backdrop-blur-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg border border-[#e50914]/30 bg-[#e50914]/10 p-3 text-[#ffb4aa] shadow-[0_0_15px_rgba(229,9,20,0.15)]">
              <BookOpen size={22} className="animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-[10px] font-black uppercase tracking-wider text-[#e50914] opacity-90">{t('login.appTitle')}</p>
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-extrabold text-amber-400 tracking-wider animate-pulse shrink-0">
                  {t('login.betaBadge')}
                </span>
              </div>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-white">{creatingAccount ? t('login.createTitle') : t('login.title')}</h1>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.05] p-2 text-[#b3b3b3] backdrop-blur-md">
            <LockKeyhole size={17} />
          </div>
        </div>

        {/* Beta Notice Banner */}
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <span>{t('login.betaTitle')}</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-200/80 leading-relaxed">
            {t('login.betaNotice')}
          </p>
        </div>

        <p className="mb-4 text-xs font-medium text-[#b3b3b3]/90">{creatingAccount ? t('login.createSubtitle') : t('login.subtitle')}</p>

        <div className="relative z-30 mb-4 rounded-lg border border-white/5 bg-white/[0.02] p-1.5 shadow-inner backdrop-blur-md">
          <LanguageSwitcher />
        </div>

        {showRecovery ? (
          <RecoveryFlow onBack={() => setShowRecovery(false)} onSuccess={() => router.push('/')} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
              <input
                autoFocus
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t('login.username')}
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
                style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
              />
            </div>

            {creatingAccount && (
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('login.email')}
                  className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
                  style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
                />
              </div>
            )}

            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('login.password')}
                className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
                style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
              />
            </div>

            {creatingAccount && (
              <div className="relative">
                <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999] z-10" />
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  placeholder={t('login.inviteCode')}
                  className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-[#666] liquid-glass-input"
                  style={{ '--focus-color': 'rgba(229,9,20,0.7)', '--focus-glow': 'rgba(229,9,20,0.35)' } as React.CSSProperties}
                />
              </div>
            )}

            {accountInfo && !accountInfo.hasEmail && !creatingAccount && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 backdrop-blur-md">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                  <span>{t('login.betaAccountNoticeTitle')}</span>
                </div>
                <p className="mt-1 text-[11px] text-amber-200/80 leading-relaxed">
                  {t('login.betaAccountNoticeDesc')}
                </p>
              </div>
            )}

            {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-200 backdrop-blur-sm">{error}</p>}
            {successMessage && <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-200 backdrop-blur-sm">{successMessage}</p>}

            {showResend && (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={loading || (accountInfo !== null && !accountInfo.hasEmail)}
                  onClick={handleResendVerification}
                  className={`w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all ${
                    accountInfo !== null && !accountInfo.hasEmail
                      ? 'cursor-not-allowed opacity-40 bg-neutral-800 border border-neutral-700'
                      : 'liquid-glass-btn-primary'
                  }`}
                  style={accountInfo?.hasEmail !== false ? ({ '--btn-color': '#10b981', '--btn-glow': 'rgba(16,185,129,0.55)' } as React.CSSProperties) : undefined}
                >
                  {accountInfo !== null && !accountInfo.hasEmail ? (
                    <span className="flex items-center justify-center gap-2">
                      <Lock size={14} /> {t('login.emailUnverifiedDisabled')}
                    </span>
                  ) : loading ? (
                    t('common.loading')
                  ) : (
                    t('login.resendVerification')
                  )}
                </button>
              </div>
            )}

            {showRestore && (
              <button
                type="button"
                disabled={loading}
                onClick={handleRestoreAccount}
                className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all liquid-glass-btn-primary"
                style={{ '--btn-color': '#10b981', '--btn-glow': 'rgba(16,185,129,0.55)' } as React.CSSProperties}
              >
                {loading ? t('common.loading') : t('login.restoreAccount')}
              </button>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password || (creatingAccount && (!email || !inviteCode))}
              className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-40 liquid-glass-btn-primary"
              style={{ '--btn-color': '#e50914', '--btn-glow': 'rgba(229,9,20,0.55)' } as React.CSSProperties}
            >
              {loading
                ? creatingAccount
                  ? t('login.creating')
                  : t('login.unlocking')
                : creatingAccount
                ? t('login.create')
                : t('login.unlock')}
            </button>

            <button
              type="button"
              onClick={() => {
                setCreatingAccount(value => !value)
                setErrorState('')
                setSuccessMessageState('')
                setShowResend(false)
                setShowRestore(false)
              }}
              className="w-full rounded-lg py-2 text-xs font-semibold text-[#d6d3d1]/80 hover:text-white transition-all hover:bg-white/[0.05] active:scale-[0.98]"
            >
              {creatingAccount ? t('login.haveAccount') : t('login.createAccount')}
            </button>

            {!creatingAccount && (
              <>
                {process.env.NODE_ENV !== 'production' && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => authenticate('test', 'test123')}
                    className="w-full rounded-lg py-2.5 text-xs font-bold transition-all liquid-glass-btn-secondary disabled:opacity-40"
                  >
                    {t('login.testAccount')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRecovery(true)}
                  className="w-full rounded-lg py-1.5 text-[11px] font-medium text-[#b3b3b3]/60 hover:text-[#b3b3b3] transition-all"
                >
                  {t('login.forgotPassword')}
                </button>
              </>
            )}
          </form>
        )}

        <div className="mt-6 flex justify-center gap-4 text-xs text-[#d6d3d1]/60">
          <Link href="/terms" className="hover:text-white transition-all underline decoration-dotted">
            {t('footer.terms')}
          </Link>
          <span className="text-white/10">|</span>
          <Link href="/privacy" className="hover:text-white transition-all underline decoration-dotted">
            {t('footer.privacy')}
          </Link>
          <span className="text-white/10">|</span>
          <Link href="/dmca" className="hover:text-white transition-all underline decoration-dotted">
            {t('footer.dmca')}
          </Link>
        </div>
      </section>

      <div className="fixed bottom-3 right-3 z-50 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-white/65 shadow-lg backdrop-blur-md">
        {buildLabel}
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
