// Read a minted skill's ACTUAL on-chain TokenGroupMember.group (not DAS's
// transformed view) and compare to seed.ts's default skills collection.
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getExtensionData, ExtensionType, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { unpackTokenGroupMember } from "@solana/spl-token-group";
import { getSkillsCollectionMint } from "../src/core/seed.js";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const SKILL = "p3aYDgzDE1tkcH28ohgoTKfxP994REv4Wf8YhZ3iFj8"; // format-and-lint

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log("seed.ts default SKILLS collection:", getSkillsCollectionMint());
  const acc = await getMint(conn, new PublicKey(SKILL), "confirmed", TOKEN_2022_PROGRAM_ID);
  const data = getExtensionData(ExtensionType.TokenGroupMember, acc.tlvData);
  if (!data) { console.log("NO TokenGroupMember extension on this mint!"); return; }
  const member = unpackTokenGroupMember(data);
  console.log("minted skill's on-chain member.group:", member.group.toBase58());
  console.log("member.mint:", member.mint.toBase58());
  console.log("member number:", String(member.memberNumber));
  console.log("");
  console.log("MATCH seed default?", member.group.toBase58() === getSkillsCollectionMint());
}
main().catch(e => { console.error(e); process.exit(1); });
