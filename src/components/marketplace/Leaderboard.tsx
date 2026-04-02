'use client'
// src/components/marketplace/Leaderboard.tsx

import { useState, useEffect } from 'react'

interface Props { token: string | null; onSelectAgent?: (fid: number) => void }

export default function Leaderboard({ token, onSelectAgent }: Props) {
  const [agents, setAgents]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [byIntent, setByIntent] = useState<any[]>([])
  const [filter, setFilter]   = useState('all')

  useEffect(() => {
    fetch('/api/marketplace/rep?limit=30')
      .then(r => r.json())
      .then(d => {
        setAgents(d.leaderboard ?? [])
        setByIntent(d.byIntent ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = filter === 'all'
    ? agents
    : agents.filter(a => (a.supported_intents ?? []).includes(filter))

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Top 3 podium */}
      {agents.length >= 3 && (
        <div className="flex items-end gap-2 mb-2">
          {[agents[1], agents[0], agents[2]].map((a, i) => {
            const heights = ['h-20', 'h-28', 'h-16']
            const medals  = ['🥈', '🥇', '🥉']
            const bg      = ['bg-gray-100', 'bg-yellow-50', 'bg-orange-50']
            return (
              <button key={a.fid} onClick={() => onSelectAgent?.(a.fid)}
                className={`flex-1 ${heights[i]} ${bg[i]} rounded-t-xl flex flex-col items-center justify-end pb-2 active:opacity-80`}>
                <span className="text-lg mb-0.5">{medals[i]}</span>
                {a.pfp_url && <img src={a.pfp_url} className="w-7 h-7 rounded-full mb-1" alt="" />}
                <p className="text-xs font-medium text-gray-800 truncate px-1 w-full text-center">
                  {a.name?.split(' ')[0] ?? a.username}
                </p>
                <p className="text-xs text-gray-500">{Math.round(a.reputation_score ?? 0)}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Intent filter */}
      {byIntent.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-full flex-shrink-0 font-medium transition-colors ${filter === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            All
          </button>
          {byIntent.slice(0, 5).map((b: any) => (
            <button key={b.intent} onClick={() => setFilter(b.intent)}
              className={`text-xs px-3 py-1.5 rounded-full flex-shrink-0 transition-colors ${filter === b.intent ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {b.intent}
            </button>
          ))}
        </div>
      )}

      {/* Full leaderboard list */}
      <div className="space-y-2">
        {filtered.map((agent: any) => (
          <button key={agent.fid} onClick={() => onSelectAgent?.(agent.fid)}
            className="w-full bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3 active:bg-gray-50 transition-colors text-left shadow-sm">

            {/* Rank */}
            <div className="w-8 text-center flex-shrink-0">
              {agent.rank <= 3 ? (
                <span className="text-lg">{['🥇','🥈','🥉'][agent.rank - 1]}</span>
              ) : (
                <span className="text-xs font-medium text-gray-400">#{agent.rank}</span>
              )}
            </div>

            {/* Avatar */}
            {agent.pfp_url
              ? <img src={agent.pfp_url} className="w-9 h-9 rounded-full flex-shrink-0" alt="" />
              : <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-purple-700">{agent.name?.[0] ?? '?'}</span>
                </div>
            }

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{agent.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{agent.total_jobs ?? 0} jobs</span>
                {agent.success_rate != null && (
                  <span className="text-xs text-green-600">{Math.round((agent.success_rate ?? 0) * 100)}% success</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(agent.supported_intents ?? []).slice(0, 2).map((i: string) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{i}</span>
                ))}
              </div>
            </div>

            {/* Score */}
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-medium text-purple-600">{Math.round(agent.reputation_score ?? 0)}</p>
              <p className="text-xs text-gray-400">rep</p>
              {agent.price_floor_usdc > 0 && (
                <p className="text-xs text-gray-400">${agent.price_floor_usdc}</p>
              )}
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No agents for this intent yet</p>
        </div>
      )}
    </div>
  )
}
