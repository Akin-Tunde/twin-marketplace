'use client'
// src/components/twin/MemoryManager.tsx
// Let users see, search, and delete what their twin has learned

import { useState, useEffect, useCallback } from 'react'

interface Props { token: string | null }

const TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  cast:    { label: 'Casts',     icon: '✍️', color: 'bg-purple-50 text-purple-700' },
  reaction:{ label: 'Reactions', icon: '💜', color: 'bg-pink-50 text-pink-700' },
  tip:     { label: 'Tips',      icon: '💸', color: 'bg-green-50 text-green-700' },
  follow:  { label: 'Follows',   icon: '👤', color: 'bg-blue-50 text-blue-700' },
  survey:  { label: 'Survey',    icon: '📋', color: 'bg-amber-50 text-amber-700' },
}

export default function MemoryManager({ token }: Props) {
  const [memories, setMemories]   = useState<any[]>([])
  const [breakdown, setBreakdown] = useState<Record<string, number>>({})
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [query, setQuery]         = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [searching, setSearching] = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState<string | null>(null)

  const load = useCallback(async (q = '', type = '') => {
    if (!token) return
    q ? setSearching(true) : setLoading(true)

    const params = new URLSearchParams({ limit: '20' })
    if (q)    params.set('q', q)
    if (type) params.set('type', type)

    const res  = await fetch(`/api/twin/memory?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    setMemories(data.memories ?? [])
    setBreakdown(data.breakdown ?? {})
    setTotal(data.total ?? 0)
    setLoading(false)
    setSearching(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const deleteMemory = async (id: string) => {
    setDeleting(id)
    await fetch(`/api/twin/memory?id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setMemories(prev => prev.filter(m => m.id !== id))
    setDeleting(null)
  }

  const clearType = async (type: string) => {
    await fetch(`/api/twin/memory?type=${type}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setConfirmClear(null)
    load()
  }

  let searchTimeout: NodeJS.Timeout
  const onSearch = (val: string) => {
    setQuery(val)
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => load(val, typeFilter), 500)
  }

  return (
    <div className="px-4 py-4 space-y-4 pb-8">
      {/* Stats overview */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-medium text-gray-900">Twin memory</p>
          <span className="text-xs text-gray-400">{total} total</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(breakdown).map(([type, cnt]) => {
            const t = TYPE_LABELS[type] ?? { label: type, icon: '🧠', color: 'bg-gray-100 text-gray-600' }
            return (
              <button key={type}
                onClick={() => { setTypeFilter(typeFilter === type ? '' : type); load(query, typeFilter === type ? '' : type) }}
                className={`rounded-xl p-2 text-center transition-colors ${typeFilter === type ? t.color : 'bg-gray-50 text-gray-600'}`}>
                <p className="text-sm">{t.icon}</p>
                <p className="text-xs font-medium">{cnt}</p>
                <p className="text-xs opacity-70">{t.label}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={query}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search your memories…"
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm pr-10"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/>
        )}
      </div>

      {/* Memory list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/>
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <span className="text-3xl block mb-2">🧠</span>
          <p className="text-sm">{query ? 'No matching memories' : 'No memories yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map(m => {
            const t = TYPE_LABELS[m.memory_type] ?? { label: m.memory_type, icon: '🧠', color: 'bg-gray-100 text-gray-600' }
            return (
              <div key={m.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-start gap-3">
                <span className="text-sm mt-0.5 flex-shrink-0">{t.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 leading-relaxed line-clamp-3">{m.content}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${t.color}`}>{t.label}</span>
                    {m.similarity != null && (
                      <span className="text-xs text-gray-400">{Math.round(m.similarity * 100)}% match</span>
                    )}
                    <span className="text-xs text-gray-300">
                      {new Date(m.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => deleteMemory(m.id)}
                  disabled={deleting === m.id}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 text-lg leading-none disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Danger zone */}
      <div className="border border-red-100 rounded-2xl p-4">
        <p className="text-xs font-medium text-red-700 mb-3">Danger zone</p>
        <div className="space-y-2">
          {Object.keys(breakdown).map(type => (
            <div key={type}>
              {confirmClear === type ? (
                <div className="flex gap-2 items-center">
                  <p className="text-xs text-red-600 flex-1">Clear all {TYPE_LABELS[type]?.label ?? type}?</p>
                  <button onClick={() => clearType(type)} className="text-xs bg-red-500 text-white px-3 py-1.5 rounded-lg">Clear</button>
                  <button onClick={() => setConfirmClear(null)} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmClear(type)}
                  className="w-full text-left text-xs text-red-500 border border-red-100 rounded-xl px-3 py-2 hover:bg-red-50 transition-colors">
                  Clear all {TYPE_LABELS[type]?.label ?? type} ({breakdown[type]})
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
