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
