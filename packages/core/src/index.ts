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
export { agentnetFolderLink } from "./account/storage/gdrive.js";
export type { CloudStatus } from "./account/storage/mirror.js";
export {
  startCodexLogin,
  isCodexLoggedIn,
  markCodexConnected,
  isCodexMarked,
} from "./account/codexAuth.js";
export type { CodexLogin } from "./account/codexAuth.js";

import type { AgentRuntime, Wallet } from "./runtime/contract.js";
import type { CloudStatus } from "./account/storage/mirror.js";
import type { ApprovalChannel } from "./runtime/approval/channel.js";
import { createRuntime } from "./runtime/index.js";
import { login } from "./account/login.js";

export type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "./runtime/approval/channel.js";
export { autoApprove } from "./runtime/approval/channel.js";

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
