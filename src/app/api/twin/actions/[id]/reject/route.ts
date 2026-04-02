// src/app/api/twin/actions/[id]/reject/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { twinActions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  await db
    .update(twinActions)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(twinActions.id, params.id),
        eq(twinActions.fid, auth.fid)
      )
    )

  return NextResponse.json({ ok: true })
}
