'use client'
// src/components/OnboardingSurvey.tsx
// Shown on first open when user has no cast history
// 5 questions → seeds the vector memory → unlocks the twin

import { useState } from 'react'

const QUESTIONS = [
  {
    id: 'voice',
    emoji: '🎙️',
    question: 'How do you write on Farcaster?',
    options: [
      'Short and punchy — I get to the point',
      'Thoughtful and detailed — I explain my reasoning',
      'Conversational and casual — like talking to friends',
      'Technical and precise — I care about accuracy',
    ],
  },
  {
    id: 'topics',
    emoji: '🧭',
    question: 'What do you mostly post about?',
    options: [
      'DeFi, trading, and onchain finance',
      'NFTs, art, and creator economy',
      'Building products and dev stuff',
      'Culture, memes, and community vibes',
      'Mix of everything',
    ],
  },
  {
    id: 'engagement',
    emoji: '💬',
    question: 'How do you engage with others?',
    options: [
      'I reply to most things that interest me',
      'I recast more than I reply',
      'I tip content I find valuable',
      'I mostly post original thoughts',
    ],
  },
  {
    id: 'values',
    emoji: '⭐',
    question: 'What makes a cast worth your attention?',
    options: [
      'Original insight — something I hadn\'t considered',
      'Good vibes and positive energy',
      'Technical depth and accuracy',
      'Humor and entertainment',
      'Real talk — no hype, no fluff',
    ],
  },
  {
    id: 'autonomy',
    emoji: '🤖',
    question: 'How autonomous should your twin be?',
    options: [
      'Show me everything first — I approve each action',
      'Auto-tip stuff I\'d obviously like, ask me for replies',
      'Handle the small stuff, surface big decisions',
      'Trust it — I\'ll check the log weekly',
    ],
  },
]

interface Props {
  token: string
  onComplete: () => void
}

export default function OnboardingSurvey({ token, onComplete }: Props) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const q = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const progress = ((step) / QUESTIONS.length) * 100

  const select = (option: string) => {
    const next = { ...answers, [q.id]: option }
    setAnswers(next)

    if (isLast) {
      submit(next)
    } else {
      setTimeout(() => setStep(s => s + 1), 200)
    }
  }

  const submit = async (finalAnswers: Record<string, string>) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/user/survey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answers: finalAnswers }),
      })
      if (!res.ok) throw new Error('Survey submission failed')
      onComplete()
    } catch (err: any) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  if (submitting) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 px-6">
        <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-medium text-gray-900">Building your twin's memory…</p>
        <p className="text-xs text-gray-500 mt-1 text-center">
          Embedding your answers into the vector store
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-purple-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 px-5 py-6 flex flex-col">
        {/* Step counter */}
        <p className="text-xs text-gray-400 mb-6">
          Question {step + 1} of {QUESTIONS.length}
        </p>

        {/* Question */}
        <div className="mb-8">
          <span className="text-3xl mb-3 block">{q.emoji}</span>
          <h2 className="text-lg font-medium text-gray-900 leading-snug">
            {q.question}
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            This teaches your twin how you think
          </p>
        </div>

        {/* Options */}
        <div className="space-y-2.5">
          {q.options.map(option => (
            <button
              key={option}
              onClick={() => select(option)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all active:scale-[0.98] ${
                answers[q.id] === option
                  ? 'border-purple-400 bg-purple-50 text-purple-900'
                  : 'border-gray-200 bg-white text-gray-800 hover:border-purple-200 hover:bg-purple-50/50'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-500 mt-4 text-center">{error}</p>
        )}

        {/* Back button */}
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="mt-6 text-xs text-gray-400 text-center w-full"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  )
}
