// "What can I unlock" — discovery over workflow NFTs (search.md §2b / §"what can
// I unlock", workflow-nft.md §3). A workflow unlocks when the holder owns every
// one of its `requiredSkill` prerequisites; "almost-there" = missing only a few.
//
// This is pure set math over the enumeration result — no extra RPC, no
// hydration. The source (indexer or dasSource) already carries each workflow's
// requiredSkills as a trait, so listUnlockable works identically on either, and
// the fallback path is the same code (workflow-nft.md §2: "trivial id-set
// compare"). It is DISCOVERY only: heldMints is caller-supplied and untrusted,
// but that's safe — the real gate is on-chain (buy_workflow reverts if a
// prerequisite is missing), so a bogus heldMints at most mislabels a card.

import type { Skill } from "../core/types.js";
import { dasSource, type SkillSource } from "../core/skillSource.js";

export interface UnlockableWorkflow {
  workflow: Skill;        // the workflow row (type === "workflow")
  missing: string[];      // requiredSkill mints the holder doesn't have
  unlockable: boolean;    // missing.length === 0 → can unlock now
}

export interface UnlockOptions {
  /** Enumeration source. Defaults to the DAS collection scan. */
  source?: SkillSource;
  /** Cap on missing prerequisites to still surface as "almost there". Default 2;
   *  0 would return only already-unlockable workflows. */
  maxMissing?: number;
  limit?: number;
}

/**
 * List workflows the holder can unlock now (missing none) plus the "almost
 * there" ones (missing ≤ maxMissing), sorted by fewest missing first — so
 * unlockable workflows lead, then 1-away, then 2-away, …
 *
 * @param heldMints the caller's owned skill mint ids (untrusted — discovery only)
 */
export async function listUnlockable(
  heldMints: string[],
  options?: UnlockOptions,
): Promise<UnlockableWorkflow[]> {
  const source = options?.source ?? dasSource;
  const maxMissing = options?.maxMissing ?? 2;
  const limit = options?.limit ?? 50;
  const held = new Set(heldMints);

  const workflows = (await source.listSkills()).filter(
    (s) => (s.type ?? "skill") === "workflow",
  );

  const result: UnlockableWorkflow[] = [];
  for (const workflow of workflows) {
    const required = workflow.requiredSkills ?? [];
    // A workflow with no prerequisites isn't an "unlock" target — skip it.
    if (required.length === 0) continue;
    const missing = required.filter((m) => !held.has(m));
    if (missing.length > maxMissing) continue;
    result.push({ workflow, missing, unlockable: missing.length === 0 });
  }

  // Fewest missing first (unlockable lead); tie-break by popularity (supply).
  result.sort((a, b) => a.missing.length - b.missing.length || b.workflow.supply - a.workflow.supply);
  return result.slice(0, limit);
}
