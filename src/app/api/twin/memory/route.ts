// src/app/api/twin/memory/route.ts
// Memory management — view, search, delete what the twin has learned

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { eq, and, desc, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { embed } from '@/lib/memory'

// ── GET: list memories with optional search ───────────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { searchParams } = new URL(req.url)
  const query      = searchParams.get('q')
  const type       = searchParams.get('type')
  const limit      = parseInt(searchParams.get('limit') ?? '30')
  const offset     = parseInt(searchParams.get('offset') ?? '0')

  try {
    let rows: any[]

    if (query) {
      // Semantic search
      const queryEmbedding = await embed(query)
      const embStr = `[${queryEmbedding.join(',')}]`

      rows = await db.execute(sql`
        SELECT
          id, content, memory_type, metadata, created_at, importance,
          1 - (embedding::vector(1536) <=> ${embStr}::vector(1536)) as similarity
        FROM memories
        WHERE fid = ${auth.fid}
          ${type ? sql`AND memory_type = ${type}` : sql``}
        ORDER BY embedding::vector(1536) <=> ${embStr}::vector(1536)
        LIMIT ${limit} OFFSET ${offset}
      `)
    } else {
      rows = await db.execute(sql`
        SELECT id, content, memory_type, metadata, created_at, importance, NULL as similarity
        FROM memories
        WHERE fid = ${auth.fid}
          ${type ? sql`AND memory_type = ${type}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)
    }

    // Get total count + breakdown by type
    const totals = await db.execute(sql`
      SELECT memory_type, COUNT(*) as cnt
      FROM memories WHERE fid = ${auth.fid}
      GROUP BY memory_type
    `)

    const totalCount = (totals as any[]).reduce((s, r) => s + parseInt(r.cnt), 0)

    return NextResponse.json({
      memories:   rows,
      total:      totalCount,
      breakdown:  Object.fromEntries((totals as any[]).map(r => [r.memory_type, parseInt(r.cnt)])),
      offset,
      limit,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE: remove specific memory or clear by type ───────────────────────────
export async function DELETE(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { searchParams } = new URL(req.url)
  const memoryId = searchParams.get('id')
  const type     = searchParams.get('type')
  const all      = searchParams.get('all') === 'true'

  try {
    if (memoryId) {
      // Delete single memory — verify ownership
      await db.execute(sql`
        DELETE FROM memories WHERE id = ${memoryId} AND fid = ${auth.fid}
      `)
      return NextResponse.json({ ok: true, deleted: 1 })
    }

    if (type) {
      // Clear all memories of a type
      const result = await db.execute(sql`
        DELETE FROM memories WHERE fid = ${auth.fid} AND memory_type = ${type}
        RETURNING id
      `)
      return NextResponse.json({ ok: true, deleted: (result as any[]).length })
    }

    if (all) {
      // Nuclear option — clear all memories
      const result = await db.execute(sql`
        DELETE FROM memories WHERE fid = ${auth.fid} RETURNING id
      `)
      return NextResponse.json({ ok: true, deleted: (result as any[]).length, warning: 'All twin memories cleared' })
    }

    return NextResponse.json({ error: 'Specify id, type, or all=true' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH: update memory importance / pin it ──────────────────────────────────
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { id, importance } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await db.execute(sql`
    UPDATE memories
    SET importance = ${importance ?? 1.0}
    WHERE id = ${id} AND fid = ${auth.fid}
  `)

  return NextResponse.json({ ok: true })
}
