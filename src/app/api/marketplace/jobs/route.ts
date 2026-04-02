// src/app/api/marketplace/jobs/route.ts — Week 3 with real USDC escrow

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { FarcasterAgent } from 'farcaster-agent-sdk'
import { ActionExecutor } from 'farcaster-agent-sdk/executor'
import { db } from '@/lib/db'
import { jobs, agentRegistry, reputationEvents } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { matchJobToAgent, verifyJobOutput } from '@/lib/claude'
import { lockFunds, releasePayment, refundRequester } from '@/lib/escrow'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

const PostJobSchema = z.object({
  requiredIntent: z.string(),
  description:    z.string().min(10).max(500),
  inputParams:    z.record(z.any()).optional(),
  budgetUsdc:     z.number().min(0),
  deadlineHours:  z.number().min(1).max(168).default(24),
  lockEscrow:     z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const body = await req.json()
  const parsed = PostJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { requiredIntent, description, inputParams, budgetUsdc, deadlineHours, lockEscrow } = parsed.data

  const registeredAgents = await db.query.agentRegistry.findMany({
    where: eq(agentRegistry.isActive, true),
  })
  const eligible = registeredAgents.filter(
    a => a.supportedIntents?.includes(requiredIntent) && (a.priceFloorUsdc ?? 0) <= budgetUsdc
  )
  if (eligible.length === 0) {
    return NextResponse.json({ error: 'No agents available for this intent within budget', intent: requiredIntent, budget: budgetUsdc }, { status: 404 })
  }

  const { rankedFids, reasoning } = await matchJobToAgent({
    jobDescription: description,
    requiredIntent,
    budgetUsdc,
    agents: eligible.map(a => ({ fid: a.fid, name: a.name, supportedIntents: a.supportedIntents ?? [], reputationScore: a.reputationScore ?? 0, priceFloorUsdc: a.priceFloorUsdc ?? 0, avgCompletionMs: a.avgCompletionMs ?? 30000 })),
  })

  const bestAgentFid = rankedFids[0]
  if (!bestAgentFid) return NextResponse.json({ error: 'Matching failed' }, { status: 500 })
  const bestAgent = eligible.find(a => a.fid === bestAgentFid)!

  const [job] = await db.insert(jobs).values({
    requesterFid: auth.fid,
    assignedAgentFid: bestAgentFid,
    requiredIntent,
    description,
    inputParams: inputParams ?? {},
    budgetUsdc,
    status: 'matched',
    deadlineAt: new Date(Date.now() + deadlineHours * 3600 * 1000),
  }).returning()

  let escrowTxHash: string | undefined

  if (lockEscrow && budgetUsdc > 0) {
    try {
      const agentUser = await db.execute(sql`SELECT verified_address FROM users WHERE fid = ${bestAgentFid}`)
      const agentWallet = (agentUser as any[])[0]?.verified_address
      if (!agentWallet) throw new Error('Agent has no verified wallet address')

      const { txHash } = await lockFunds({ jobId: job.id, agentWalletAddress: agentWallet, amountUsdc: budgetUsdc, jobParams: { description, requiredIntent, inputParams }, deadlineHours })
      escrowTxHash = txHash
      await db.update(jobs).set({ escrowTxHash: txHash, status: 'in_progress' }).where(eq(jobs.id, job.id))
      await db.execute(sql`INSERT INTO escrow_transactions (job_id, tx_type, tx_hash, amount_usdc, status) VALUES (${job.id}, 'lock', ${txHash}, ${budgetUsdc}, 'confirmed')`)
    } catch (err: any) {
      console.error('Escrow lock failed:', err.message)
      await db.update(jobs).set({ status: 'in_progress' }).where(eq(jobs.id, job.id))
    }
  } else {
    await db.update(jobs).set({ status: 'in_progress' }).where(eq(jobs.id, job.id))
  }

  try {
    const agentApp = await FarcasterAgent.load(bestAgent.agentJsonUrl)
    const action = agentApp.manifest.actions?.find((a: any) => a.intent === requiredIntent)
    if (!action) throw new Error(`Agent has no action with intent ${requiredIntent}`)

    const executor = new ActionExecutor({ defaultContext: { baseUrl: bestAgent.agentJsonUrl.replace('/agent.json', ''), timeoutMs: 60_000 } })
    const execResult = await executor.execute(action, inputParams ?? {})
    if (!execResult.success) throw new Error(execResult.error ?? 'Execution failed')

    const verification = await verifyJobOutput({ jobDescription: description, actualOutput: execResult.data })
    const finalStatus = verification.verified ? 'completed' : 'submitted'

    await db.update(jobs).set({ status: finalStatus, outputResult: { data: execResult.data, verification }, completedAt: verification.verified ? new Date() : undefined }).where(eq(jobs.id, job.id))

    if (verification.verified) {
      if (lockEscrow && escrowTxHash) {
        try {
          const releaseTxHash = await releasePayment(job.id)
          await db.update(jobs).set({ releaseTxHash }).where(eq(jobs.id, job.id))
          await db.execute(sql`INSERT INTO escrow_transactions (job_id, tx_type, tx_hash, amount_usdc, status) VALUES (${job.id}, 'release', ${releaseTxHash}, ${budgetUsdc}, 'confirmed')`)
        } catch (err: any) { console.error('Release failed:', err.message) }
      }

      const scoreDelta = 5 + (verification.score / 100) * 5
      await db.insert(reputationEvents).values({ agentFid: bestAgentFid, jobId: job.id, eventType: 'job_completed', scoreDelta, metadata: { score: verification.score } })
      await recalcReputation(bestAgentFid)
      await db.execute(sql`UPDATE agent_registry SET total_earnings_usdc = COALESCE(total_earnings_usdc, 0) + ${budgetUsdc * 0.95} WHERE fid = ${bestAgentFid}`)
    }

    return NextResponse.json({ jobId: job.id, status: finalStatus, agentFid: bestAgentFid, agentName: bestAgent.name, result: execResult.data, verification, escrowLocked: !!escrowTxHash, escrowTxHash, matchReasoning: reasoning })
  } catch (err: any) {
    if (lockEscrow && escrowTxHash) {
      try { await refundRequester(job.id) } catch (e: any) { console.error('Refund failed:', e.message) }
    }
    await db.update(jobs).set({ status: 'open' }).where(eq(jobs.id, job.id))
    await db.insert(reputationEvents).values({ agentFid: bestAgentFid, jobId: job.id, eventType: 'job_failed', scoreDelta: -3, metadata: { error: err.message } }).catch(console.error)
    await recalcReputation(bestAgentFid)
    return NextResponse.json({ jobId: job.id, status: 'failed', error: err.message, matchReasoning: reasoning }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult
  const { searchParams } = new URL(req.url)
  const role = searchParams.get('role') ?? 'requester'

  const myJobs = await db.select().from(jobs)
    .where(role === 'requester' ? eq(jobs.requesterFid, auth.fid) : eq(jobs.assignedAgentFid, auth.fid))
    .orderBy(desc(jobs.createdAt))
    .limit(30)

  return NextResponse.json({ jobs: myJobs })
}

async function recalcReputation(agentFid: number) {
  const events = await db.query.reputationEvents.findMany({ where: eq(reputationEvents.agentFid, agentFid) })
  const completed  = events.filter(e => e.eventType === 'job_completed').length
  const failed     = events.filter(e => e.eventType === 'job_failed').length
  const totalJobs  = completed + failed
  const successRate = totalJobs > 0 ? completed / totalJobs : 1.0
  const newScore   = Math.min(100, Math.max(0, events.reduce((s, e) => s + e.scoreDelta, 0)))

  await db.update(agentRegistry).set({ reputationScore: newScore, totalJobs, successRate }).where(eq(agentRegistry.fid, agentFid))
  await db.execute(sql`INSERT INTO reputation_snapshots (agent_fid, score, total_jobs, success_rate) VALUES (${agentFid}, ${newScore}, ${totalJobs}, ${successRate})`)
}
