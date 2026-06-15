import { Connection } from "@solana/web3.js";
import { init } from "../src/core/chain.js";
import { readSkillText } from "../src/nft/token2022.js";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
init(conn);
const text = await readSkillText(conn, "p3aYDgzDE1tkcH28ohgoTKfxP994REv4Wf8YhZ3iFj8" as any);
console.log("null?", text === null, "| length:", text?.length ?? 0);
console.log("first 150:", JSON.stringify(text?.slice(0, 150)));
