// src/app/api/marketplace/jobs/[id]/route.ts
// Get a single job + poll status + submit rating

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { jobs, agentRegistry } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getEscrowJob } from '@/lib/escrow'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.id) })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  if (job.requesterFid !== auth.fid && job.assignedAgentFid !== auth.fid) {
    return NextResponse.json({ error: 'Not your job' }, { status: 403 })
  }

  // Get agent info
  const agent = job.assignedAgentFid
    ? await db.query.agentRegistry.findFirst({ where: eq(agentRegistry.fid, job.assignedAgentFid) })
    : null

  // Get escrow status from chain if applicable
  let onChainStatus = null
  if (job.escrowTxHash) {
    try { onChainStatus = await getEscrowJob(job.id) } catch { /* ignore */ }
  }

  // Get escrow transactions
  const txs = await db.execute(sql`
    SELECT * FROM escrow_transactions WHERE job_id = ${job.id} ORDER BY created_at
  `)

  return NextResponse.json({
    ...job,
    agent: agent ? { fid: agent.fid, name: agent.name, reputationScore: agent.reputationScore } : null,
    onChainStatus,
    transactions: txs,
  })
}

// ── PATCH: submit rating ──────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { rating, ratingNote } = await req.json()
  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be 1–5' }, { status: 400 })
  }

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.id) })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (job.requesterFid !== auth.fid) return NextResponse.json({ error: 'Only requester can rate' }, { status: 403 })
  if (job.status !== 'completed') return NextResponse.json({ error: 'Can only rate completed jobs' }, { status: 400 })

  await db.update(jobs).set({ rating, ratingNote }).where(eq(jobs.id, params.id))

  return NextResponse.json({ ok: true, rating })
}
