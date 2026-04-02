// src/app/api/twin/vote/route.ts
/**
 * @agent-action intent=governance.vote
 * @description Vote in DAO proposals based on user values
 * @agent-price 0 USDC
 * @agent-sla 15s
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { applyRateLimit, LIMITS } from '@/lib/ratelimit'
import { db } from '@/lib/db'
import { twinActions } from '@/lib/db/schema'
import { fetchSnapshotProposals, decideTwinVote, castSnapshotVote } from '@/lib/dao'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

const VoteSchema = z.object({
  platform:       z.enum(['snapshot', 'tally']),
  space:          z.string(),                   // e.g. 'nouns.eth'
  proposalId:     z.string().optional(),        // vote on specific proposal
  autoVote:       z.boolean().default(false),   // execute vote autonomously
})

// ── GET: fetch proposals + twin's pre-decision ────────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { searchParams } = new URL(req.url)
  const space    = searchParams.get('space') ?? 'arbitrumfoundation.eth'
  const platform = searchParams.get('platform') ?? 'snapshot'

  try {
    const proposals = platform === 'snapshot'
      ? await fetchSnapshotProposals(space)
      : []

    // Pre-compute twin's decision for each active proposal
    const withDecisions = await Promise.all(
      proposals.slice(0, 5).map(async (p: any) => {
        const decision = await decideTwinVote({
          fid:           auth.fid,
          proposalTitle: p.title,
          proposalBody:  p.body ?? p.description ?? '',
          choices:       p.choices ?? ['For', 'Against', 'Abstain'],
          platform:      'snapshot',
        })
        return { ...p, twinDecision: decision }
      })
    )

    return NextResponse.json({ proposals: withDecisions, space, platform })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST: execute a vote ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  // Rate limit: 10 votes per day
  const limited = await applyRateLimit(auth.fid, { limit: 10, windowSecs: 86400, keyPrefix: 'vote' })
  if (limited) return limited

  const body = await req.json()
  const parsed = VoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { platform, space, proposalId, autoVote } = parsed.data

  try {
    // Get user settings
    const settings = await db.execute(sql`
      SELECT ts.dao_vote_enabled, ts.autonomy_level, ts.signer_uuid,
             u.verified_address
      FROM twin_settings ts JOIN users u ON u.fid = ts.fid
      WHERE ts.fid = ${auth.fid}
    `)
    const s = (settings as any[])[0]

    if (!s?.dao_vote_enabled) {
      return NextResponse.json({ error: 'DAO voting not enabled in twin settings' }, { status: 400 })
    }

    // Get proposal details
    let proposal: any
    if (platform === 'snapshot') {
      const proposals = await fetchSnapshotProposals(space)
      proposal = proposalId
        ? proposals.find((p: any) => p.id === proposalId)
        : proposals[0]
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get twin's decision
    const decision = await decideTwinVote({
      fid:           auth.fid,
      proposalTitle: proposal.title,
      proposalBody:  proposal.body ?? '',
      choices:       proposal.choices ?? ['For', 'Against', 'Abstain'],
      platform,
    })

    // Store as pending action
    const [action] = await db.insert(twinActions).values({
      fid:        auth.fid,
      actionType: 'vote',
      status:     (autoVote && decision.shouldVote && s.autonomy_level >= 4) ? 'approved' : 'pending',
      inputData:  { platform, space, proposalId: proposal.id, proposalTitle: proposal.title },
      outputData: { decision: decision.decision, reasoning: decision.reasoning },
      confidence: decision.confidence,
    }).returning()

    // Store in dao_votes
    await db.execute(sql`
      INSERT INTO dao_votes (fid, proposal_id, dao_name, platform, proposal_title,
        proposal_summary, twin_decision, twin_reasoning, confidence, status)
      VALUES (${auth.fid}, ${proposal.id}, ${space}, ${platform}, ${proposal.title},
        ${proposal.body?.slice(0, 500) ?? ''}, ${decision.decision},
        ${decision.reasoning}, ${decision.confidence}, 'pending')
      ON CONFLICT (fid, proposal_id) DO UPDATE
      SET twin_decision = EXCLUDED.twin_decision,
          twin_reasoning = EXCLUDED.twin_reasoning,
          confidence = EXCLUDED.confidence
    `)

    // Execute if auto-approved
    let txResult: any = null
    if (action.status === 'approved' && s.verified_address && decision.shouldVote) {
      const choiceIndex = (proposal.choices ?? ['For', 'Against', 'Abstain'])
        .indexOf(decision.decision) + 1

      if (platform === 'snapshot' && choiceIndex > 0) {
        txResult = await castSnapshotVote({
          proposalId:    proposal.id,
          choice:        choiceIndex,
          voterAddress:  s.verified_address,
          privateKey:    process.env.MARKETPLACE_WALLET_PRIVATE_KEY!,
        })

        await db.execute(sql`
          UPDATE dao_votes SET status = 'voted', voted_at = NOW()
          WHERE fid = ${auth.fid} AND proposal_id = ${proposal.id}
        `)

        await db.execute(sql`
          UPDATE twin_stats SET votes_cast = votes_cast + 1, updated_at = NOW()
          WHERE fid = ${auth.fid}
        `)
      }
    }

    return NextResponse.json({
      actionId:  action.id,
      status:    action.status,
      proposal:  { id: proposal.id, title: proposal.title },
      decision:  decision.decision,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      shouldVote: decision.shouldVote,
      executed:  !!txResult,
      txResult,
    })
  } catch (err: any) {
    console.error('Vote error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
