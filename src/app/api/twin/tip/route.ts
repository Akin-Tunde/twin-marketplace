// src/app/api/twin/tip/route.ts
/**
 * @agent-action intent=finance.transfer
 * @description Tip a cast with USDC on behalf of the user
 * @agent-price 0 USDC
 * @agent-sla 10s
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { shouldAutoTip } from '@/lib/claude'
import { storeMemory } from '@/lib/memory'
import { db } from '@/lib/db'
import { twinActions } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  getContract,
} from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { getCast } from '@/lib/neynar'

// Base mainnet USDC contract
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const
const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',    type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ── POST: execute a tip ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult
  const { auth } = authResult

  const { castHash, castText, castAuthor, amountUsdc, autoDecide } = await req.json()

  if (!castHash && !castText) {
    return NextResponse.json({ error: 'castHash or castText required' }, { status: 400 })
  }

  try {
    // 1. Fetch cast if we only have hash
    let text = castText
    let author = castAuthor
    if (castHash && !castText) {
      const cast = await getCast(castHash)
      text = cast.text
      author = cast.author.username
    }

    // 2. If autoDecide=true, ask Claude first
    if (autoDecide) {
      const settings = await db.execute(sql`
        SELECT auto_tip_threshold, auto_tip_amount_usdc, auto_tip_enabled
        FROM twin_settings WHERE fid = ${auth.fid}
      `)
      const s = (settings as any[])[0]
      if (!s?.auto_tip_enabled) {
        return NextResponse.json({ skipped: true, reason: 'Auto-tip disabled' })
      }

      const decision = await shouldAutoTip({
        fid: auth.fid,
        castText: text,
        castAuthor: author,
        threshold: s.auto_tip_threshold ?? 0.85,
      })

      if (!decision.tip) {
        return NextResponse.json({
          skipped: true,
          reason: `Below threshold (confidence: ${decision.confidence.toFixed(2)})`,
          aiReason: decision.reason,
        })
      }
    }

    // 3. Get user's wallet address + the amount to tip
    const userRows = await db.execute(sql`
      SELECT u.verified_address, ts.auto_tip_amount_usdc
      FROM users u
      JOIN twin_settings ts ON ts.fid = u.fid
      WHERE u.fid = ${auth.fid}
    `)
    const userRow = (userRows as any[])[0]

    if (!userRow?.verified_address) {
      return NextResponse.json({
        error: 'No verified wallet address found for this user',
      }, { status: 400 })
    }

    const tipAmount = amountUsdc ?? userRow.auto_tip_amount_usdc ?? 0.5

    // 4. Get recipient address from Neynar (cast author's wallet)
    const cast = await getCast(castHash ?? '')
    const recipientAddress = cast?.author?.verified_addresses?.eth_addresses?.[0]

    if (!recipientAddress) {
      return NextResponse.json({
        error: 'Cast author has no verified ETH address to receive tip',
      }, { status: 400 })
    }

    // 5. Execute USDC transfer on Base via viem
    // NOTE: In production, the user signs this themselves via their Farcaster wallet.
    // For the twin's autonomous tip, we use a marketplace escrow wallet as intermediary
    // that the user pre-funds. This is the safest pattern — user deposits USDC into
    // their twin vault; twin spends from vault.

    const account = privateKeyToAccount(
      process.env.MARKETPLACE_WALLET_PRIVATE_KEY as `0x${string}`
    )

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
    })

    const publicClient = createPublicClient({
      chain: base,
      transport: http(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
    })

    // Check balance first
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    })

    const tipAmountUnits = parseUnits(tipAmount.toString(), 6) // USDC = 6 decimals

    if (balance < tipAmountUnits) {
      return NextResponse.json({
        error: `Insufficient USDC balance. Have: ${Number(balance) / 1e6}, need: ${tipAmount}`,
      }, { status: 400 })
    }

    // Send the tip
    const txHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, tipAmountUnits],
    })

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    // 6. Log the action
    await db.insert(twinActions).values({
      fid: auth.fid,
      actionType: 'tip',
      status: 'executed',
      inputData: { castHash, castText: text, castAuthor: author, recipientAddress },
      outputData: { txHash, tipAmountUsdc: tipAmount, blockNumber: receipt.blockNumber.toString() },
      confidence: 1.0,
      executedAt: new Date(),
    })

    // 7. Store tip in memory so twin learns tipping patterns
    await storeMemory({
      fid: auth.fid,
      content: `I tipped ${tipAmount} USDC to @${author} for: "${text}"`,
      memoryType: 'tip',
      metadata: { castHash, author, amountUsdc: tipAmount, txHash },
    })

    // 8. Update stats
    await db.execute(sql`
      INSERT INTO twin_stats (fid, tips_sent, usdc_tipped)
      VALUES (${auth.fid}, 1, ${tipAmount})
      ON CONFLICT (fid) DO UPDATE
      SET tips_sent = twin_stats.tips_sent + 1,
          usdc_tipped = twin_stats.usdc_tipped + ${tipAmount},
          updated_at = NOW()
    `)

    return NextResponse.json({
      success: true,
      txHash,
      tipAmountUsdc: tipAmount,
      recipient: recipientAddress,
      explorerUrl: `https://basescan.org/tx/${txHash}`,
    })
  } catch (err: any) {
    console.error('Tip error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
