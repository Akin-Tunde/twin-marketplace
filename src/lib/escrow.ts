// src/lib/escrow.ts
// Viem client for AgentEscrow.sol on Base
// Handles: lockFunds, release, refund, dispute, resolveDispute

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toHex,
  encodePacked,
  parseUnits,
  formatUnits,
  type Address,
  type Hash,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// ── Config ────────────────────────────────────────────────────────────────────
const IS_TESTNET = process.env.NODE_ENV !== 'production'
const CHAIN = IS_TESTNET ? baseSepolia : base

const RPC_URL = IS_TESTNET
  ? `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  : `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`

// USDC addresses
const USDC_ADDRESS: Address = IS_TESTNET
  ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Base Sepolia USDC
  : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // Base Mainnet USDC

const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS as Address

// ── ABIs ──────────────────────────────────────────────────────────────────────
export const ESCROW_ABI = [
  {
    name: 'lockFunds',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',           type: 'bytes32' },
      { name: 'agentWallet',     type: 'address' },
      { name: 'amount',          type: 'uint256' },
      { name: 'jobHash',         type: 'bytes32' },
      { name: 'deadlineSeconds', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'release',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'refund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'dispute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'resolveDispute',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId',    type: 'bytes32' },
      { name: 'agentWon', type: 'bool'    },
    ],
    outputs: [],
  },
  {
    name: 'getJob',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'requester',   type: 'address' },
        { name: 'agentWallet', type: 'address' },
        { name: 'amount',      type: 'uint256' },
        { name: 'jobHash',     type: 'bytes32' },
        { name: 'status',      type: 'uint8'   },
        { name: 'createdAt',   type: 'uint256' },
        { name: 'deadline',    type: 'uint256' },
      ],
    }],
  },
  {
    name: 'feeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ── Clients ───────────────────────────────────────────────────────────────────
function getMarketplaceAccount() {
  return privateKeyToAccount(
    process.env.MARKETPLACE_WALLET_PRIVATE_KEY as `0x${string}`
  )
}

export function getPublicClient() {
  return createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })
}

export function getWalletClient() {
  return createWalletClient({
    account: getMarketplaceAccount(),
    chain: CHAIN,
    transport: http(RPC_URL),
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a UUID job ID to bytes32 for the contract */
export function jobIdToBytes32(uuid: string): `0x${string}` {
  const hex = uuid.replace(/-/g, '')
  return `0x${hex.padEnd(64, '0')}`
}

/** Hash job params for integrity check */
export function hashJobParams(params: object): `0x${string}` {
  return keccak256(toHex(JSON.stringify(params)))
}

export function usdcToUnits(amount: number): bigint {
  return parseUnits(amount.toFixed(6), 6)
}

export function unitsToUsdc(units: bigint): number {
  return parseFloat(formatUnits(units, 6))
}

// ── Core escrow functions ─────────────────────────────────────────────────────

/**
 * Lock USDC in escrow when a job is matched.
 * Called by the marketplace server wallet on behalf of the requester.
 * In production, the requester signs this tx in their own wallet via the mini app.
 */
export async function lockFunds({
  jobId,
  agentWalletAddress,
  amountUsdc,
  jobParams,
  deadlineHours = 24,
}: {
  jobId: string
  agentWalletAddress: Address
  amountUsdc: number
  jobParams: object
  deadlineHours?: number
}): Promise<{ txHash: Hash; jobBytes32: `0x${string}` }> {
  const wallet = getWalletClient()
  const pub    = getPublicClient()
  const account = getMarketplaceAccount()

  const jobBytes32    = jobIdToBytes32(jobId)
  const jobHash       = hashJobParams(jobParams)
  const amountUnits   = usdcToUnits(amountUsdc)
  const deadlineSecs  = BigInt(deadlineHours * 3600)

  // 1. Approve escrow contract to spend USDC
  const approveHash = await wallet.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: 'approve',
    args: [ESCROW_ADDRESS, amountUnits],
  })
  await pub.waitForTransactionReceipt({ hash: approveHash })

  // 2. Call lockFunds on the escrow contract
  const lockHash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'lockFunds',
    args: [jobBytes32, agentWalletAddress, amountUnits, jobHash, deadlineSecs],
  })
  await pub.waitForTransactionReceipt({ hash: lockHash })

  return { txHash: lockHash, jobBytes32 }
}

/**
 * Release payment to agent after successful verification.
 * Called by the marketplace server wallet (verifier role).
 */
export async function releasePayment(jobId: string): Promise<Hash> {
  const wallet    = getWalletClient()
  const pub       = getPublicClient()
  const jobBytes32 = jobIdToBytes32(jobId)

  const txHash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'release',
    args: [jobBytes32],
  })
  await pub.waitForTransactionReceipt({ hash: txHash })
  return txHash
}

/**
 * Refund requester (job failed or deadline passed).
 */
export async function refundRequester(jobId: string): Promise<Hash> {
  const wallet    = getWalletClient()
  const pub       = getPublicClient()
  const jobBytes32 = jobIdToBytes32(jobId)

  const txHash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'refund',
    args: [jobBytes32],
  })
  await pub.waitForTransactionReceipt({ hash: txHash })
  return txHash
}

/**
 * Open a dispute on a job.
 */
export async function openDispute(jobId: string): Promise<Hash> {
  const wallet    = getWalletClient()
  const pub       = getPublicClient()
  const jobBytes32 = jobIdToBytes32(jobId)

  const txHash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'dispute',
    args: [jobBytes32],
  })
  await pub.waitForTransactionReceipt({ hash: txHash })
  return txHash
}

/**
 * Resolve a dispute (owner/admin only).
 */
export async function resolveDispute(jobId: string, agentWon: boolean): Promise<Hash> {
  const wallet    = getWalletClient()
  const pub       = getPublicClient()
  const jobBytes32 = jobIdToBytes32(jobId)

  const txHash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'resolveDispute',
    args: [jobBytes32, agentWon],
  })
  await pub.waitForTransactionReceipt({ hash: txHash })
  return txHash
}

/**
 * Read job status from contract.
 */
export async function getEscrowJob(jobId: string) {
  const pub       = getPublicClient()
  const jobBytes32 = jobIdToBytes32(jobId)

  const job = await pub.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'getJob',
    args: [jobBytes32],
  })

  const STATUS = ['Open', 'InProgress', 'Submitted', 'Completed', 'Disputed', 'Cancelled']

  return {
    requester:   job.requester,
    agentWallet: job.agentWallet,
    amountUsdc:  unitsToUsdc(job.amount),
    status:      STATUS[job.status] ?? 'Unknown',
    deadline:    new Date(Number(job.deadline) * 1000),
  }
}

export { USDC_ADDRESS, ESCROW_ADDRESS, CHAIN, IS_TESTNET }
