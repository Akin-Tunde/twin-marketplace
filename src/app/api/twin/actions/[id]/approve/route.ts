// src/app/api/twin/actions/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { twinActions, twinSettings, notificationTokens } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { castOnBehalf } from '@/lib/neynar'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  // Find the action (must belong to this user)
  const action = await db.query.twinActions.findFirst({
    where: and(
      eq(twinActions.id, params.id),
      eq(twinActions.fid, auth.fid),
      eq(twinActions.status, 'pending')
    ),
  })

  if (!action) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  }

  try {
    let result: any = null

    if (action.actionType === 'draft' || action.actionType === 'cast') {
      // Get the user's signer UUID (stored when they granted App Key)
      const settings = await db.query.twinSettings.findFirst({
        where: eq(twinSettings.fid, auth.fid),
      })

      const signerUuid = (settings as any)?.signerUuid
      if (!signerUuid) {
        return NextResponse.json({
          error: 'No signer UUID — user needs to grant App Key first',
        }, { status: 400 })
      }

      const draft = (action.outputData as any)?.draft
      const replyTo = (action.inputData as any)?.castHash

      result = await castOnBehalf({
        signerUuid,
        text: draft,
        replyTo,
      })
    }

    // Mark as executed
    await db
      .update(twinActions)
      .set({ status: 'executed', executedAt: new Date(), outputData: { ...action.outputData as any, result } })
      .where(eq(twinActions.id, params.id))

    return NextResponse.json({ ok: true, result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
