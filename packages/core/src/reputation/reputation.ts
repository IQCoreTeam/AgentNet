// Agent reputation. Per the spec this is NOT a stored/computed score:
//   - notes.md: "Not a rating/score — just text written on-chain"
//   - skill-nft-structure.md: "Famous agent = sum of `supply` across the skills
//     that agent created"
// So an agent's standing IS `totalSupply` (sum of their skills' on-chain supply),
// derived live from the mints + a review count. There is NO reputation table —
// nothing to write or keep in sync; every read recomputes from the chain.

import type { Connection } from "@solana/web3.js";
import { readRows } from "../core/chain.js";
import { reviewsHint, collectionFor, FEE_BPS } from "../core/seed.js";
import { dasSource, type SkillSource } from "../core/skillSource.js";
import type { Reputation, Skill } from "../core/types.js";
import { getMintSupply } from "../nft/token2022.js";

// Net lamports a creator keeps from their skills' paid sales, as a decimal string.
// supply includes the creator's own publish self-mint, so paid sales = supply-1; FEE_BPS
// comes out of the price. A free skill (price absent/"0") or an unsold one contributes 0.
// BigInt throughout: lamports x supply overflows Number. `prices`/`supplies` align by index.
function netEarnedLamports(prices: Array<string | undefined>, supplies: number[]): string {
  const keep = BigInt(10000 - FEE_BPS); // creator keeps (10000 - FEE_BPS)/10000 of the price
  let earned = 0n;
  for (let i = 0; i < supplies.length; i++) {
    const sales = supplies[i] - 1;
    const price = prices[i];
    if (!price || sales <= 0) continue;
    let lamports: bigint;
    try { lamports = BigInt(price); } catch { continue; }
    if (lamports <= 0n) continue;
    earned += (lamports * BigInt(sales) * keep) / 10000n;
  }
  return earned.toString();
}

export async function getReputation(
  conn: Connection,
  wallet: string,
  source: SkillSource = dasSource,
  catalog?: Skill[],
): Promise<Reputation> {
  // Enumerate skills via the collection scan, filter by creator. A caller that has
  // already fetched the catalog (e.g. getAgentProfile's search results, indexer-hydrated)
  // can pass it to skip a duplicate listSkills round-trip.
  const allSkills = catalog ?? (await source.listSkills());
  const mySkills = allSkills.filter((s) => s.creator === wallet);

  const skillsPublished = mySkills.length;
  // totalSupply = the documented "fame" metric. A hydrated source (indexer) — or a
  // passed-in catalog, which comes from the indexer — already carries live supply;
  // otherwise read it per-mint from the chain.
  const supplies = catalog || source.hydrated
    ? mySkills.map((s) => Number(s.supply))
    : await Promise.all(mySkills.map((s) => getMintSupply(conn, s.id)));
  const totalSupply = supplies.reduce((acc, n) => acc + n, 0);
  const totalEarned = netEarnedLamports(mySkills.map((s) => s.price), supplies);

  // Count reviews across all creator's skills (informational, not a score).
  // Fan out in parallel: a prolific agent has many skills and a sequential loop
  // (one gateway round-trip each) dominated profile-load latency. The gateway
  // caches these, so one concurrent round is cheap.
  const reviewCounts = await Promise.all(
    mySkills.map((skill) =>
      readRows(reviewsHint(collectionFor(skill.type), skill.id), { limit: 1000 })
        .then((reviews) => reviews.filter((n) => typeof n.id === "string").length)
        .catch(() => 0),
    ),
  );
  const notesReceived = reviewCounts.reduce((acc, n) => acc + n, 0);

  return {
    wallet,
    skillsPublished,
    totalSupply,
    totalEarned,
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
    const totalEarned = netEarnedLamports(creatorSkills.map((s) => s.price), supplies);
    entries.push({
      wallet,
      skillsPublished,
      totalSupply,
      totalEarned,
      notesReceived: 0,
      updatedAt: Date.now(),
    });
  }

  return entries
    .sort((a, b) => b.totalSupply - a.totalSupply)
    .slice(0, limit);
}
