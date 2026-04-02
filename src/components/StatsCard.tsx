'use client'
// src/components/StatsCard.tsx
// Shareable twin stats card — the viral growth mechanic
// Shows what the twin has done, one-tap share to Farcaster feed

import { useState, useEffect } from 'react'
import sdk from '@farcaster/frame-sdk'

interface Props {
  fid?: number
  token: string | null
}

interface Stats {
  username: string
  displayName: string
  pfpUrl: string
  stats: {
    draftsShown: number
    draftsApproved: number
    approvalRate: number
    castsPosted: number
    tipsSent: number
    usdcTipped: string
    votesCast: number
    streakDays: number
    memoriesStored: number
    actionsThisWeek: number
  }
  shareUrl: string
}

export default function StatsCard({ fid, token }: Props) {
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [shared, setShared] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch('/api/twin/stats', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  const shareToCast = async () => {
    if (!data || sharing) return
    setSharing(true)

    const s = data.stats
    const hasActivity = s.castsPosted > 0 || s.tipsSent > 0 || s.actionsThisWeek > 0

    const castText = hasActivity
      ? `My AI twin on Farcaster this week:\n\n` +
        (s.castsPosted > 0    ? `✍️ ${s.castsPosted} cast${s.castsPosted !== 1 ? 's' : ''} posted\n` : '') +
        (s.tipsSent > 0       ? `💸 ${s.tipsSent} tip${s.tipsSent !== 1 ? 's' : ''} sent ($${s.usdcTipped} USDC)\n` : '') +
        (s.votesCast > 0      ? `🗳️ ${s.votesCast} DAO vote${s.votesCast !== 1 ? 's' : ''}\n` : '') +
        (s.approvalRate > 0   ? `✅ ${s.approvalRate}% approval rate\n` : '') +
        `\n${data.shareUrl}`
      : `Just set up my AI twin on Farcaster — it learns my voice and acts on my behalf.\n\n` +
        `${s.memoriesStored} memories stored so far.\n\n${data.shareUrl}`

    try {
      // Use Farcaster SDK compose intent
      await sdk.actions.openUrl(
        `https://warpcast.com/~/compose?text=${encodeURIComponent(castText)}`
      )
      setShared(true)
      setTimeout(() => setShared(false), 3000)
    } catch {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(castText).catch(() => {})
      setShared(true)
    }
    setSharing(false)
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
  }

  if (!data) {
    return (
      <div className="px-4 py-8 text-center text-gray-400 text-sm">
        Start using your twin to see stats here
      </div>
    )
  }

  const s = data.stats

  return (
    <div className="px-4 py-4">
      {/* Card */}
      <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-2xl p-5 text-white mb-4 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full translate-y-6 -translate-x-6" />

        {/* Header */}
        <div className="flex items-center gap-3 mb-5 relative">
          {data.pfpUrl && (
            <img src={data.pfpUrl} className="w-10 h-10 rounded-full ring-2 ring-white/30" alt="" />
          )}
          <div>
            <p className="text-sm font-medium">{data.displayName ?? data.username}</p>
            <p className="text-xs text-purple-200">@{data.username}'s twin</p>
          </div>
          <div className="ml-auto bg-white/15 rounded-lg px-2.5 py-1">
            <p className="text-xs font-medium">{s.streakDays}d streak</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 relative">
          <StatCell icon="✍️" value={s.castsPosted} label="casts posted" />
          <StatCell icon="💸" value={`$${s.usdcTipped}`} label="USDC tipped" />
          <StatCell icon="✅" value={`${s.approvalRate}%`} label="approval rate" />
          <StatCell icon="🧠" value={s.memoriesStored} label="memories" />
          {s.votesCast > 0 && <StatCell icon="🗳️" value={s.votesCast} label="DAO votes" />}
          {s.actionsThisWeek > 0 && <StatCell icon="⚡" value={s.actionsThisWeek} label="this week" />}
        </div>
      </div>

      {/* Share button */}
      <button
        onClick={shareToCast}
        disabled={sharing}
        className="w-full bg-purple-600 text-white text-sm font-medium py-3 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {shared ? (
          <>✓ Shared!</>
        ) : sharing ? (
          <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Sharing…</>
        ) : (
          <>Share to feed ↗</>
        )}
      </button>
      <p className="text-xs text-center text-gray-400 mt-2">
        Posts to your Farcaster feed — free distribution for your twin
      </p>

      {/* Activity breakdown */}
      {s.draftsShown > 0 && (
        <div className="mt-4 bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-700 mb-3">All time</p>
          <div className="space-y-2">
            <ActivityRow label="Drafts shown" value={s.draftsShown} />
            <ActivityRow label="Approved" value={s.draftsApproved} />
            <ActivityRow label="Tips sent" value={s.tipsSent} />
            {s.votesCast > 0 && <ActivityRow label="DAO votes" value={s.votesCast} />}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCell({ icon, value, label }: { icon: string; value: any; label: string }) {
  return (
    <div className="bg-white/10 rounded-xl p-3">
      <p className="text-lg mb-0.5">{icon}</p>
      <p className="text-xl font-medium leading-none">{value}</p>
      <p className="text-xs text-purple-200 mt-0.5">{label}</p>
    </div>
  )
}

function ActivityRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-800">{value}</span>
    </div>
  )
}
