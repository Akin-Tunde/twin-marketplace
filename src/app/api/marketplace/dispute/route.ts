// src/app/api/marketplace/dispute/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { jobs, reputationEvents, agentRegistry } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { openDispute, resolveDispute } from '@/lib/escrow'
import { sql } from 'drizzle-orm'

// ── POST: open a dispute ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { jobId, reason, evidence } = await req.json()
  if (!jobId || !reason) {
    return NextResponse.json({ error: 'jobId and reason required' }, { status: 400 })
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  if (job.requesterFid !== auth.fid && job.assignedAgentFid !== auth.fid) {
    return NextResponse.json({ error: 'Only parties to this job can open a dispute' }, { status: 403 })
  }

  if (!['in_progress', 'submitted', 'completed'].includes(job.status)) {
    return NextResponse.json({ error: `Cannot dispute a job with status: ${job.status}` }, { status: 400 })
  }

  // Open dispute on chain if escrow is locked
  let txHash: string | undefined
  if (job.escrowTxHash) {
    try {
      txHash = await openDispute(jobId)
    } catch (err: any) {
      console.error('On-chain dispute failed:', err.message)
    }
  }

  // Record in DB
  await db.update(jobs).set({ status: 'disputed', disputeOpenedAt: new Date() } as any).where(eq(jobs.id, jobId))
  await db.execute(sql`
    INSERT INTO disputes (job_id, opened_by_fid, reason, evidence, status)
    VALUES (${jobId}, ${auth.fid}, ${reason}, ${JSON.stringify(evidence ?? {})}, 'open')
  `)

  return NextResponse.json({ ok: true, jobId, txHash, message: 'Dispute opened. Admin will review within 48h.' })
}

// ── GET: list open disputes (admin) ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult

  const disputes = await db.execute(sql`
    SELECT d.*, j.description, j.budget_usdc, j.requester_fid, j.assigned_agent_fid,
           j.escrow_tx_hash
    FROM disputes d
    JOIN jobs j ON j.id = d.job_id
    WHERE d.status = 'open'
    ORDER BY d.created_at DESC
    LIMIT 50
  `)

  return NextResponse.json({ disputes })
}

// ── PATCH: resolve a dispute (admin only) ─────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  // TODO: add proper admin check (e.g. allowlist of FIDs)
  const ADMIN_FIDS = (process.env.ADMIN_FIDS ?? '').split(',').map(Number)
  if (!ADMIN_FIDS.includes(auth.fid)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const { jobId, agentWon, resolution } = await req.json()
  if (!jobId || agentWon === undefined) {
    return NextResponse.json({ error: 'jobId and agentWon required' }, { status: 400 })
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Resolve on chain if escrow is locked
  let txHash: string | undefined
  if (job.escrowTxHash) {
    try {
      txHash = await resolveDispute(jobId, agentWon)
    } catch (err: any) {
      console.error('On-chain resolution failed:', err.message)
    }
  }

  const winner = agentWon ? 'agent' : 'requester'

  // Update job + dispute
  await db.update(jobs).set({ status: 'completed', disputeResolvedAt: new Date(), disputeWinner: winner } as any).where(eq(jobs.id, jobId))
  await db.execute(sql`
    UPDATE disputes SET status = 'resolved', resolution = ${resolution ?? `Resolved in favor of ${winner}`},
    resolved_by = ${auth.fid}, updated_at = NOW() WHERE job_id = ${jobId}
  `)

  // Reputation consequences
  if (job.assignedAgentFid) {
    const delta = agentWon ? 8 : -15 // win = big boost, lose = hard penalty
    await db.insert(reputationEvents).values({
      agentFid: job.assignedAgentFid,
      jobId: job.id,
      eventType: agentWon ? 'dispute_won' : 'dispute_lost',
      scoreDelta: delta,
      metadata: { resolution },
    })

    // Recalc
    const events = await db.query.reputationEvents.findMany({ where: eq(reputationEvents.agentFid, job.assignedAgentFid) })
    const newScore = Math.min(100, Math.max(0, events.reduce((s, e) => s + e.scoreDelta, 0)))
    await db.update(agentRegistry).set({ reputationScore: newScore }).where(eq(agentRegistry.fid, job.assignedAgentFid))
  }

  return NextResponse.json({ ok: true, jobId, winner, txHash })
}
