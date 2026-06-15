// Thin async helpers over the core. These are the SAME calls the vscode surface makes
// in extension.ts boot()/openOnboarding() — the CLI is just another window onto the
// runtime. No engine/storage logic lives here; we only sequence existing core exports.

import {
  connect,
  initialize,
  isInitialized,
  detectCli,
  logout,
  type CliReport,
} from "@iqlabs-official/agent-sdk";
import type { StorageConfig, LogoutPolicy } from "@iqlabs-official/agent-sdk";
import { localWallet, solanaDefaultKeypairPath } from "@iqlabs-official/agent-sdk/account/localWallet";
import type { AgentRuntime, Wallet } from "@iqlabs-official/agent-sdk/runtime/contract";
import type { ApprovalChannel } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import type { CloudStatus } from "@iqlabs-official/agent-sdk/account/storage/mirror";
import open from "open";

export { isInitialized, detectCli, solanaDefaultKeypairPath };
export type { CliReport };

export interface LoadedWallet {
  wallet: Wallet;
  address: string;
}

// Load (or generate) the local Solana keypair → Wallet. Default path is the Solana CLI
// standard ~/.config/solana/id.json.
export async function loadWallet(keypairPath?: string): Promise<LoadedWallet> {
  const r = await localWallet(keypairPath);
  return { wallet: r.wallet, address: r.address };
}

// Bind wallet → storage → runtime. local is always on; cloud mirrors if configured.
export function buildRuntime(
  wallet: Wallet,
  approval?: ApprovalChannel,
  onCloud?: (s: CloudStatus) => void,
): Promise<AgentRuntime> {
  return connect(wallet, onCloud, approval);
}

// First-run only: persist the chosen storage backend. gdrive needs a browser for OAuth,
// which we open with the `open` package (the surface-injected openBrowser callback).
export async function chooseStorage(cfg: StorageConfig): Promise<void> {
  await initialize(cfg, (url) => void open(url));
}

export async function doLogout(policy: LogoutPolicy = "soft", address?: string): Promise<void> {
  await logout({ policy, address });
}
