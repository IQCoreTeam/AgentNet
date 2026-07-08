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
  DEFAULT_SKILL_PRICE_LAMPORTS,
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
export { postNote, readNotes, deleteNote, postAgentNote, readAgentNotes, getBalance, getSolBalance, canAffordSkill, TX_FEE_BUFFER_LAMPORTS } from "./notes/index.js";
export type { PostNoteInput, ReadNotesOptions, PostAgentNoteInput } from "./notes/index.js";
// RPC resolution (issue #23): a registered Helius key wins over env over the default
export { resolveRpcUrl, saveHeliusKey, loadHeliusKey, hasDasRpc, heliusUrl, maskedHeliusKey, saveGithubToken, loadGithubToken, maskedGithubToken } from "./core/rpc.js";
export { getNetwork, NETWORK } from "./core/seed.js";
export { registerVerifiedWork, parseRepo as parseGithubRepo } from "./core/verifiedWork.js";
export type { Network } from "./core/seed.js";
// the marketplace UI<->host message contract (shared by every surface's UI)
export type { SkillCard, SkillDetail, MarketRequest, MarketEvent, MarketMessage, RpcStatus, AgentProfile } from "./chat/marketMessages.js";
// active-skill injection (install a bought skill's SKILL.md into a runtime's skills dir)
export { SkillSync } from "./skill-market/ingest/index.js";
export { toSkillMd, skillSlug } from "./skill-market/ingest/convert.js";
export { marketplaceEnv } from "./skill-market/ingest/env.js";
// search + the enumeration seam
export { searchSkills, listUnlockable } from "./search/index.js";
export type { SearchFilters, SortBy, SearchOptions, UnlockableWorkflow, UnlockOptions } from "./search/index.js";
export { dasSource, indexerSource, ownedSkills, workflowMintsAmong } from "./core/skillSource.js";
export type { SkillSource } from "./core/skillSource.js";
// reputation (derived live from supply + reviews)
export { getReputation, getLeaderboard } from "./reputation/index.js";
export type { Reputation } from "./core/types.js";
export { isHttpsGithubUrl, parseGithubLink, safeExternalUrl } from "./links/github.js";
export type { GithubLinkInfo, GithubLinkKind } from "./links/github.js";
// skill-market MCP surface (autonomous buy)
export { createAgentMcpServer, createAgentSdkMcpServer, getAgentNetTools, handleToolCall, newVerifyGuard, verifyOneSkill, verifySkills } from "./skill-market/index.js";
export type { VerifyGuard } from "./skill-market/index.js";
// vault band (issue #84 / plans/soul-memory-portability.md): soul store + the MCP
// tools that expose soul/memory to external hosts through the stdio server.
export { SoulStore, SOUL_KEY, SOUL_TEXT_MAX } from "./soul/store.js";
export type { SoulDoc } from "./soul/store.js";
export { getVaultTools, handleVaultToolCall, VAULT_TOOL_NAMES } from "./vault/tools.js";
export type { VaultDeps } from "./vault/tools.js";
export { parseSoul } from "./soul/parse.js";
export type { ParsedSoul, SoulSection } from "./soul/parse.js";
export { soulToElizaPersona, writeElizaCharacter } from "./soul/convert/eliza.js";
export type { ElizaPersona } from "./soul/convert/eliza.js";
export { syncSoulWithFile } from "./soul/convert/openclaw.js";
export type { SoulSyncAction } from "./soul/convert/openclaw.js";
export { writeOpenclawMemory, renderOpenclawBlock } from "./memory/convert/openclaw.js";
export { injectExternalHosts } from "./vault/inject.js";
export { browseSkills } from "./skill-market/browse.js";
export type { BrowseResult } from "./skill-market/browse.js";
export { setSkillShoppingActive, PASSIVE_SKILL_SLUG } from "./skill-market/passive.js";
// skill-origin registry — distinguish bundled (skill-shopping / make-skill) vs NFT-bought
// vs local installed skills (the SKILL.md file can't say which; this side manifest can).
export {
  BUNDLED_SKILLS,
  MAKE_SKILL_SLUG,
  classifySkills,
  skillOrigin,
  readSkillManifest,
  recordNftSkill,
  forgetNftSkill,
} from "./skill-market/registry.js";
export type { SkillOrigin, ClassifiedSkill, SkillManifest, NftSkillRecord } from "./skill-market/registry.js";

export { createRuntime } from "./runtime/index.js";
export { detectCli } from "./runtime/detect.js";
export type { CliStatus, CliReport } from "./runtime/detect.js";
export { listCodexModelOptions } from "./runtime/codexModels.js";
export { listClaudeModelOptions } from "./runtime/claudeModels.js";
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
  logoutClaude,
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
  logoutCodex,
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
  getSkillShopping,
  setSkillShopping,
  saveGoogleCreds,
  hasGoogleCreds,
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
export { startGoogleLogin, startGoogleLoginFixed } from "./account/storage/oauth.js";
export type { GoogleLogin } from "./account/storage/oauth.js";



import type { AgentRuntime, Wallet } from "./runtime/contract.js";
import type { CloudStatus } from "./account/storage/mirror.js";
import type { ApprovalChannel } from "./runtime/approval/channel.js";
import { createRuntime } from "./runtime/index.js";
import { login } from "./account/login.js";

export type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "./runtime/approval/channel.js";
export { autoApprove, withTimeout } from "./runtime/approval/channel.js";

// the transport-neutral chat dispatcher + its button-approval channel, shared by
// every surface (vscode, server, android). A surface supplies a ChatTransport and a
// ChatEnv; this owns all the chat state + the UI↔runtime message switch.
export { createChatSession } from "./chat/session.js";
export type { ChatTransport, ChatEnv } from "./chat/session.js";
export { TransportApprovalChannel } from "./chat/approvalChannel.js";
export { CHAT_MODEL_OPTIONS, findChatModelOption } from "./chat/modelOptions.js";
export type { ChatModelOption, EngineKey } from "./chat/modelOptions.js";
export { CHAT_SLASH_COMMANDS } from "./chat/slashCommands.js";
export type { SlashCommandSpec, SlashEngine } from "./chat/slashCommands.js";

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
