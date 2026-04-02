// src/app/api/twin/actions/route.ts — list pending actions
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { twinActions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? 'pending'

  const rows = await db.query.twinActions.findMany({
    where: and(
      eq(twinActions.fid, auth.fid),
      eq(twinActions.status, status)
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 20,
  })

  return NextResponse.json({ actions: rows })
}
