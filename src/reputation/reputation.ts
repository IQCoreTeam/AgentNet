// Agent reputation: derived from skills published, buyers (supply), notes received.
//
// getReputation: reads chain tables, computes + returns score snapshot
// updateReputation: writes snapshot row on-chain (called post-publish/post-buy)

import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  readRows,
  writeRow,
  ensureTable,
  signerAddress,
} from "../core/chain.js";
import { AUDIT_HINT, notesSkillHint, reputationHint, REPUTATION_COLUMNS } from "../core/seed.js";
import type { Reputation, Skill, Row } from "../core/types.js";
import { getMintSupply } from "../nft/token2022.js";

function computeScore(
  skillsPublished: number,
  totalSupply: number,
  notesReceived: number,
): number {
  return totalSupply * 3 + skillsPublished * 10 + notesReceived;
}

export async function getReputation(
  conn: Connection,
  wallet: string,
): Promise<Reputation> {
  // Read all skills from audit table, filter by creator. Non-row entries
  // (metadata shapes from readTableRows) are dropped by the id/creator check.
  const allSkillRows = await readRows(AUDIT_HINT, { limit: 1000 });
  const mySkills = (allSkillRows as unknown as Skill[]).filter(
    (s) => typeof s.id === "string" && s.creator === wallet,
  );

  const skillsPublished = mySkills.length;
  // Hydrate live supply from each mint (indexed supply is stale — always 0).
  const supplies = await Promise.all(
    mySkills.map((s) => getMintSupply(conn, s.id)),
  );
  const totalSupply = supplies.reduce((acc, n) => acc + n, 0);

  // Count notes across all creator's skills (only real note rows).
  let notesReceived = 0;
  for (const skill of mySkills) {
    const notes = await readRows(notesSkillHint(skill.id), { limit: 1000 });
    notesReceived += notes.filter((n) => typeof n.id === "string").length;
  }

  const score = computeScore(skillsPublished, totalSupply, notesReceived);

  return {
    wallet,
    skillsPublished,
    totalSupply,
    notesReceived,
    score,
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
): Promise<Reputation[]> {
  // Read all skills, group by creator, compute scores. Drop non-row entries
  // (metadata shapes from readTableRows) so we don't group under undefined.
  const allSkillRows = await readRows(AUDIT_HINT, { limit: 1000 });
  const skills = (allSkillRows as unknown as Skill[]).filter(
    (s) => typeof s.id === "string" && typeof s.creator === "string",
  );

  // Group by creator
  const creatorMap = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (!creatorMap.has(skill.creator)) {
      creatorMap.set(skill.creator, []);
    }
    creatorMap.get(skill.creator)!.push(skill);
  }

  // Build reputation entries (no notes count for leaderboard — avoid N+1)
  const entries: Reputation[] = [];
  for (const [wallet, creatorSkills] of creatorMap.entries()) {
    const skillsPublished = creatorSkills.length;
    // Hydrate live supply from each mint (indexed supply is stale — always 0).
    const supplies = await Promise.all(
      creatorSkills.map((s) => getMintSupply(conn, s.id)),
    );
    const totalSupply = supplies.reduce((acc, n) => acc + n, 0);
    entries.push({
      wallet,
      skillsPublished,
      totalSupply,
      notesReceived: 0, // omitted for leaderboard performance
      score: computeScore(skillsPublished, totalSupply, 0),
      updatedAt: Date.now(),
    });
  }

  return entries
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
