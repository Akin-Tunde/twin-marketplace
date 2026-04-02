'use client'
// src/components/TwinSettings.tsx
// Full settings UI — autonomy slider, auto-tip, scheduled casts, signer status

import { useState, useEffect, useCallback } from 'react'
import SignerConnect from './SignerConnect'

interface Props {
  fid?: number
  token: string | null
}

interface Settings {
  autonomyLevel: number
  autoTipEnabled: boolean
  autoTipThreshold: number
  autoTipAmountUsdc: number
  scheduledCastEnabled: boolean
  scheduledCastTopics: string[]
  daoVoteEnabled: boolean
  notifyOnAction: boolean
  hasSigner: boolean
  stats: any
}

const AUTONOMY_LABELS: Record<number, { label: string; desc: string }> = {
  1: { label: 'Ask me everything',    desc: 'All actions land in inbox for your approval' },
  2: { label: 'Auto-tip only',        desc: 'Auto-tip high confidence content, ask for replies' },
  3: { label: 'Handle small stuff',   desc: 'Post replies + tips autonomously, surface big decisions' },
  4: { label: 'Mostly autonomous',    desc: 'Acts freely, sends you a weekly digest' },
  5: { label: 'Full autopilot',       desc: 'Complete autonomy — check the log when you want' },
}

export default function TwinSettings({ fid, token }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSignerFlow, setShowSignerFlow] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/twin/settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setSettings(data)
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const update = async (changes: Partial<Settings>) => {
    if (!token || !settings) return
    setSaving(true)
    setSettings(prev => prev ? { ...prev, ...changes } : prev)
    await fetch('/api/twin/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(changes),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const addTopic = () => {
    const t = topicInput.trim().toLowerCase()
    if (!t || settings?.scheduledCastTopics.includes(t)) return
    const next = [...(settings?.scheduledCastTopics ?? []), t]
    update({ scheduledCastTopics: next })
    setTopicInput('')
  }

  const removeTopic = (topic: string) => {
    update({ scheduledCastTopics: settings!.scheduledCastTopics.filter(t => t !== topic) })
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/></div>
  if (!settings) return null

  if (showSignerFlow) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <button onClick={() => setShowSignerFlow(false)} className="text-gray-400 text-sm">← Back</button>
          <span className="text-sm font-medium text-gray-900">Connect your twin</span>
        </div>
        <SignerConnect
          token={token!}
          onConnected={() => { setShowSignerFlow(false); load() }}
        />
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-5 pb-8">

      {/* Signer status */}
      <div className={`rounded-xl p-4 border ${settings.hasSigner ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm font-medium ${settings.hasSigner ? 'text-green-900' : 'text-amber-900'}`}>
              {settings.hasSigner ? 'Twin connected' : 'Twin not connected'}
            </p>
            <p className={`text-xs mt-0.5 ${settings.hasSigner ? 'text-green-600' : 'text-amber-600'}`}>
              {settings.hasSigner
                ? 'Your twin can post and tip on your behalf'
                : 'Connect to let your twin take actions'}
            </p>
          </div>
          {!settings.hasSigner && (
            <button
              onClick={() => setShowSignerFlow(true)}
              className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg font-medium"
            >
              Connect
            </button>
          )}
          {settings.hasSigner && (
            <span className="text-green-500 text-lg">✓</span>
          )}
        </div>
      </div>

      {/* Autonomy level */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-gray-900">Autonomy level</p>
          <span className="text-xs text-purple-600 font-medium">
            {AUTONOMY_LABELS[settings.autonomyLevel]?.label}
          </span>
        </div>
        <input
          type="range" min={1} max={5} step={1}
          value={settings.autonomyLevel}
          onChange={e => update({ autonomyLevel: parseInt(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>Ask first</span>
          <span>Full autopilot</span>
        </div>
        <p className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">
          {AUTONOMY_LABELS[settings.autonomyLevel]?.desc}
        </p>
      </div>

      {/* Auto-tip */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Auto-tip</p>
            <p className="text-xs text-gray-500">Tip content your twin thinks you'd love</p>
          </div>
          <Toggle
            checked={settings.autoTipEnabled}
            onChange={v => update({ autoTipEnabled: v })}
          />
        </div>

        {settings.autoTipEnabled && (
          <>
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-xs text-gray-500">Tip amount (USDC)</p>
                <span className="text-xs font-medium text-gray-900">${settings.autoTipAmountUsdc.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0.1} max={5} step={0.1}
                value={settings.autoTipAmountUsdc}
                onChange={e => update({ autoTipAmountUsdc: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>$0.10</span><span>$5.00</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <p className="text-xs text-gray-500">Confidence threshold</p>
                <span className="text-xs font-medium text-gray-900">{Math.round(settings.autoTipThreshold * 100)}%</span>
              </div>
              <input
                type="range" min={0.5} max={0.99} step={0.01}
                value={settings.autoTipThreshold}
                onChange={e => update({ autoTipThreshold: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                <span>More tips</span><span>Stricter</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Scheduled casts */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Daily cast</p>
            <p className="text-xs text-gray-500">Twin posts once a day in your voice</p>
          </div>
          <Toggle
            checked={settings.scheduledCastEnabled}
            onChange={v => update({ scheduledCastEnabled: v })}
          />
        </div>

        {settings.scheduledCastEnabled && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Topics to post about</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {settings.scheduledCastTopics.map(t => (
                <span key={t} className="flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">
                  {t}
                  <button onClick={() => removeTopic(t)} className="text-purple-400 hover:text-purple-600 ml-0.5">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={topicInput}
                onChange={e => setTopicInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTopic()}
                placeholder="Add topic…"
                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2"
              />
              <button onClick={addTopic} className="text-xs bg-purple-600 text-white px-3 py-2 rounded-lg">Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Notifications</p>
            <p className="text-xs text-gray-500">Alert when twin has an action pending</p>
          </div>
          <Toggle
            checked={settings.notifyOnAction}
            onChange={v => update({ notifyOnAction: v })}
          />
        </div>
      </div>

      {/* Save indicator */}
      {(saving || saved) && (
        <p className="text-xs text-center text-gray-400">
          {saving ? 'Saving…' : '✓ Saved'}
        </p>
      )}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${checked ? 'bg-purple-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}
