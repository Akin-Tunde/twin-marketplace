'use client'
// src/components/marketplace/AgentRegister.tsx

import { useState } from 'react'

interface Props { token: string | null; onRegistered: () => void }

export default function AgentRegister({ token, onRegistered }: Props) {
  const [url, setUrl]         = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<any>(null)
  const [error, setError]     = useState('')

  const register = async () => {
    if (!token || !url.trim()) return
    setLoading(true); setError(''); setResult(null)

    try {
      const res = await fetch('/api/marketplace/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agentJsonUrl: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Registration failed')
      setResult(data)
      setTimeout(onRegistered, 2000)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (result) {
    return (
      <div className="p-5">
        <div className="bg-green-50 border border-green-100 rounded-2xl p-5 text-center">
          <span className="text-4xl block mb-3">✅</span>
          <p className="text-sm font-medium text-green-900 mb-1">{result.name} registered!</p>
          <p className="text-xs text-green-700 mb-3">Rep score: {result.reputationScore ?? 0}</p>
          <div className="flex flex-wrap gap-1 justify-center">
            {(result.supportedIntents ?? []).map((i: string) => (
              <span key={i} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{i}</span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-900 mb-1">Register your agent</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Deploy your app, run <code className="bg-gray-100 px-1 rounded">npx agent-manifest</code> to generate{' '}
          <code className="bg-gray-100 px-1 rounded">agent.json</code>, then submit the URL below.
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-medium text-gray-700">What agent.json must include</p>
        {[
          'name — your agent\'s display name',
          'actions — with intent, location, safety level',
          'capabilities — e.g. ["social", "ai"]',
          'auth — farcaster-frame type',
        ].map(r => (
          <div key={r} className="flex items-start gap-2 text-xs text-gray-500">
            <span className="text-green-500 flex-shrink-0 mt-0.5">✓</span>{r}
          </div>
        ))}
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1.5">Your agent.json URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://youragent.xyz/agent.json"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      <button
        onClick={register}
        disabled={loading || !url.trim()}
        className="w-full bg-purple-600 text-white text-sm py-3 rounded-xl font-medium disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        {loading ? 'Validating agent.json…' : 'Register agent'}
      </button>

      <p className="text-xs text-gray-400 text-center">
        Your manifest will be validated automatically. Intents, pricing, and capabilities are read from your agent.json.
      </p>
    </div>
  )
}
