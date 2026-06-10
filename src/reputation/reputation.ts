// Agent reputation. Per the spec this is NOT a computed score:
//   - notes.md: "Not a rating/score — just text written on-chain"
//   - skill-nft-structure.md: "Famous agent = sum of `supply` across the skills
//     that agent created"
// So an agent's standing IS `totalSupply` (sum of their skills' on-chain supply).
// notesReceived is surfaced as an informational count, never folded into a score.

import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { notesSkillHint, reputationHint, REPUTATION_COLUMNS } from "../core/seed.js";
import { indexTableSource, type SkillSource } from "../core/skillSource.js";
import type { Reputation, Skill } from "../core/types.js";
import { getMintSupply } from "../nft/token2022.js";

export async function getReputation(
  conn: Connection,
  wallet: string,
  source: SkillSource = indexTableSource,
): Promise<Reputation> {
  // Enumerate skills via the CacheLayer source, filter by creator.
  const mySkills = (await source.listSkills()).filter(
    (s) => s.creator === wallet,
  );

  const skillsPublished = mySkills.length;
  // Hydrate live supply from each mint (indexed supply is stale — always 0).
  // totalSupply = the documented "fame" metric.
  const supplies = await Promise.all(
    mySkills.map((s) => getMintSupply(conn, s.id)),
  );
  const totalSupply = supplies.reduce((acc, n) => acc + n, 0);

  // Count notes across all creator's skills (informational, not a score).
  let notesReceived = 0;
  for (const skill of mySkills) {
    const notes = await readRows(notesSkillHint(skill.id), { limit: 1000 });
    notesReceived += notes.filter((n) => typeof n.id === "string").length;
  }

  return {
    wallet,
    skillsPublished,
    totalSupply,
    notesReceived,
    updatedAt: Date.now(),
  };
}

export async function updateReputation(
  conn: Connection,
  signer: SignerInput,
  wallet: string,
): Promise<Reputation> {
  const rep = await getReputation(conn, wallet);
  const hint = reputationHint(wallet);
  await ensureTable(signer, hint, REPUTATION_COLUMNS, "wallet");
  await writeRow(signer, hint, JSON.stringify(rep));
  return rep;
}

export async function getLeaderboard(
  conn: Connection,
  limit = 20,
  source: SkillSource = indexTableSource,
): Promise<Reputation[]> {
  // Enumerate skills via the CacheLayer source, group by creator. Drop entries
  // with no creator so we don't group under undefined.
  const skills = (await source.listSkills()).filter(
    (s) => typeof s.creator === "string",
  );

  // Group by creator
  const creatorMap = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (!creatorMap.has(skill.creator)) {
      creatorMap.set(skill.creator, []);
    }
    creatorMap.get(skill.creator)!.push(skill);
  }

  // Rank by totalSupply (the documented fame metric). Notes omitted here to
  // avoid N+1 reads — they're informational, not part of ranking anyway.
  const entries: Reputation[] = [];
  for (const [wallet, creatorSkills] of creatorMap.entries()) {
    const skillsPublished = creatorSkills.length;
    const supplies = await Promise.all(
      creatorSkills.map((s) => getMintSupply(conn, s.id)),
    );
    const totalSupply = supplies.reduce((acc, n) => acc + n, 0);
    entries.push({
      wallet,
      skillsPublished,
      totalSupply,
      notesReceived: 0,
      updatedAt: Date.now(),
    });
  }

  return entries
    .sort((a, b) => b.totalSupply - a.totalSupply)
    .slice(0, limit);
}
