// src/lib/dao.ts
// DAO governance integration — Tally (onchain) + Snapshot (offchain)
// Twin reads proposals, decides vote based on user values, executes

import Anthropic from '@anthropic-ai/sdk'
import { getUserVoiceProfile, similarMemories } from './memory'

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Tally API (onchain governance) ───────────────────────────────────────────

export async function fetchTallyProposals(organizationId: string) {
  const res = await fetch('https://api.tally.xyz/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': process.env.TALLY_API_KEY ?? '',
    },
    body: JSON.stringify({
      query: `
        query Proposals($orgId: ID!) {
          proposals(organizationIds: [$orgId], pagination: { limit: 10 }) {
            nodes {
              id
              title
              description
              status
              eta
              voteStats { support forWeight againstWeight abstainWeight }
              organization { name }
            }
          }
        }
      `,
      variables: { orgId: organizationId },
    }),
  })

  const data = await res.json()
  return data?.data?.proposals?.nodes ?? []
}

// ── Snapshot API (offchain governance) ───────────────────────────────────────

export async function fetchSnapshotProposals(space: string) {
  const res = await fetch('https://hub.snapshot.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query Proposals($space: String!) {
          proposals(
            first: 10
            where: { space: $space, state: "active" }
            orderBy: "created"
            orderDirection: desc
          ) {
            id title body state scores scores_total
            choices start end author
          }
        }
      `,
      variables: { space },
    }),
  })

  const data = await res.json()
  return data?.data?.proposals ?? []
}

// ── AI vote decision ──────────────────────────────────────────────────────────

export async function decideTwinVote({
  fid,
  proposalTitle,
  proposalBody,
  choices,
  platform,
}: {
  fid: number
  proposalTitle: string
  proposalBody: string
  choices: string[]   // for Snapshot: ['For', 'Against', 'Abstain'] etc
  platform: 'snapshot' | 'tally'
}): Promise<{
  decision: string
  reasoning: string
  confidence: number
  shouldVote: boolean
}> {
  // Get user's values + relevant past positions
  const voiceProfile = await getUserVoiceProfile(fid)
  const relevantMemories = await similarMemories(fid, proposalTitle + ' ' + proposalBody, { k: 5 })

  const memContext = relevantMemories
    .map(m => `[${m.similarity.toFixed(2)}] "${m.content}"`)
    .join('\n')

  const response = await claude.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: `You are a governance proxy for a Farcaster user (FID: ${fid}).
Your job is to vote in DAO proposals based on their values and past positions.

User's voice and values (from their casts):
${voiceProfile}

Relevant past positions:
${memContext}

Available choices: ${choices.join(', ')}

Return JSON only:
{
  "decision": "<one of the available choices>",
  "reasoning": "<2-3 sentences explaining why based on their values>",
  "confidence": <0-1>,
  "shouldVote": <true if confidence > 0.7, false otherwise>
}`,
    messages: [
      {
        role: 'user',
        content: `Proposal: "${proposalTitle}"\n\n${proposalBody.slice(0, 2000)}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return { decision: choices[0], reasoning: 'Parse error', confidence: 0, shouldVote: false }
  }
}

// ── Cast Snapshot vote (offchain, no gas needed) ──────────────────────────────

export async function castSnapshotVote({
  proposalId,
  choice,
  voterAddress,
  privateKey,
}: {
  proposalId: string
  choice: number     // 1-indexed choice number
  voterAddress: string
  privateKey: string
}) {
  // Snapshot uses EIP-712 signatures
  // In production: use snapshot.js client library
  // npm install @snapshot-labs/snapshot.js

  const { ethers } = await import('ethers')
  const wallet = new ethers.Wallet(privateKey)

  const domain = {
    name:    'snapshot',
    version: '0.1.4',
  }

  const types = {
    Vote: [
      { name: 'from',     type: 'address' },
      { name: 'space',    type: 'string'  },
      { name: 'timestamp', type: 'uint64' },
      { name: 'proposal', type: 'bytes32' },
      { name: 'choice',   type: 'uint32'  },
      { name: 'reason',   type: 'string'  },
      { name: 'app',      type: 'string'  },
      { name: 'metadata', type: 'string'  },
    ],
  }

  const message = {
    from:      voterAddress,
    space:     'twinmarket.eth',
    timestamp: Math.floor(Date.now() / 1000),
    proposal:  proposalId,
    choice,
    reason:    'Voted by TwinMarket AI proxy',
    app:       'twinmarket',
    metadata:  '{}',
  }

  const sig = await wallet.signTypedData(domain, types, message)

  const res = await fetch('https://seq.snapshot.org/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address:   voterAddress,
      sig,
      data: { domain, types, message },
    }),
  })

  return res.json()
}
