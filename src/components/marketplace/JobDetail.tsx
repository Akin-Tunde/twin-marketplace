'use client'
// src/components/marketplace/JobDetail.tsx

import { useState, useEffect } from 'react'

interface Props { jobId: string; token: string | null; onBack: () => void }

const STATUS_COLOR: Record<string, string> = {
  open:        'bg-blue-50 text-blue-700',
  matched:     'bg-yellow-50 text-yellow-700',
  in_progress: 'bg-purple-50 text-purple-700',
  submitted:   'bg-orange-50 text-orange-700',
  completed:   'bg-green-50 text-green-700',
  disputed:    'bg-red-50 text-red-700',
  cancelled:   'bg-gray-100 text-gray-600',
}

const STATUS_ICON: Record<string, string> = {
  open: '📋', matched: '🤝', in_progress: '⚙️',
  submitted: '📤', completed: '✅', disputed: '⚖️', cancelled: '❌',
}

export default function JobDetail({ jobId, token, onBack }: Props) {
  const [job, setJob]           = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [rating, setRating]     = useState(0)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [disputeReason, setDisputeReason] = useState('')
  const [submittingDispute, setSubmittingDispute] = useState(false)
  const [msg, setMsg]           = useState('')

  const load = async () => {
    if (!token) return
    const res = await fetch(`/api/marketplace/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setJob(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [jobId, token])

  // Poll status every 3s while in progress
  useEffect(() => {
    if (!job || ['completed', 'disputed', 'cancelled'].includes(job.status)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [job?.status])

  const submitRating = async () => {
    if (!rating || !token) return
    setSubmittingRating(true)
    await fetch(`/api/marketplace/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rating }),
    })
    setMsg('Rating submitted. Thank you!')
    setSubmittingRating(false)
    load()
  }

  const submitDispute = async () => {
    if (!disputeReason.trim() || !token) return
    setSubmittingDispute(true)
    const res = await fetch('/api/marketplace/dispute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId, reason: disputeReason }),
    })
    const data = await res.json()
    setMsg(data.message ?? 'Dispute opened.')
    setDisputeOpen(false)
    setSubmittingDispute(false)
    load()
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
  if (!job) return <div className="p-4 text-sm text-gray-500">Job not found</div>

  const result = job.outputResult?.data
  const verification = job.outputResult?.verification

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 text-sm">← Back</button>
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">{job.description}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status banner */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${STATUS_COLOR[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
          <span className="text-2xl">{STATUS_ICON[job.status] ?? '📋'}</span>
          <div>
            <p className="text-sm font-medium capitalize">{job.status.replace('_', ' ')}</p>
            {job.status === 'in_progress' && <p className="text-xs opacity-70">Agent is working…</p>}
            {job.status === 'completed' && <p className="text-xs opacity-70">Job complete — rate the agent</p>}
          </div>
        </div>

        {/* Details */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-2">
          <Row label="Intent"   value={job.requiredIntent} />
          <Row label="Budget"   value={`$${job.budgetUsdc} USDC`} />
          <Row label="Agent"    value={job.agent?.name ?? `FID ${job.assignedAgentFid}`} />
          {job.agent && <Row label="Rep score" value={`${Math.round(job.agent.reputationScore ?? 0)}/100`} />}
          {job.deadlineAt && <Row label="Deadline" value={new Date(job.deadlineAt).toLocaleString()} />}
          {job.escrowTxHash && (
            <div className="pt-1">
              <p className="text-xs text-gray-400 mb-0.5">Escrow tx</p>
              <a href={`https://basescan.org/tx/${job.escrowTxHash}`} target="_blank" rel="noopener"
                className="text-xs font-mono text-purple-600 break-all">
                {job.escrowTxHash.slice(0, 20)}…
              </a>
            </div>
          )}
        </div>

        {/* Result */}
        {result && (
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <p className="text-xs font-medium text-gray-700 mb-2">Agent output</p>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
            {verification && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Quality score: <span className={`font-medium ${verification.score >= 70 ? 'text-green-600' : 'text-orange-500'}`}>{verification.score}/100</span>
                </p>
                {verification.feedback && <p className="text-xs text-gray-400 mt-0.5">{verification.feedback}</p>}
              </div>
            )}
          </div>
        )}

        {/* Rate the agent */}
        {job.status === 'completed' && !job.rating && (
          <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
            <p className="text-sm font-medium text-purple-900 mb-3">Rate this agent</p>
            <div className="flex gap-2 mb-3">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(n)}
                  className={`flex-1 py-2 rounded-xl text-lg transition-all ${rating >= n ? 'bg-purple-600 text-white' : 'bg-white border border-purple-200 text-gray-400'}`}>
                  ★
                </button>
              ))}
            </div>
            <button onClick={submitRating} disabled={!rating || submittingRating}
              className="w-full bg-purple-600 text-white text-sm py-2.5 rounded-xl font-medium disabled:opacity-50">
              {submittingRating ? 'Submitting…' : 'Submit rating'}
            </button>
          </div>
        )}

        {job.rating && (
          <div className="bg-green-50 rounded-xl px-4 py-3 text-sm text-green-700">
            You rated this job {'★'.repeat(job.rating)}{'☆'.repeat(5 - job.rating)}
          </div>
        )}

        {/* Dispute */}
        {['in_progress', 'submitted', 'completed'].includes(job.status) && !job.disputeOpenedAt && (
          <div>
            {!disputeOpen ? (
              <button onClick={() => setDisputeOpen(true)}
                className="w-full border border-red-200 text-red-600 text-xs py-2.5 rounded-xl">
                Open dispute
              </button>
            ) : (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 space-y-3">
                <p className="text-sm font-medium text-red-900">Open a dispute</p>
                <textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)}
                  placeholder="Explain why you're disputing this job…" rows={3}
                  className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm resize-none bg-white"/>
                <div className="flex gap-2">
                  <button onClick={submitDispute} disabled={!disputeReason.trim() || submittingDispute}
                    className="flex-1 bg-red-500 text-white text-xs py-2.5 rounded-xl font-medium disabled:opacity-50">
                    {submittingDispute ? '…' : 'Submit dispute'}
                  </button>
                  <button onClick={() => setDisputeOpen(false)}
                    className="flex-1 bg-gray-100 text-gray-600 text-xs py-2.5 rounded-xl">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {msg && <p className="text-xs text-center text-green-600">{msg}</p>}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-800">{value}</span>
    </div>
  )
}
