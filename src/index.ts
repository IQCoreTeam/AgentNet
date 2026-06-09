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

export type {
  SignerInput,
  Session,
  Skill,
  Workflow,
  Note,
  Row,
  ReadOptions,
} from "./core/types.js";

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

export {
  AGENTNET_ROOT_ID,
  mysessionsHint,
  notesSkillHint,
  notesAgentHint,
  AUDIT_HINT,
} from "./core/seed.js";

export {
  deriveSessionKey,
  encryptForWallet,
  decryptForWallet,
  type SessionKey,
} from "./core/crypto.js";

export {
  publishSkill,
  buySkill,
  createSkillMint,
  mintSkillToken,
} from "./nft/index.js";
export type { PublishSkillInput, BuySkillInput } from "./nft/skill.js";

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

import type { AgentRuntime, Wallet } from "./runtime/contract.js";
import type { CloudStatus } from "./account/storage/mirror.js";
import { createRuntime } from "./runtime/index.js";
import { login } from "./account/login.js";

// Connect a wallet, restore its configured storage, return a ready runtime.
// (Assumes initialize() was already run once to pick a storage backend.)
// onCloudStatus (optional): reports whether each drive-mirror write succeeded, so
// the UI can show the sync state instead of failing silently.
export async function connect(
  wallet: Wallet,
  onCloudStatus?: (s: CloudStatus) => void,
): Promise<AgentRuntime> {
  const session = await login(wallet, onCloudStatus);
  return createRuntime(session.wallet, session.storage);
}
