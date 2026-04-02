'use client'
// src/app/miniapp/page.tsx — Week 4 complete

import { useEffect, useState, useCallback } from 'react'
import sdk from '@farcaster/frame-sdk'
import OnboardingSurvey from '@/components/OnboardingSurvey'
import TwinSettings from '@/components/TwinSettings'
import StatsCard from '@/components/StatsCard'
import MarketplacePage from './marketplace/page'
import MemoryManager from '@/components/twin/MemoryManager'
import DaoVotes from '@/components/twin/DaoVotes'

type Tab = 'inbox' | 'settings' | 'memory' | 'dao' | 'stats' | 'marketplace' | 'agents'
interface User { fid: number; username?: string; displayName?: string; pfpUrl?: string }

export default function MiniApp() {
  const [user, setUser]                     = useState<User | null>(null)
  const [token, setToken]                   = useState<string | null>(null)
  const [tab, setTab]                       = useState<Tab>('inbox')
  const [ready, setReady]                   = useState(false)
  const [onboardingComplete, setOnboarding] = useState(true)
  const [checking, setChecking]             = useState(false)

  useEffect(() => {
    async function init() {
      const context = await sdk.context
      const u = context.user as User
      setUser(u)

      const notif = (context as any).client?.notificationDetails
      if (notif?.token && u?.fid) {
        fetch('/api/notifications/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid: u.fid, token: notif.token, url: notif.url }),
        }).catch(console.error)
      }

      try {
        const { token: jwt } = await sdk.actions.signIn({
          nonce: crypto.randomUUID(),
          siweUri: process.env.NEXT_PUBLIC_APP_URL!,
          domain: new URL(process.env.NEXT_PUBLIC_APP_URL!).hostname,
        })
        setToken(jwt)
        setChecking(true)

        await fetch('/api/user/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        })

        const sRes = await fetch('/api/twin/settings', {
          headers: { Authorization: `Bearer ${jwt}` },
        })
        const settings = await sRes.json()
        setOnboarding(settings.onboardingComplete ?? false)
        setChecking(false)
      } catch (e) {
        console.error('Auth error:', e)
        setChecking(false)
      }

      sdk.actions.ready()
      setReady(true)
    }
    init()
  }, [])

  if (!ready || checking) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-gray-500">{!ready ? 'Loading…' : 'Setting up your twin…'}</p>
      </div>
    )
  }

  // Onboarding flow for new users
  if (!onboardingComplete) {
    return (
      <div className="flex flex-col h-screen bg-white max-w-md mx-auto">
        <div className="px-5 pt-6 pb-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Welcome to TwinMarket</p>
          <h1 className="text-lg font-medium text-gray-900">Set up your twin</h1>
          <p className="text-xs text-gray-500 mt-0.5">5 quick questions to teach it how you think</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <OnboardingSurvey token={token!} onComplete={() => setOnboarding(true)} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 max-w-md mx-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        {user?.pfpUrl && <img src={user.pfpUrl} className="w-8 h-8 rounded-full" alt="" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{user?.displayName ?? user?.username ?? 'Your Twin'}</p>
          <p className="text-xs text-gray-400">FID {user?.fid}</p>
        </div>
        <div className="bg-purple-50 rounded-full px-3 py-1">
          <p className="text-xs text-purple-700 font-medium">twin active</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'inbox'       && <InboxTab token={token} />}
        {tab === 'settings'    && <TwinSettings fid={user?.fid} token={token} />}
        {tab === 'memory'      && <MemoryManager token={token} />}
        {tab === 'dao'         && <DaoVotes token={token} />}
        {tab === 'stats'       && <StatsCard fid={user?.fid} token={token} />}
        {tab === 'marketplace' && <MarketplacePage token={token} fid={user?.fid} />}
        {tab === 'agents'      && <AgentsTab />}
      </div>

      {/* Bottom nav */}
      <nav className="bg-white border-t border-gray-100 flex">
        {([
          { id: 'inbox',       label: 'Inbox',   icon: '📬' },
          { id: 'settings',    label: 'Twin',    icon: '🧬' },
          { id: 'memory',      label: 'Memory',  icon: '🧠' },
          { id: 'dao',         label: 'DAOs',    icon: '🗳️' },
          { id: 'marketplace', label: 'Market',  icon: '💼' },
        ] as const).map(({ id, label, icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs transition-colors ${tab === id ? 'text-purple-600' : 'text-gray-400'}`}>
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── Inbox Tab ─────────────────────────────────────────────────────────────────
function InboxTab({ token }: { token: string | null }) {
  const [actions, setActions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/twin/actions?status=pending', { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    setActions(data.actions ?? [])
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handle = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id)
    await fetch(`/api/twin/actions/${id}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    setActions(prev => prev.filter(a => a.id !== id))
    setBusy(null)
  }

  if (loading) return <Spinner />
  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <span className="text-5xl mb-4">📬</span>
        <p className="text-sm font-medium text-gray-600">Inbox clear</p>
        <p className="text-xs text-gray-400 mt-1">Your twin is watching. Drafts appear here.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{actions.length} pending</p>
      {actions.map(a => (
        <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">{a.actionType}</span>
            <span className="text-xs text-gray-400">{Math.round((a.confidence ?? 0) * 100)}% confident</span>
          </div>
          {a.inputData?.castText && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
              <p className="text-xs text-gray-500 mb-0.5">Replying to</p>
              <p className="text-xs text-gray-700 italic line-clamp-2">"{a.inputData.castText}"</p>
              {a.inputData.castAuthor && <p className="text-xs text-gray-400 mt-0.5">@{a.inputData.castAuthor}</p>}
            </div>
          )}
          <p className="text-sm text-gray-900 leading-relaxed mb-3">
            {a.outputData?.draft ?? JSON.stringify(a.outputData)}
          </p>
          <div className="flex gap-2">
            <button onClick={() => handle(a.id, 'approve')} disabled={busy === a.id}
              className="flex-1 bg-purple-600 text-white text-xs py-2.5 rounded-xl font-medium disabled:opacity-50 active:scale-[0.97] transition-transform">
              {busy === a.id ? '…' : 'Approve & send'}
            </button>
            <button onClick={() => handle(a.id, 'reject')} disabled={busy === a.id}
              className="flex-1 bg-gray-100 text-gray-600 text-xs py-2.5 rounded-xl font-medium disabled:opacity-50">
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Spinner() {
  return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
}
