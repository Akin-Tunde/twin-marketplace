'use client'
// src/app/miniapp/marketplace/page.tsx
// Full Week 3 marketplace — job posting with escrow, lifecycle, leaderboard, agent registration

import { useState, useEffect, useCallback } from 'react'
import AgentRegister from '@/components/marketplace/AgentRegister'
import JobDetail from '@/components/marketplace/JobDetail'
import Leaderboard from '@/components/marketplace/Leaderboard'

type MTab = 'post' | 'myjobs' | 'leaderboard' | 'register'

interface Props { token: string | null; fid?: number }

const INTENT_OPTIONS = [
  { value: 'social.cast',       label: 'Write & post a cast' },
  { value: 'nft.mint',          label: 'Mint an NFT' },
  { value: 'media.generate',    label: 'Generate an image' },
  { value: 'governance.vote',   label: 'DAO vote' },
  { value: 'data.read',         label: 'Fetch & summarize data' },
  { value: 'social.follow',     label: 'Follow accounts' },
  { value: 'finance.transfer',  label: 'Send USDC' },
]

export default function MarketplacePage({ token, fid }: Props) {
  const [tab, setTab]             = useState<MTab>('post')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  if (selectedJobId) {
    return (
      <JobDetail
        jobId={selectedJobId}
        token={token}
        onBack={() => setSelectedJobId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-gray-100 bg-white px-2 overflow-x-auto">
        {([
          { id: 'post',        label: 'Post job' },
          { id: 'myjobs',      label: 'My jobs' },
          { id: 'leaderboard', label: 'Leaderboard' },
          { id: 'register',    label: 'Register agent' },
        ] as const).map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`text-xs font-medium py-3 px-3 border-b-2 flex-shrink-0 transition-colors ${
              tab === id ? 'border-purple-500 text-purple-700' : 'border-transparent text-gray-400'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'post'        && <PostJobTab token={token} />}
        {tab === 'myjobs'      && <MyJobsTab token={token} onSelect={setSelectedJobId} />}
        {tab === 'leaderboard' && <Leaderboard token={token} />}
        {tab === 'register'    && <AgentRegister token={token} onRegistered={() => setTab('leaderboard')} />}
      </div>
    </div>
  )
}

// ── Post Job ──────────────────────────────────────────────────────────────────
function PostJobTab({ token }: { token: string | null }) {
  const [intent, setIntent]     = useState('social.cast')
  const [desc, setDesc]         = useState('')
  const [budget, setBudget]     = useState('1')
  const [lockEscrow, setLockEscrow] = useState(false)
  const [deadline, setDeadline] = useState('24')
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState<any>(null)

  const post = async () => {
    if (!token || !desc.trim()) return
    setLoading(true); setResult(null)
    const res = await fetch('/api/marketplace/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requiredIntent: intent,
        description: desc,
        budgetUsdc: parseFloat(budget),
        deadlineHours: parseInt(deadline),
        lockEscrow,
      }),
    })
    setResult(await res.json())
    setLoading(false)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-gray-900">New job</p>

        <div>
          <label className="text-xs text-gray-500 block mb-1.5">Task type</label>
          <select value={intent} onChange={e => setIntent(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
            {INTENT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1.5">Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="e.g. Write a cast announcing my NFT drop, max 280 chars, make it exciting"
            rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none"/>
          <p className="text-xs text-gray-400 mt-1">Be specific — the AI reads this to match the best agent</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1.5">Budget (USDC)</label>
            <input type="number" value={budget} onChange={e => setBudget(e.target.value)}
              min="0" step="0.5"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"/>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1.5">Deadline</label>
            <select value={deadline} onChange={e => setDeadline(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              <option value="6">6 hours</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">1 week</option>
            </select>
          </div>
        </div>

        {/* Escrow toggle */}
        <div className={`rounded-xl p-3 border transition-colors ${lockEscrow ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-900">Lock USDC in escrow</p>
              <p className="text-xs text-gray-500 mt-0.5">Funds locked on Base until work is verified</p>
            </div>
            <button onClick={() => setLockEscrow(v => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${lockEscrow ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${lockEscrow ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {lockEscrow && (
            <p className="text-xs text-green-700 mt-2">
              ✓ ${parseFloat(budget).toFixed(2)} USDC will lock on Base when job is matched
            </p>
          )}
        </div>

        <button onClick={post} disabled={loading || !desc.trim()}
          className="w-full bg-purple-600 text-white text-sm py-3 rounded-xl font-medium disabled:opacity-50 active:scale-[0.98] transition-transform">
          {loading ? 'Matching agent…' : 'Post job'}
        </button>
      </div>

      {result && (
        <div className={`rounded-2xl p-4 border text-sm ${
          result.status === 'completed' ? 'bg-green-50 border-green-100' :
          result.status === 'failed'    ? 'bg-red-50 border-red-100' :
          'bg-blue-50 border-blue-100'}`}>
          <p className={`font-medium mb-2 ${result.status === 'completed' ? 'text-green-900' : result.status === 'failed' ? 'text-red-900' : 'text-blue-900'}`}>
            {result.status === 'completed' ? '✅ Job completed' :
             result.status === 'failed'    ? '❌ ' + result.error :
             '📋 ' + result.status}
          </p>
          {result.agentName && <p className="text-xs text-gray-600 mb-1">Agent: {result.agentName}</p>}
          {result.escrowTxHash && (
            <a href={`https://basescan.org/tx/${result.escrowTxHash}`} target="_blank" rel="noopener"
              className="text-xs text-purple-600 block mb-1">View escrow tx →</a>
          )}
          {result.result && (
            <pre className="text-xs mt-2 overflow-auto bg-white/50 p-2 rounded-lg">
              {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── My Jobs ───────────────────────────────────────────────────────────────────
function MyJobsTab({ token, onSelect }: { token: string | null; onSelect: (id: string) => void }) {
  const [jobs, setJobs]       = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState<'requester' | 'agent'>('requester')

  const load = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/marketplace/jobs?role=${view}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setJobs(data.jobs ?? [])
    setLoading(false)
  }, [token, view])

  useEffect(() => { setLoading(true); load() }, [view, load])

  const STATUS_COLOR: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    in_progress: 'bg-purple-100 text-purple-700',
    disputed: 'bg-red-100 text-red-700',
    open: 'bg-blue-100 text-blue-700',
    matched: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        {(['requester', 'agent'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`flex-1 text-xs py-2 rounded-xl font-medium transition-colors ${view === v ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {v === 'requester' ? 'Jobs I posted' : 'Jobs I\'ve taken'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <span className="text-4xl block mb-3">💼</span>
          <p className="text-sm">{view === 'requester' ? 'No jobs posted yet' : 'No jobs taken yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <button key={job.id} onClick={() => onSelect(job.id)}
              className="w-full bg-white border border-gray-100 rounded-2xl p-4 text-left shadow-sm active:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-medium text-gray-900 flex-1 line-clamp-2">{job.description}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[job.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {job.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                <span>{job.requiredIntent}</span>
                <span>${job.budgetUsdc} USDC</span>
                {job.escrowTxHash && <span>🔒 escrow</span>}
                {job.rating && <span>{'★'.repeat(job.rating)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
