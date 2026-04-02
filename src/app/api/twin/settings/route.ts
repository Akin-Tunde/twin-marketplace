// src/app/api/twin/settings/route.ts
// Read and update twin settings — autonomy, auto-tip, scheduled casts, etc.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { twinSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

const SettingsSchema = z.object({
  autonomyLevel:          z.number().min(1).max(5).optional(),
  autoTipEnabled:         z.boolean().optional(),
  autoTipThreshold:       z.number().min(0).max(1).optional(),
  autoTipAmountUsdc:      z.number().min(0).max(100).optional(),
  scheduledCastEnabled:   z.boolean().optional(),
  scheduledCastTopics:    z.array(z.string()).optional(),
  daoVoteEnabled:         z.boolean().optional(),
  notifyOnAction:         z.boolean().optional(),
})

// ── GET: return current settings + signer status ──────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  // Get settings including signer_uuid via raw query
  const rows = await db.execute(sql`
    SELECT
      ts.*,
      CASE WHEN ts.signer_uuid IS NOT NULL THEN TRUE ELSE FALSE END as has_signer,
      u.onboarding_complete,
      COALESCE(st.drafts_shown, 0) as drafts_shown,
      COALESCE(st.drafts_approved, 0) as drafts_approved,
      COALESCE(st.casts_posted, 0) as casts_posted,
      COALESCE(st.tips_sent, 0) as tips_sent,
      COALESCE(st.usdc_tipped, 0) as usdc_tipped,
      COALESCE(st.memory_count, 0) as memory_count,
      COALESCE(st.streak_days, 0) as streak_days
    FROM twin_settings ts
    LEFT JOIN users u ON u.fid = ts.fid
    LEFT JOIN twin_stats st ON st.fid = ts.fid
    WHERE ts.fid = ${auth.fid}
  `)

  if (!rows || (rows as any[]).length === 0) {
    // Return defaults for new user
    return NextResponse.json({
      fid: auth.fid,
      autonomyLevel: 1,
      autoTipEnabled: false,
      autoTipThreshold: 0.85,
      autoTipAmountUsdc: 0.5,
      scheduledCastEnabled: false,
      scheduledCastTopics: [],
      daoVoteEnabled: false,
      notifyOnAction: true,
      hasSigner: false,
      onboardingComplete: false,
      stats: { draftsShown: 0, draftsApproved: 0, castsPosted: 0, tipsSent: 0, usdcTipped: 0 },
    })
  }

  const row = (rows as any[])[0]

  return NextResponse.json({
    fid: auth.fid,
    autonomyLevel: row.autonomy_level,
    autoTipEnabled: row.auto_tip_enabled,
    autoTipThreshold: row.auto_tip_threshold,
    autoTipAmountUsdc: row.auto_tip_amount_usdc,
    scheduledCastEnabled: row.scheduled_cast_enabled,
    scheduledCastTopics: row.scheduled_cast_topics ?? [],
    daoVoteEnabled: row.dao_vote_enabled,
    notifyOnAction: row.notify_on_action,
    hasSigner: row.has_signer,
    onboardingComplete: row.onboarding_complete,
    stats: {
      draftsShown: row.drafts_shown,
      draftsApproved: row.drafts_approved,
      castsPosted: row.casts_posted,
      tipsSent: row.tips_sent,
      usdcTipped: row.usdc_tipped,
      memoriesStored: row.memory_count,
      streakDays: row.streak_days,
    },
  })
}

// ── PATCH: update settings ────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const body = await req.json()
  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const updates = parsed.data

  // Build dynamic SET clause
  const setClauses: string[] = ['updated_at = NOW()']
  const values: any[] = []
  let idx = 1

  if (updates.autonomyLevel !== undefined) {
    setClauses.push(`autonomy_level = $${idx++}`)
    values.push(updates.autonomyLevel)
  }
  if (updates.autoTipEnabled !== undefined) {
    setClauses.push(`auto_tip_enabled = $${idx++}`)
    values.push(updates.autoTipEnabled)
  }
  if (updates.autoTipThreshold !== undefined) {
    setClauses.push(`auto_tip_threshold = $${idx++}`)
    values.push(updates.autoTipThreshold)
  }
  if (updates.autoTipAmountUsdc !== undefined) {
    setClauses.push(`auto_tip_amount_usdc = $${idx++}`)
    values.push(updates.autoTipAmountUsdc)
  }
  if (updates.scheduledCastEnabled !== undefined) {
    setClauses.push(`scheduled_cast_enabled = $${idx++}`)
    values.push(updates.scheduledCastEnabled)
  }
  if (updates.scheduledCastTopics !== undefined) {
    setClauses.push(`scheduled_cast_topics = $${idx++}`)
    values.push(updates.scheduledCastTopics)
  }
  if (updates.daoVoteEnabled !== undefined) {
    setClauses.push(`dao_vote_enabled = $${idx++}`)
    values.push(updates.daoVoteEnabled)
  }
  if (updates.notifyOnAction !== undefined) {
    setClauses.push(`notify_on_action = $${idx++}`)
    values.push(updates.notifyOnAction)
  }

  if (values.length === 0) {
    return NextResponse.json({ ok: true, message: 'Nothing to update' })
  }

  values.push(auth.fid)

  await db.execute(
    sql.raw(
      `UPDATE twin_settings SET ${setClauses.join(', ')} WHERE fid = $${idx}`
    )
  )

  return NextResponse.json({ ok: true, updated: Object.keys(updates) })
}
