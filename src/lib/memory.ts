// src/lib/memory.ts
// Vector memory — the twin's brain
// Embeds casts → stores in pgvector → similarity search for RAG

import OpenAI from 'openai'
import { db } from './db'
import { memories, users } from './db/schema'
import { eq, sql, and } from 'drizzle-orm'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// ── Embedding ─────────────────────────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000), // token limit safety
  })
  return res.data[0].embedding
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts.map(t => t.slice(0, 8000)),
  })
  return res.data.map(d => d.embedding)
}

// ── Store a single memory ─────────────────────────────────────────────────────

export async function storeMemory({
  fid,
  castHash,
  content,
  memoryType,
  metadata,
}: {
  fid: number
  castHash?: string
  content: string
  memoryType: 'cast' | 'reaction' | 'tip' | 'follow' | 'survey'
  metadata?: Record<string, any>
}) {
  const embedding = await embed(content)

  await db
    .insert(memories)
    .values({
      fid,
      castHash,
      content,
      memoryType,
      embedding: JSON.stringify(embedding),
      metadata,
    })
    .onConflictDoNothing() // skip if castHash already stored
}

// ── Ingest full cast history ──────────────────────────────────────────────────

export async function ingestCastHistory(
  fid: number,
  casts: any[],
  onProgress?: (done: number, total: number) => void
) {
  const BATCH = 20
  let done = 0

  for (let i = 0; i < casts.length; i += BATCH) {
    const batch = casts.slice(i, i + BATCH)
    const texts = batch.map(c => c.text)
    const embeddings = await embedBatch(texts)

    await db
      .insert(memories)
      .values(
        batch.map((c, j) => ({
          fid,
          castHash: c.hash,
          content: c.text,
          memoryType: 'cast' as const,
          embedding: JSON.stringify(embeddings[j]),
          metadata: {
            timestamp: c.timestamp,
            likes: c.reactions?.likes_count ?? 0,
            recasts: c.reactions?.recasts_count ?? 0,
            channel: c.channel?.id ?? null,
            replies: c.replies?.count ?? 0,
          },
        }))
      )
      .onConflictDoNothing()

    done += batch.length
    onProgress?.(done, casts.length)
  }
}

// ── Similarity search (RAG retrieval) ─────────────────────────────────────────

export async function similarMemories(
  fid: number,
  query: string,
  { k = 10, memoryTypes }: { k?: number; memoryTypes?: string[] } = {}
): Promise<Array<{ content: string; similarity: number; metadata: any }>> {
  const queryEmbedding = await embed(query)
  const embStr = `[${queryEmbedding.join(',')}]`

  // Raw SQL for pgvector cosine similarity
  // Drizzle doesn't natively support vector ops yet
  const typeFilter = memoryTypes?.length
    ? `AND memory_type = ANY(ARRAY[${memoryTypes.map(t => `'${t}'`).join(',')}])`
    : ''

  const rows = await db.execute(sql`
    SELECT content, metadata,
           1 - (embedding::vector(1536) <=> ${embStr}::vector(1536)) AS similarity
    FROM memories
    WHERE fid = ${fid}
    ${sql.raw(typeFilter)}
    ORDER BY embedding::vector(1536) <=> ${embStr}::vector(1536)
    LIMIT ${k}
  `)

  return (rows as any[]).map(r => ({
    content: r.content,
    similarity: parseFloat(r.similarity),
    metadata: r.metadata,
  }))
}

// ── User voice profile (for system prompt) ───────────────────────────────────

export async function getUserVoiceProfile(fid: number): Promise<string> {
  // Get a diverse sample of top-performing casts to capture voice
  const topCasts = await db.execute(sql`
    SELECT content, metadata
    FROM memories
    WHERE fid = ${fid}
      AND memory_type = 'cast'
      AND (metadata->>'likes')::int > 0
    ORDER BY (metadata->>'likes')::int DESC
    LIMIT 20
  `)

  const recentCasts = await db.execute(sql`
    SELECT content
    FROM memories
    WHERE fid = ${fid}
      AND memory_type = 'cast'
    ORDER BY created_at DESC
    LIMIT 10
  `)

  const allCasts = [...(topCasts as any[]), ...(recentCasts as any[])]
  if (allCasts.length === 0) return 'No cast history available yet.'

  return allCasts
    .map(c => `"${c.content}"`)
    .join('\n')
}

// ── Store survey answers as seed memories ─────────────────────────────────────

export async function storeSurveyMemories(
  fid: number,
  answers: Array<{ question: string; answer: string }>
) {
  for (const { question, answer } of answers) {
    await storeMemory({
      fid,
      content: `When asked "${question}", I said: ${answer}`,
      memoryType: 'survey',
      metadata: { question, answer, isSeed: true },
    })
  }
}
