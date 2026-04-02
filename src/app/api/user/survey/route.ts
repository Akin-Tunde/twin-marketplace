// src/app/api/user/survey/route.ts
// Cold-start fix — 5 questions that seed the twin's memory
// for users who have few or no casts yet

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { storeSurveyMemories } from '@/lib/memory'
import { sql } from 'drizzle-orm'

// The 5 survey questions
export const SURVEY_QUESTIONS = [
  {
    id: 'voice',
    question: 'How would you describe your posting style?',
    options: [
      'Short and punchy — I get to the point',
      'Thoughtful and detailed — I explain my reasoning',
      'Conversational and casual — like talking to friends',
      'Technical and precise — I care about accuracy',
    ],
  },
  {
    id: 'topics',
    question: 'What do you post about most?',
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
    question: 'What do you value in a cast?',
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
    question: 'How much should your twin do without asking?',
    options: [
      'Show me everything first — I approve each action',
      'Auto-tip stuff I\'d obviously like, ask me for replies',
      'Handle the small stuff autonomously, surface big decisions',
      'Trust it — I\'ll check the activity log weekly',
    ],
  },
]

// ── GET: return the survey questions ─────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ questions: SURVEY_QUESTIONS })
}

// ── POST: submit answers, seed memory ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { answers } = await req.json()
  // answers: { voice: "Short and punchy", topics: "DeFi...", ... }

  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers object required' }, { status: 400 })
  }

  // Build seed memories from answers
  const seedMemories: Array<{ question: string; answer: string }> = []

  for (const q of SURVEY_QUESTIONS) {
    if (answers[q.id]) {
      seedMemories.push({
        question: q.question,
        answer: answers[q.id],
      })
    }
  }

  // Map autonomy answer to level
  const autonomyMap: Record<string, number> = {
    'Show me everything first — I approve each action': 1,
    'Auto-tip stuff I\'d obviously like, ask me for replies': 2,
    'Handle the small stuff autonomously, surface big decisions': 3,
    'Trust it — I\'ll check the activity log weekly': 4,
  }
  const autonomyLevel = autonomyMap[answers.autonomy] ?? 1

  try {
    // 1. Store survey answers as seed memories in vector store
    await storeSurveyMemories(auth.fid, seedMemories)

    // 2. Update twin settings with autonomy preference
    await db.execute(sql`
      INSERT INTO twin_settings (fid, autonomy_level)
      VALUES (${auth.fid}, ${autonomyLevel})
      ON CONFLICT (fid)
      DO UPDATE SET autonomy_level = ${autonomyLevel}, updated_at = NOW()
    `)

    // 3. Mark onboarding complete on user record
    await db.execute(sql`
      UPDATE users
      SET onboarding_complete = TRUE,
          survey_completed_at = NOW()
      WHERE fid = ${auth.fid}
    `)

    // 4. Initialize stats row
    await db.execute(sql`
      INSERT INTO twin_stats (fid) VALUES (${auth.fid})
      ON CONFLICT (fid) DO NOTHING
    `)

    return NextResponse.json({
      ok: true,
      memoriesSeeded: seedMemories.length,
      autonomyLevel,
      message: `Twin seeded with ${seedMemories.length} memories. Autonomy set to level ${autonomyLevel}.`,
    })
  } catch (err: any) {
    console.error('Survey error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
