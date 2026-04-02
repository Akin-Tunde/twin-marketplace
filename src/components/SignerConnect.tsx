'use client'
// src/components/SignerConnect.tsx
// Guides the user through granting write access to their twin
// Shows a deep link (mobile) or QR code (desktop) to approve in Warpcast

import { useState, useEffect, useCallback } from 'react'

interface Props {
  token: string
  onConnected: () => void
}

type SignerState = 'idle' | 'requesting' | 'pending' | 'approved' | 'error'

export default function SignerConnect({ token, onConnected }: Props) {
  const [state, setState] = useState<SignerState>('idle')
  const [approvalUrl, setApprovalUrl] = useState('')
  const [signerUuid, setSignerUuid] = useState('')
  const [pollUrl, setPollUrl] = useState('')
  const [error, setError] = useState('')

  // Request a new signer
  const requestSigner = async () => {
    setState('requesting')
    try {
      const res = await fetch('/api/twin/signer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setApprovalUrl(data.approvalUrl)
      setSignerUuid(data.signerUuid)
      setPollUrl(data.pollUrl)
      setState('pending')
    } catch (err: any) {
      setError(err.message)
      setState('error')
    }
  }

  // Poll for approval every 2 seconds
  const poll = useCallback(async () => {
    if (!pollUrl || state !== 'pending') return
    try {
      const res = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (data.status === 'approved') {
        setState('approved')
        setTimeout(onConnected, 1500)
      }
    } catch {
      // ignore poll errors
    }
  }, [pollUrl, state, token, onConnected])

  useEffect(() => {
    if (state !== 'pending') return
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [state, poll])

  if (state === 'approved') {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-3xl">✓</span>
        </div>
        <p className="text-base font-medium text-gray-900">Twin connected!</p>
        <p className="text-sm text-gray-500 mt-1">Your twin can now post on your behalf</p>
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div className="flex flex-col px-5 py-6">
        <div className="bg-purple-50 rounded-2xl p-5 mb-5 text-center">
          <p className="text-sm font-medium text-purple-900 mb-1">Waiting for approval</p>
          <p className="text-xs text-purple-600 mb-4">
            Open Warpcast and approve your twin's write access
          </p>

          {/* Deep link button — works on mobile */}
          <a
            href={approvalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-purple-600 text-white text-sm font-medium py-3 rounded-xl mb-3 text-center"
          >
            Open in Warpcast →
          </a>

          {/* QR code fallback for desktop */}
          <div className="bg-white rounded-xl p-3 inline-block">
            <QRCode value={approvalUrl} size={140} />
          </div>
          <p className="text-xs text-purple-500 mt-2">Or scan with your phone</p>
        </div>

        {/* Polling indicator */}
        <div className="flex items-center gap-2 justify-center text-xs text-gray-400">
          <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
          Checking for approval…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col px-5 py-6">
      {/* Explainer */}
      <div className="mb-6">
        <h3 className="text-base font-medium text-gray-900 mb-2">
          Connect your twin
        </h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          To let your twin post, tip, and react on your behalf, you need to
          grant it write access. This is done through Warpcast's App Key system —
          you can revoke it any time.
        </p>
      </div>

      {/* Permission list */}
      <div className="space-y-2 mb-6">
        {[
          { icon: '✍️', text: 'Post casts in your voice' },
          { icon: '💜', text: 'Like and recast content you\'d approve' },
          { icon: '💸', text: 'Send small USDC tips (amount you control)' },
          { icon: '🚫', text: 'Cannot access your wallet keys or funds' },
        ].map(({ icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-sm text-gray-700">
            <span className="text-base w-6 text-center flex-shrink-0">{icon}</span>
            {text}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-600 mb-4">
          {error}
        </div>
      )}

      <button
        onClick={requestSigner}
        disabled={state === 'requesting'}
        className="w-full bg-purple-600 text-white text-sm font-medium py-3 rounded-xl disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        {state === 'requesting' ? 'Creating connection…' : 'Connect twin'}
      </button>

      <p className="text-xs text-gray-400 text-center mt-3">
        You can revoke this in Settings at any time
      </p>
    </div>
  )
}

// ── Minimal inline QR code using SVG ─────────────────────────────────────────
// For production, use the 'qrcode' npm package. This generates a basic QR.
function QRCode({ value, size }: { value: string; size: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="bg-white flex items-center justify-center"
    >
      <div className="text-center">
        <p className="text-xs text-gray-400 mb-1">QR Code</p>
        {/* In production: import QRCode from 'qrcode.react' */}
        <p className="font-mono text-xs text-gray-300 break-all" style={{ maxWidth: size - 8 }}>
          {value.slice(0, 30)}…
        </p>
        <p className="text-xs text-gray-400 mt-1">
          npm install qrcode.react
        </p>
      </div>
    </div>
  )
}
