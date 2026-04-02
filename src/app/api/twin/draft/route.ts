// src/app/api/twin/draft/route.ts
/**
 * @agent-action intent=social.cast
 * @description Draft a reply in the user's voice using their cast history
 * @agent-price 0 USDC
 * @agent-sla 5s
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { draftReply } from '@/lib/claude'
import { getCast } from '@/lib/neynar'
import { db } from '@/lib/db'
import { twinActions } from '@/lib/db/schema'
import { applyRateLimit, LIMITS } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const limited = await applyRateLimit(auth.fid, LIMITS.draft)
  if (limited) return limited

  const body = await req.json()
  const { castHash, castText, castAuthor, channel } = body

  if (!castHash && !castText) {
    return NextResponse.json({ error: 'castHash or castText required' }, { status: 400 })
  }

  try {
    // If we have a hash but no text, fetch the cast
    let text = castText
    let author = castAuthor
    if (castHash && !castText) {
      const cast = await getCast(castHash)
      text = cast.text
      author = cast.author.username
    }

    // Generate the draft using RAG
    const result = await draftReply({
      fid: auth.fid,
      castText: text,
      castAuthor: author,
      channel,
    })

    // Save to action log (pending approval by default)
    const [action] = await db
      .insert(twinActions)
      .values({
        fid: auth.fid,
        actionType: 'draft',
        status: 'pending',
        inputData: { castHash, castText: text, castAuthor: author, channel },
        outputData: { draft: result.draft, reasoning: result.reasoning },
        confidence: result.confidence,
      })
      .returning()

    return NextResponse.json({
      actionId: action.id,
      draft: result.draft,
      confidence: result.confidence,
      reasoning: result.reasoning,
    })
  } catch (err: any) {
    console.error('Draft error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
