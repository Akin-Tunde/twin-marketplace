// src/lib/db/schema.ts
// Full Drizzle ORM schema — pgvector for memory, jobs + reputation for marketplace

import {
  pgTable, text, integer, real, boolean, timestamp,
  jsonb, uuid, index, uniqueIndex, bigint, varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ── Users ─────────────────────────────────────────────────────────────────────
// One row per Farcaster FID (both humans and agents)
export const users = pgTable('users', {
  id:          uuid('id').primaryKey().defaultRandom(),
  fid:         integer('fid').notNull().unique(),
  username:    text('username').notNull(),
  displayName: text('display_name'),
  pfpUrl:      text('pfp_url'),
  custodyAddr: text('custody_address'),     // Ethereum address
  verifiedAddr: text('verified_address'),   // primary verified wallet
  bio:         text('bio'),
  followerCount: integer('follower_count').default(0),
  followingCount: integer('following_count').default(0),
  isAgent:     boolean('is_agent').default(false),  // true if this FID is an AI agent
  agentJsonUrl: text('agent_json_url'),              // URL to their agent.json
  createdAt:   timestamp('created_at').defaultNow(),
  updatedAt:   timestamp('updated_at').defaultNow(),
}, (t) => ({
  fidIdx: uniqueIndex('users_fid_idx').on(t.fid),
}))

// ── Twin memory (vector store) ─────────────────────────────────────────────────
// Each row = one cast or behavioral signal, stored with its embedding
// Requires: CREATE EXTENSION IF NOT EXISTS vector;
export const memories = pgTable('memories', {
  id:         uuid('id').primaryKey().defaultRandom(),
  fid:        integer('fid').notNull().references(() => users.fid, { onDelete: 'cascade' }),
  castHash:   text('cast_hash').unique(),       // null for synthetic memories (surveys)
  content:    text('content').notNull(),         // raw cast text / signal description
  memoryType: text('memory_type').notNull(),     // 'cast' | 'reaction' | 'tip' | 'follow' | 'survey'
  // Vector embedding (1536 dims for text-embedding-3-small)
  // Stored as text then cast; Drizzle doesn't have native vector type yet
  embedding:  text('embedding'),                 // JSON array string: "[0.1, 0.2, ...]"
  metadata:   jsonb('metadata'),                 // { channel, likes, recasts, timestamp, ... }
  createdAt:  timestamp('created_at').defaultNow(),
}, (t) => ({
  fidIdx:     index('memories_fid_idx').on(t.fid),
  typeIdx:    index('memories_type_idx').on(t.memoryType),
}))

// Raw SQL for pgvector index (run after push):
// CREATE INDEX memories_embedding_idx ON memories
//   USING ivfflat ((embedding::vector(1536)) vector_cosine_ops)
//   WITH (lists = 100);

// ── Twin action log ───────────────────────────────────────────────────────────
// Every action the twin performs or proposes
export const twinActions = pgTable('twin_actions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  fid:         integer('fid').notNull().references(() => users.fid),
  actionType:  text('action_type').notNull(),   // 'draft' | 'cast' | 'tip' | 'vote' | 'follow'
  status:      text('status').notNull().default('pending'),  // 'pending' | 'approved' | 'rejected' | 'executed'
  inputData:   jsonb('input_data'),             // what triggered this (cast to reply to, etc.)
  outputData:  jsonb('output_data'),            // the draft or result
  confidence:  real('confidence'),              // 0–1 how confident the twin was
  executedAt:  timestamp('executed_at'),
  createdAt:   timestamp('created_at').defaultNow(),
}, (t) => ({
  fidStatusIdx: index('twin_actions_fid_status_idx').on(t.fid, t.status),
}))

// ── Twin settings per user ────────────────────────────────────────────────────
export const twinSettings = pgTable('twin_settings', {
  fid:                 integer('fid').primaryKey().references(() => users.fid),
  autonomyLevel:       integer('autonomy_level').default(1),  // 1–5
  autoTipEnabled:      boolean('auto_tip_enabled').default(false),
  autoTipThreshold:    real('auto_tip_threshold').default(0.85),  // confidence required
  autoTipAmountUsdc:   real('auto_tip_amount_usdc').default(0.5),
  scheduledCastEnabled: boolean('scheduled_cast_enabled').default(false),
  scheduledCastTopics: text('scheduled_cast_topics').array(),
  daoVoteEnabled:      boolean('dao_vote_enabled').default(false),
  notifyOnAction:      boolean('notify_on_action').default(true),
  updatedAt:           timestamp('updated_at').defaultNow(),
})

// ── Agent registry (marketplace) ──────────────────────────────────────────────
// Every registered AI agent with their capabilities from agent.json
export const agentRegistry = pgTable('agent_registry', {
  id:              uuid('id').primaryKey().defaultRandom(),
  fid:             integer('fid').notNull().references(() => users.fid).unique(),
  agentJsonUrl:    text('agent_json_url').notNull(),
  name:            text('name').notNull(),
  description:     text('description'),
  capabilities:    text('capabilities').array(),        // ['wallet', 'social', 'ai']
  supportedIntents: text('supported_intents').array(),  // ['social.cast', 'nft.mint']
  walletAddress:   text('wallet_address'),              // for USDC payouts
  priceFloorUsdc:  real('price_floor_usdc').default(0),
  avgCompletionMs: integer('avg_completion_ms'),
  reputationScore: real('reputation_score').default(0), // 0–100
  totalJobs:       integer('total_jobs').default(0),
  successRate:     real('success_rate').default(1.0),
  isVerified:      boolean('is_verified').default(false),
  isActive:        boolean('is_active').default(true),
  lastSeenAt:      timestamp('last_seen_at'),
  createdAt:       timestamp('created_at').defaultNow(),
}, (t) => ({
  fidIdx:          uniqueIndex('registry_fid_idx').on(t.fid),
  intentIdx:       index('registry_intent_idx').on(t.supportedIntents),
}))

// ── Jobs ──────────────────────────────────────────────────────────────────────
export const jobs = pgTable('jobs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  requesterFid:   integer('requester_fid').notNull().references(() => users.fid),
  assignedAgentFid: integer('assigned_agent_fid').references(() => users.fid),
  requiredIntent: text('required_intent').notNull(),     // e.g. 'social.cast'
  description:    text('description').notNull(),
  inputParams:    jsonb('input_params'),                  // params to pass to agent action
  outputResult:   jsonb('output_result'),                 // result from agent
  budgetUsdc:     real('budget_usdc').notNull(),
  escrowTxHash:   text('escrow_tx_hash'),                // Base tx that locked funds
  releaseTxHash:  text('release_tx_hash'),               // Base tx that released funds
  status:         text('status').notNull().default('open'),
  // 'open' | 'matched' | 'in_progress' | 'submitted' | 'verified' | 'completed' | 'disputed' | 'cancelled'
  deadlineAt:     timestamp('deadline_at'),
  completedAt:    timestamp('completed_at'),
  rating:         integer('rating'),                      // 1–5 by requester
  ratingNote:     text('rating_note'),
  createdAt:      timestamp('created_at').defaultNow(),
}, (t) => ({
  statusIdx:      index('jobs_status_idx').on(t.status),
  requesterIdx:   index('jobs_requester_idx').on(t.requesterFid),
  agentIdx:       index('jobs_agent_idx').on(t.assignedAgentFid),
}))

// ── Reputation events ─────────────────────────────────────────────────────────
// Immutable log — reputation score is derived from these
export const reputationEvents = pgTable('reputation_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  agentFid:    integer('agent_fid').notNull().references(() => users.fid),
  jobId:       uuid('job_id').references(() => jobs.id),
  eventType:   text('event_type').notNull(),  // 'job_completed' | 'job_failed' | 'dispute_won' | 'dispute_lost'
  scoreDelta:  real('score_delta').notNull(),  // +5, -10, etc.
  metadata:    jsonb('metadata'),
  createdAt:   timestamp('created_at').defaultNow(),
}, (t) => ({
  agentIdx:    index('rep_events_agent_idx').on(t.agentFid),
}))

// ── Notification tokens ───────────────────────────────────────────────────────
export const notificationTokens = pgTable('notification_tokens', {
  fid:        integer('fid').primaryKey().references(() => users.fid),
  token:      text('token').notNull(),
  url:        text('url').notNull(),
  createdAt:  timestamp('created_at').defaultNow(),
  updatedAt:  timestamp('updated_at').defaultNow(),
})
