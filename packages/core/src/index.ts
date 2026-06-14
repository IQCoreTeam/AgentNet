// Public entry for surfaces (vscode, cli). One import point so UIs never reach
// into internal files. Build a live runtime in one call: connect a wallet,
// restore the chosen storage, wire the engine.

export type {
  AgentRuntime,
  SessionHandle,
  SessionMeta,
  ChatMessage,
  CanonicalSession,
  Wallet,
  StorageAdapter,
} from "./runtime/contract.js";

// ─── On-chain marketplace layer (from Step-0 core PR: nft/search/notes/etc.) ──
// chain + seed + domain types
export type { SignerInput, Session, Skill, Workflow, Note, Row, ReadOptions } from "./core/types.js";
export {
  init as initChain,
  ensureDbRoot,
  createTable,
  writeRow,
  readRows,
  readRowsByPda,
  codeIn,
  readCodeIn,
  tableExists,
  getTablePdaRef,
  signerAddress,
} from "./core/chain.js";
export { AGENTNET_ROOT_ID, mysessionsHint, reviewsHint, reviewsAgentHint } from "./core/seed.js";
// skill / workflow NFTs (Token-2022 + code-in)
export {
  publishSkill,
  buySkill,
  createSkillMint,
  mintSkillToken,
  getMintSupply,
  readSkillMintMetadata,
  readSkillText,
} from "./nft/index.js";
export type { PublishSkillInput, BuySkillInput } from "./nft/skill.js";
export type { SkillMintMetadata } from "./nft/token2022.js";
export { resolveMinter, tryMinterPubkey, resetMinterCache } from "./nft/minter.js";
// notes (reviews)
export { postNote, readNotes, deleteNote, postAgentNote, readAgentNotes, getBalance } from "./notes/index.js";
export type { PostNoteInput, ReadNotesOptions, PostAgentNoteInput } from "./notes/index.js";
// active-skill injection (install a bought skill's SKILL.md into a runtime's skills dir)
export { SkillSync } from "./skill-market/ingest/index.js";
export { toSkillMd, skillSlug } from "./skill-market/ingest/convert.js";
export { marketplaceEnv } from "./skill-market/ingest/env.js";
// search + the enumeration seam
export { searchSkills, listUnlockable } from "./search/index.js";
export type { SearchFilters, SortBy, SearchOptions, UnlockableWorkflow, UnlockOptions } from "./search/index.js";
export { dasSource, indexerSource } from "./core/skillSource.js";
export type { SkillSource } from "./core/skillSource.js";
// reputation (derived live from supply + reviews)
export { getReputation, getLeaderboard } from "./reputation/index.js";
export type { Reputation } from "./core/types.js";
// skill-market MCP surface (autonomous buy)
export { createAgentMcpServer, getAgentNetTools, handleToolCall } from "./skill-market/index.js";

export { createRuntime } from "./runtime/index.js";
export { detectCli } from "./runtime/detect.js";
export type { CliStatus, CliReport } from "./runtime/detect.js";
export {
  solanaDefaultKeypairPath,
  inspectKeypair,
  loadOrCreateWallet,
  localWallet,
} from "./account/localWallet.js";
export type { WalletFileState, LoadResult } from "./account/localWallet.js";
// Web/mobile wallet (Phantom, Solflare, Backpack, …): a Wallet built from the
// front-end's signature over the fixed session-key message — wallet-agnostic, the
// front-end picks the provider. Local surfaces use localWallet; web uses this.
export { webWallet, SESSION_KEY_MESSAGE } from "./account/webWallet.js";
export {
  startClaudeLogin,
  isClaudeLoggedIn,
  markClaudeConnected,
  isClaudeMarked,
} from "./account/claudeAuth.js";
export type { ClaudeLogin } from "./account/claudeAuth.js";
export {
  startCodexLogin,
  isCodexLoggedIn,
  markCodexConnected,
  isCodexMarked,
  saveCodexApiKey,
  getCodexApiKey,
  deleteCodexApiKey,
} from "./account/codexAuth.js";
export type { CodexLogin } from "./account/codexAuth.js";
export {
  initialize,
  isInitialized,
  isCloudConnected,
  login,
  logout,
  disconnectCloud,
  switchStorage,
  currentStorageKind,
  getStorageInfo,
} from "./account/login.js";
export { STORAGE_OPTIONS } from "./account/storage/adapter.js";
export type { StorageConfig, StorageKind } from "./account/storage/adapter.js";
export { manualStorage } from "./account/storage/manual.js";
// session-key lifetime policy: ephemeral (memory, default) vs persisted (KeyVault).
// A surface picks one to enable "local storage mode"; default stays ephemeral.
export { ephemeralKey, persistedKey } from "./account/keyPolicy.js";
export type { KeyPolicy, KeyVault } from "./account/keyPolicy.js";
export { agentnetFolderLink } from "./account/storage/gdrive.js";
export type { CloudStatus } from "./account/storage/mirror.js";

import type { AgentRuntime, Wallet } from "./runtime/contract.js";
import type { CloudStatus } from "./account/storage/mirror.js";
import type { ApprovalChannel } from "./runtime/approval/channel.js";
import { createRuntime } from "./runtime/index.js";
import { login } from "./account/login.js";

export type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "./runtime/approval/channel.js";
export { autoApprove } from "./runtime/approval/channel.js";

// the transport-neutral chat dispatcher + its button-approval channel, shared by
// every surface (vscode, server, android). A surface supplies a ChatTransport and a
// ChatEnv; this owns all the chat state + the UI↔runtime message switch.
export { createChatSession } from "./chat/session.js";
export type { ChatTransport, ChatEnv } from "./chat/session.js";
export { TransportApprovalChannel } from "./chat/approvalChannel.js";

// the chat + onboarding HTML (one webview, transport-shimmed: vscode acquireVsCodeApi
// or a WebSocket in the browser/Android). Surfaces serve these strings as-is.
export { chatHtml } from "./chat/ui/webview.js";
export { onboardingHtml } from "./chat/ui/onboarding.js";

// The marked + dompurify browser builds as one text blob (see mdLibs.generated.ts).
// The HTML webview inlines this into a <script>; the React web surface evaluates it
// once to get window.marked / window.DOMPurify, so both surfaces render markdown with
// the exact same engine — one markdown implementation, no per-surface md library.
export { MD_LIBS } from "./chat/ui/mdLibs.generated.js";

// Connect a wallet, restore its configured storage, return a ready runtime.
// (Assumes initialize() was already run once to pick a storage backend.)
// onCloudStatus (optional): reports whether each drive-mirror write succeeded, so
// the UI can show the sync state instead of failing silently.
// approval (optional): how tool-use approvals get decided (webview buttons / auto /
// push). Omit → tool use auto-allows.
export async function connect(
  wallet: Wallet,
  onCloudStatus?: (s: CloudStatus) => void,
  approval?: ApprovalChannel,
): Promise<AgentRuntime> {
  const session = await login(wallet, onCloudStatus);
  return createRuntime(session.wallet, session.storage, approval);
}
