// Protocol minter (Path A authority model).
//
// Token-2022 `mintTo` requires the mint authority's signature, so a buyer cannot
// self-mint a creator-authored mint. We resolve this without a custom on-chain
// program by handing each skill mint's authority to ONE protocol minter keypair
// at publish time (createSkillMint adds a setAuthority handoff, signed by the
// creator alone). The minter then co-signs every buy/unlock `mintTo`.
//
// Tradeoff: centralized — whoever holds the minter key controls all supply
// issuance. Acceptable for devnet bring-up; swap for a PDA-authority program
// later if trustless minting is required (see plans/skill-nft-structure.md §4).
//
// Configuration (no key is ever hard-coded):
//   AGENTNET_MINTER_SECRET  — JSON byte array of the minter Keypair secret
//                             (the format `solana-keygen` writes). Required to
//                             buy/unlock; the holder co-signs mintTo.
//   AGENTNET_MINTER_PUBKEY  — optional base58 pubkey. Lets a publisher set the
//                             mint authority WITHOUT holding the secret (the
//                             secret lives only on the minting service).
//
// Both can be overridden per-call (tests, multi-tenant) by passing a Keypair /
// PublicKey directly — same injection style as the validation reviewFn.

import { Keypair, PublicKey } from "@solana/web3.js";

const ENV_SECRET = "AGENTNET_MINTER_SECRET";
const ENV_PUBKEY = "AGENTNET_MINTER_PUBKEY";

let cachedKeypair: Keypair | null = null;

function parseSecret(raw: string): Keypair {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) {
    throw new Error(
      `${ENV_SECRET} must be a JSON byte array (solana-keygen format), e.g. "[12,34,...]"`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
}

/**
 * Resolve the protocol minter Keypair (the mint-authority signer for mintTo).
 * Throws if neither an override nor AGENTNET_MINTER_SECRET is available — buy/
 * unlock cannot proceed without the authority's signature.
 */
export function resolveMinter(override?: Keypair): Keypair {
  if (override) return override;
  if (cachedKeypair) return cachedKeypair;

  const raw = process.env[ENV_SECRET];
  if (!raw) {
    throw new Error(
      `Protocol minter not configured: set ${ENV_SECRET} (JSON byte array) or pass a minter Keypair. ` +
        `Token-2022 mintTo needs the mint authority's signature.`,
    );
  }
  cachedKeypair = parseSecret(raw);
  return cachedKeypair;
}

/**
 * Resolve the protocol minter's PUBLIC key — the authority a new mint is handed
 * to at publish time. Prefers an explicit override, then AGENTNET_MINTER_PUBKEY
 * (so a publisher need not hold the secret), then derives it from the secret.
 * Returns null when nothing is configured: createSkillMint then leaves authority
 * with the creator (buy stays blocked, but publish still works).
 */
export function tryMinterPubkey(override?: PublicKey): PublicKey | null {
  if (override) return override;

  const pk = process.env[ENV_PUBKEY];
  if (pk) return new PublicKey(pk);

  const raw = process.env[ENV_SECRET];
  if (!raw) return null;
  return parseSecret(raw).publicKey;
}

/** Test hook — clear the cached keypair so env changes take effect. */
export function resetMinterCache(): void {
  cachedKeypair = null;
}
