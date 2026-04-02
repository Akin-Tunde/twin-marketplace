// src/app/api/twin/ingest/route.ts
// Neynar webhook — fires on every cast, reaction, tip
// This is the live memory feed for every twin

import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/neynar'
import { storeMemory } from '@/lib/memory'
import { shouldAutoTip } from '@/lib/claude'
import { db } from '@/lib/db'
import { users, twinSettings, twinActions, notificationTokens } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendNotification } from '@/lib/neynar'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-neynar-signature') ?? ''

  // 1. Verify webhook is genuinely from Neynar
  const valid = await verifyWebhookSignature(rawBody, signature)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const { type, data } = event

  try {
    switch (type) {
      // ── User cast a new post ────────────────────────────────────────────────
      case 'cast.created': {
        const cast = data
        const fid: number = cast.author.fid

        // Store in vector memory for this user's twin
        await storeMemory({
          fid,
          castHash: cast.hash,
          content: cast.text,
          memoryType: 'cast',
          metadata: {
            timestamp: cast.timestamp,
            channel: cast.channel?.id ?? null,
            parentHash: cast.parent_hash ?? null,
          },
        })

        // Check if anyone's twin should auto-reply to this cast
        // (e.g., if the cast mentions a user whose twin has auto-reply enabled)
        if (cast.mentioned_profiles?.length > 0) {
          for (const mentioned of cast.mentioned_profiles) {
            await checkAndQueueAutoReply({
              targetFid: mentioned.fid,
              castHash: cast.hash,
              castText: cast.text,
              castAuthor: cast.author.username,
              channel: cast.channel?.id,
            })
          }
        }

        break
      }

      // ── User liked or recasted something ───────────────────────────────────
      case 'cast.reaction.created': {
        const { reaction, cast } = data
        const fid: number = reaction.fid

        await storeMemory({
          fid,
          content: `I ${reaction.reaction_type === 'like' ? 'liked' : 'recasted'}: "${cast.text}"`,
          memoryType: 'reaction',
          metadata: {
            reactionType: reaction.reaction_type,
            castHash: cast.hash,
            castAuthor: cast.author?.username,
          },
        })

        break
      }

      // ── User followed someone ──────────────────────────────────────────────
      case 'follow.created': {
        const { follower, followee } = data

        await storeMemory({
          fid: follower.fid,
          content: `I followed @${followee.username} (FID: ${followee.fid})`,
          memoryType: 'follow',
          metadata: { followeeFid: followee.fid, followeeUsername: followee.username },
        })

        break
      }

      default:
        // Unknown event type — ignore silently
        break
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
    // Still return 200 so Neynar doesn't retry
  }

  return NextResponse.json({ ok: true })
}

// ── Internal: check if a twin should auto-reply ───────────────────────────────

async function checkAndQueueAutoReply({
  targetFid,
  castHash,
  castText,
  castAuthor,
  channel,
}: {
  targetFid: number
  castHash: string
  castText: string
  castAuthor: string
  channel?: string
}) {
  // Check if this user has a twin with autonomy level >= 2
  const settings = await db.query.twinSettings.findFirst({
    where: eq(twinSettings.fid, targetFid),
  })
  if (!settings || settings.autonomyLevel < 2) return

  // Get auto-tip decision from Claude (reuse the relevance scoring)
  const { tip: relevant, confidence } = await shouldAutoTip({
    fid: targetFid,
    castText,
    castAuthor,
    threshold: 0.75,
  })
  if (!relevant) return

  // Queue a draft action in the inbox
  await db.insert(twinActions).values({
    fid: targetFid,
    actionType: 'draft',
    status: settings.autonomyLevel >= 3 ? 'approved' : 'pending',
    inputData: { castHash, castText, castAuthor, channel },
    confidence,
  })

  // Notify the user their twin has a pending action
  if (settings.notifyOnAction) {
    const tokenRow = await db.query.notificationTokens.findFirst({
      where: eq(notificationTokens.fid, targetFid),
    })
    if (tokenRow) {
      await sendNotification({
        tokens: [{ token: tokenRow.token, url: tokenRow.url }],
        title: 'Your twin has a draft reply',
        body: `@${castAuthor} cast something you might want to reply to.`,
        targetUrl: `${process.env.NEXT_PUBLIC_APP_URL}/inbox`,
      })
    }
  }
}
