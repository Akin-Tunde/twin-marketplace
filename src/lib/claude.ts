// src/lib/claude.ts
// Claude AI — powers twin voice + marketplace matching

import Anthropic from '@anthropic-ai/sdk'
import { getUserVoiceProfile, similarMemories } from './memory'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = 'claude-sonnet-4-20250514'

// ── Digital Twin: draft a reply ───────────────────────────────────────────────

export async function draftReply({
  fid,
  castText,
  castAuthor,
  channel,
}: {
  fid: number
  castText: string
  castAuthor: string
  channel?: string
}): Promise<{ draft: string; confidence: number; reasoning: string }> {
  // 1. Retrieve relevant memories via RAG
  const memories = await similarMemories(fid, castText, { k: 8 })
  const voiceProfile = await getUserVoiceProfile(fid)

  const memoryContext = memories
    .map(m => `[similarity: ${m.similarity.toFixed(2)}] "${m.content}"`)
    .join('\n')

  // 2. Ask Claude to draft in the user's voice
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `You are a digital twin agent for a Farcaster user (FID: ${fid}).
Your job is to draft replies that sound EXACTLY like this person.

THEIR VOICE PROFILE (top/recent casts):
${voiceProfile}

RELEVANT PAST CASTS (from memory search):
${memoryContext}

Rules:
- Match their exact tone, vocabulary, and sentence length
- If they use crypto slang, use it. If they don't, don't.
- Farcaster casts are max 320 chars. Keep it tight.
- Be authentic — don't be more formal or polished than they are
- Output JSON only: { "draft": string, "confidence": number (0-1), "reasoning": string }`,
    messages: [
      {
        role: 'user',
        content: `Draft a reply to this cast by @${castAuthor}${channel ? ` in /${channel}` : ''}:
"${castText}"

Return JSON only.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return { draft: text.slice(0, 320), confidence: 0.5, reasoning: 'parse error' }
  }
}

// ── Digital Twin: decide if a cast is worth tipping ──────────────────────────

export async function shouldAutoTip({
  fid,
  castText,
  castAuthor,
  threshold = 0.85,
}: {
  fid: number
  castText: string
  castAuthor: string
  threshold?: number
}): Promise<{ tip: boolean; confidence: number; reason: string }> {
  const memories = await similarMemories(fid, castText, {
    k: 5,
    memoryTypes: ['cast', 'reaction', 'tip'],
  })

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: `You are evaluating whether a Farcaster user (FID: ${fid}) would want to tip a cast.

Based on their past behavior:
${memories.map(m => `"${m.content}"`).join('\n')}

Return JSON only: { "tip": boolean, "confidence": number (0-1), "reason": string }`,
    messages: [
      {
        role: 'user',
        content: `Would this user tip this cast by @${castAuthor}?
"${castText}"`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    const result = JSON.parse(text.replace(/```json|```/g, '').trim())
    return { ...result, tip: result.tip && result.confidence >= threshold }
  } catch {
    return { tip: false, confidence: 0, reason: 'parse error' }
  }
}

// ── Digital Twin: generate a scheduled cast ───────────────────────────────────

export async function generateScheduledCast({
  fid,
  topics,
}: {
  fid: number
  topics: string[]
}): Promise<{ cast: string; confidence: number }> {
  const voiceProfile = await getUserVoiceProfile(fid)
  const topicStr = topics.join(', ')

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: `You are a digital twin for a Farcaster user (FID: ${fid}).
Generate an original cast they would write today.

THEIR VOICE:
${voiceProfile}

Topics they care about: ${topicStr}

Rules:
- Max 320 chars
- Sound like them, not generic AI
- Original thought, not a summary of something
- Return JSON only: { "cast": string, "confidence": number }`,
    messages: [{ role: 'user', content: 'Generate a cast for today.' }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return { cast: '', confidence: 0 }
  }
}

// ── Marketplace: match job to best agent ─────────────────────────────────────

export async function matchJobToAgent({
  jobDescription,
  requiredIntent,
  budgetUsdc,
  agents,
}: {
  jobDescription: string
  requiredIntent: string
  budgetUsdc: number
  agents: Array<{
    fid: number
    name: string
    supportedIntents: string[]
    reputationScore: number
    priceFloorUsdc: number
    avgCompletionMs: number
  }>
}): Promise<{ rankedFids: number[]; reasoning: string }> {
  const eligibleAgents = agents.filter(
    a => a.supportedIntents.includes(requiredIntent) && a.priceFloorUsdc <= budgetUsdc
  )

  if (eligibleAgents.length === 0) {
    return { rankedFids: [], reasoning: 'No eligible agents found' }
  }

  const agentList = eligibleAgents
    .map(
      a =>
        `FID ${a.fid} (${a.name}): rep=${a.reputationScore}, price=${a.priceFloorUsdc} USDC, avgTime=${a.avgCompletionMs}ms`
    )
    .join('\n')

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: `You are a job-matching AI for an agent marketplace.
Rank agents for a job based on reputation, price, and capability fit.
Return JSON only: { "rankedFids": number[], "reasoning": string }`,
    messages: [
      {
        role: 'user',
        content: `Job: "${jobDescription}"
Required intent: ${requiredIntent}
Budget: ${budgetUsdc} USDC

Eligible agents:
${agentList}

Rank them best to worst. Return JSON only.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return {
      rankedFids: eligibleAgents
        .sort((a, b) => b.reputationScore - a.reputationScore)
        .map(a => a.fid),
      reasoning: 'Fallback: sorted by reputation',
    }
  }
}

// ── Marketplace: verify job output ───────────────────────────────────────────

export async function verifyJobOutput({
  jobDescription,
  expectedOutput,
  actualOutput,
}: {
  jobDescription: string
  expectedOutput?: string
  actualOutput: any
}): Promise<{ verified: boolean; score: number; feedback: string }> {
  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: `You are a quality verifier for an AI agent marketplace.
Evaluate if an agent's output meets the job requirements.
Return JSON only: { "verified": boolean, "score": number (0-100), "feedback": string }`,
    messages: [
      {
        role: 'user',
        content: `Job: "${jobDescription}"
${expectedOutput ? `Expected: "${expectedOutput}"` : ''}
Agent output: ${JSON.stringify(actualOutput)}

Is this satisfactory? Return JSON only.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return { verified: false, score: 0, feedback: 'Verification error' }
  }
}
