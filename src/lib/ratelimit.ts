// src/lib/ratelimit.ts
// Rate limiting — uses Upstash Redis if configured, falls back to DB
// Protects expensive endpoints (Claude API costs money)

import { NextRequest, NextResponse } from 'next/server'

interface RateLimitConfig {
  limit:      number   // max requests
  windowSecs: number   // window in seconds
  keyPrefix:  string   // e.g. 'draft', 'tip'
}

// ── Upstash Redis rate limit (preferred) ─────────────────────────────────────
// Install: npm install @upstash/ratelimit @upstash/redis
// Add to .env.local:
//   UPSTASH_REDIS_REST_URL=...
//   UPSTASH_REDIS_REST_TOKEN=...

async function upstashLimit(
  key: string,
  config: RateLimitConfig
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const { Ratelimit } = await import('@upstash/ratelimit')
  const { Redis }     = await import('@upstash/redis')

  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSecs} s`),
    prefix:  `rl:${config.keyPrefix}`,
  })

  const { success, remaining, reset } = await ratelimit.limit(key)
  return { success, remaining, reset }
}

// ── DB fallback rate limit (no Redis needed) ──────────────────────────────────
async function dbLimit(
  key: string,
  config: RateLimitConfig
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL!)

  const windowStart = new Date(
    Math.floor(Date.now() / (config.windowSecs * 1000)) * config.windowSecs * 1000
  )
  const reset = windowStart.getTime() + config.windowSecs * 1000

  // Upsert counter
  await sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = rate_limits.count + 1
  `

  const rows = await sql`
    SELECT count FROM rate_limits
    WHERE key = ${key} AND window_start = ${windowStart.toISOString()}
  `

  const count     = (rows[0] as any)?.count ?? 1
  const remaining = Math.max(0, config.limit - count)
  const success   = count <= config.limit

  return { success, remaining, reset }
}

// ── Main rate limit function ──────────────────────────────────────────────────
export async function rateLimit(
  fid: number,
  config: RateLimitConfig
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const key = `${config.keyPrefix}:${fid}`

  try {
    if (process.env.UPSTASH_REDIS_REST_URL) {
      return await upstashLimit(key, config)
    }
    return await dbLimit(key, config)
  } catch (err) {
    // If rate limiting fails, allow the request (fail open)
    console.error('Rate limit check failed:', err)
    return { success: true, remaining: config.limit, reset: Date.now() + config.windowSecs * 1000 }
  }
}

// ── Rate limit configs per endpoint ──────────────────────────────────────────
export const LIMITS = {
  draft:    { limit: 20,  windowSecs: 3600,  keyPrefix: 'draft'    }, // 20 drafts/hour
  tip:      { limit: 50,  windowSecs: 86400, keyPrefix: 'tip'      }, // 50 tips/day
  job:      { limit: 10,  windowSecs: 3600,  keyPrefix: 'job'      }, // 10 jobs/hour
  survey:   { limit: 3,   windowSecs: 86400, keyPrefix: 'survey'   }, // 3 surveys/day
  register: { limit: 5,   windowSecs: 3600,  keyPrefix: 'register' }, // 5 registrations/hour
  schedule: { limit: 3,   windowSecs: 86400, keyPrefix: 'schedule' }, // 3 scheduled casts/day
}

// ── Helper: apply rate limit in route, return 429 if exceeded ────────────────
export async function applyRateLimit(
  fid: number,
  limitConfig: typeof LIMITS[keyof typeof LIMITS]
): Promise<NextResponse | null> {
  const { success, remaining, reset } = await rateLimit(fid, limitConfig)

  if (!success) {
    return NextResponse.json(
      {
        error:     'Rate limit exceeded',
        remaining: 0,
        resetAt:   new Date(reset).toISOString(),
        retryAfter: Math.ceil((reset - Date.now()) / 1000),
      },
      {
        status:  429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     reset.toString(),
          'Retry-After':           Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  return null // no limit hit
}
