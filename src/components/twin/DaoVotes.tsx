'use client'
// src/components/twin/DaoVotes.tsx
// Browse proposals + see twin's pre-decision + approve/reject

import { useState, useEffect } from 'react'

interface Props { token: string | null }

const SPACES = [
  { id: 'arbitrumfoundation.eth', name: 'Arbitrum' },
  { id: 'nouns.eth',              name: 'Nouns DAO' },
  { id: 'aave.eth',               name: 'Aave' },
  { id: 'ens.eth',                name: 'ENS' },
  { id: 'gitcoindao.eth',         name: 'Gitcoin' },
]

export default function DaoVotes({ token }: Props) {
  const [space, setSpace]         = useState('arbitrumfoundation.eth')
  const [proposals, setProposals] = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [voting, setVoting]       = useState<string | null>(null)
  const [results, setResults]     = useState<Record<string, any>>({})
  const [daoEnabled, setDaoEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token) return
    fetch('/api/twin/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setDaoEnabled(d.daoVoteEnabled ?? false))
  }, [token])

  const loadProposals = async () => {
    if (!token) return
    setLoading(true)
    const res = await fetch(`/api/twin/vote?space=${space}&platform=snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setProposals(data.proposals ?? [])
    setLoading(false)
  }

  useEffect(() => { if (daoEnabled) loadProposals() }, [space, daoEnabled])

  const vote = async (proposalId: string, decision: string, autoVote: boolean) => {
    if (!token) return
    setVoting(proposalId)
    const res = await fetch('/api/twin/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: 'snapshot', space, proposalId, autoVote }),
    })
    const data = await res.json()
    setResults(prev => ({ ...prev, [proposalId]: data }))
    setVoting(null)
  }

  const enableDao = async () => {
    if (!token) return
    await fetch('/api/twin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ daoVoteEnabled: true }),
    })
    setDaoEnabled(true)
  }

  if (daoEnabled === null) return <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>

  if (!daoEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <span className="text-4xl mb-4">🗳️</span>
        <p className="text-sm font-medium text-gray-900 mb-2">DAO voting proxy</p>
        <p className="text-xs text-gray-500 leading-relaxed mb-6">
          Let your twin vote in DAOs based on your values. It reads proposals, decides how you'd vote, and executes it — or shows you for approval first.
        </p>
        <button onClick={enableDao}
          className="bg-purple-600 text-white text-sm px-6 py-3 rounded-xl font-medium">
          Enable DAO voting
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4 pb-8">
      {/* Space selector */}
      <div>
        <p className="text-xs text-gray-500 mb-2">DAO space</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SPACES.map(s => (
            <button key={s.id} onClick={() => setSpace(s.id)}
              className={`text-xs px-3 py-1.5 rounded-full flex-shrink-0 font-medium transition-colors ${space === s.id ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <span className="text-3xl block mb-2">📜</span>
          <p className="text-sm">No active proposals in this space</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p: any) => {
            const d       = p.twinDecision
            const result  = results[p.id]
            const isVoting = voting === p.id

            return (
              <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <p className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">{p.title}</p>
                <p className="text-xs text-gray-400 mb-3">
                  Ends {new Date(p.end * 1000).toLocaleDateString()}
                </p>

                {d && !result && (
                  <>
                    <div className={`rounded-xl p-3 mb-3 ${d.shouldVote ? 'bg-purple-50' : 'bg-gray-50'}`}>
                      <p className="text-xs font-medium text-gray-700 mb-1">Twin's recommendation</p>
                      <p className="text-sm font-medium text-purple-700">{d.decision}</p>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.reasoning}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${(d.confidence ?? 0) * 100}%` }}/>
                        </div>
                        <span className="text-xs text-gray-400">{Math.round((d.confidence ?? 0) * 100)}%</span>
                      </div>
                    </div>

                    {d.shouldVote ? (
                      <div className="flex gap-2">
                        <button onClick={() => vote(p.id, d.decision, true)} disabled={isVoting}
                          className="flex-1 bg-purple-600 text-white text-xs py-2.5 rounded-xl font-medium disabled:opacity-50">
                          {isVoting ? 'Voting…' : `Vote "${d.decision}"`}
                        </button>
                        <button onClick={() => vote(p.id, d.decision, false)} disabled={isVoting}
                          className="flex-1 bg-gray-100 text-gray-600 text-xs py-2.5 rounded-xl font-medium">
                          Queue for review
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-center text-gray-400">
                        Twin confidence too low to vote autonomously
                      </p>
                    )}
                  </>
                )}

                {result && (
                  <div className={`rounded-xl p-3 text-xs ${result.executed ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                    {result.executed
                      ? `✅ Voted "${result.decision}" on-chain`
                      : `📋 Queued for review: "${result.decision}"`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
