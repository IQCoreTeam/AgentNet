// Read-only probe: who is the TokenGroup update authority of our devnet
// skills/workflows collections? createSkillMint enrolls a new mint as a member,
// and that enrollment is co-signed by the protocol minter (AGENTNET_MINTER_*) —
// which MUST equal the group's stored update authority, or every publish fails
// on-chain with "incorrect update authority". This tells us which key the seed
// script must use as the minter.
//
// Usage: npx tsx scripts/probe-collection-authority.ts

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  getExtensionData,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { unpackTokenGroup } from "@solana/spl-token-group";
import {
  getSkillsCollectionMint,
  getWorkflowsCollectionMint,
} from "../src/core/seed.js";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const targets: [string, string | null][] = [
    ["SKILLS", getSkillsCollectionMint()],
    ["WORKFLOWS", getWorkflowsCollectionMint()],
  ];

  console.log("RPC:", RPC, "\n");
  for (const [label, addr] of targets) {
    if (!addr) {
      console.log(`${label}: (unset)`);
      continue;
    }
    const mint = new PublicKey(addr);
    try {
      const acc = await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      const data = getExtensionData(ExtensionType.TokenGroup, acc.tlvData);
      if (!data) {
        console.log(`${label}: ${addr} -> no TokenGroup extension`);
        continue;
      }
      const group = unpackTokenGroup(data);
      const ua =
        (group.updateAuthority as PublicKey | undefined)?.toBase58?.() ??
        String(group.updateAuthority);
      console.log(`${label}: ${addr}`);
      console.log(`  updateAuthority: ${ua}`);
      console.log(`  size/maxSize:    ${String(group.size)} / ${String(group.maxSize)}`);
    } catch (e) {
      console.log(`${label}: ${addr} -> ERROR: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
