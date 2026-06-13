// Agent reputation. Per the spec this is NOT a stored/computed score:
//   - notes.md: "Not a rating/score — just text written on-chain"
//   - skill-nft-structure.md: "Famous agent = sum of `supply` across the skills
//     that agent created"
// So an agent's standing IS `totalSupply` (sum of their skills' on-chain supply),
// derived live from the mints + a review count. There is NO reputation table —
// nothing to write or keep in sync; every read recomputes from the chain.

import type { Connection } from "@solana/web3.js";
import { readRows } from "../core/chain.js";
import { reviewsHint, collectionFor } from "../core/seed.js";
import { dasSource, type SkillSource } from "../core/skillSource.js";
import type { Reputation, Skill } from "../core/types.js";
import { getMintSupply } from "../nft/token2022.js";

export async function getReputation(
  conn: Connection,
  wallet: string,
  source: SkillSource = dasSource,
): Promise<Reputation> {
  // Enumerate skills via the collection scan, filter by creator.
  const mySkills = (await source.listSkills()).filter(
    (s) => s.creator === wallet,
  );

  const skillsPublished = mySkills.length;
  // totalSupply = the documented "fame" metric. A hydrated source (indexer)
  // already carries live supply; otherwise read it per-mint from the chain.
  const supplies = source.hydrated
    ? mySkills.map((s) => Number(s.supply))
    : await Promise.all(mySkills.map((s) => getMintSupply(conn, s.id)));
  const totalSupply = supplies.reduce((acc, n) => acc + n, 0);

  // Count reviews across all creator's skills (informational, not a score).
  let notesReceived = 0;
  for (const skill of mySkills) {
    const reviews = await readRows(reviewsHint(collectionFor(skill.type), skill.id), { limit: 1000 });
    notesReceived += reviews.filter((n) => typeof n.id === "string").length;
  }

  return {
    wallet,
    skillsPublished,
    totalSupply,
    notesReceived,
    updatedAt: Date.now(),
  };
}

export async function getLeaderboard(
  conn: Connection,
  limit = 20,
  source: SkillSource = dasSource,
): Promise<Reputation[]> {
  // Enumerate skills via the collection scan, group by creator. Drop entries
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

  // Rank by totalSupply (the documented fame metric). Reviews omitted here to
  // avoid N+1 reads — they're informational, not part of ranking anyway. A
  // hydrated source carries live supply; otherwise read each mint.
  const entries: Reputation[] = [];
  for (const [wallet, creatorSkills] of creatorMap.entries()) {
    const skillsPublished = creatorSkills.length;
    const supplies = source.hydrated
      ? creatorSkills.map((s) => Number(s.supply))
      : await Promise.all(creatorSkills.map((s) => getMintSupply(conn, s.id)));
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
