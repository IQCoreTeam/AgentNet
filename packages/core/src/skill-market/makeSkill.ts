// The bundled make-skill passive skill — the PUBLISH-flow analog of skill-shopping's BUY
// flow (plans/hermes-skill-minting.md §3, plans/ai-power-features.md §1). ONE SKILL.md,
// shipped with the app (NOT an NFT), force-installed into both runtimes' skills dirs so the
// CLI discovers it like any other skill. Progressive disclosure: the CLI always shows the
// `description` (the trigger — "you just solved something reusable"); the body (draft →
// confirm → publish) is read only when the agent fires it.
//
// ON-CHAIN ONLY (decided): make-skill captures a reusable technique and PUBLISHES it (mints
// an on-chain NFT via publish_skill). It does NOT write a plain local/general SKILL.md that
// just sits in the skills dir — AgentNet's value is the shared on-chain pool, so a local-only
// skill would bypass it. The dangerous/costly step (the on-chain mint) is enforced in code:
// publish_skill is in PROMPT_BEFORE_USE, so it always routes through the user's approval card.
//
// Toggle/install mirror skill-shopping (passive.ts): ON writes the SKILL.md into each scanned
// skills dir; OFF moves the folder to the un-scanned holding dir (never deletes). Identical
// for both engines (codex ignores `disable-model-invocation`, so file-move is the one
// mechanism that works for both).

import { rename, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import {
  claudeSkillsDir,
  codexSkillsDir,
  inactiveSkillsDir,
  ensureDir,
} from "../core/paths.js";
import { MAKE_SKILL_SLUG } from "./registry.js";

// The bundled SKILL.md. `description` = the TRIGGER; body = a CONSERVATIVE end-of-task review
// that only publishes genuinely worthwhile, non-duplicate skills. This is deliberately a high
// bar: publishing mints a PAID on-chain NFT, and a low-quality or duplicate skill pollutes the
// shared marketplace. The costly step (the mint) and the user's yes are enforced in code; the
// body tells the agent when to bother, how to keep the market clean, and what it must not do.
const SKILL_MD = [
  "---",
  `name: ${MAKE_SKILL_SLUG}`,
  "description: >-",
  "  Offer to publish a skill ONLY after you finish a genuinely reusable, non-trivial task",
  "  that no existing skill (yours or the marketplace's) already covers. Use this as a final",
  "  review step after substantial work: it checks the market for duplicates, and only if the",
  "  technique is clearly worth sharing does it draft a SKILL.md and ask the user once before",
  "  publishing it on-chain.",
  "---",
  "",
  "# Make a skill",
  "",
  "This is a CONSERVATIVE end-of-task review, not a habit. Most tasks should produce NO skill.",
  "Publishing mints a PAID on-chain NFT, and a low-quality or duplicate skill pollutes the",
  "shared market and wastes the user's money. Default to NOT publishing. Only act when the bar",
  "below is clearly met, and the user always confirms first (enforced in code — you can't skip",
  "it).",
  "",
  "## When to run this",
  "As a final step after you finish a SUBSTANTIAL task — a real fix, a multi-step workflow, a",
  "non-obvious setup or debugging pattern. Skip it entirely for trivial Q&A, one-off answers,",
  "small edits, or anything you're unsure about.",
  "",
  "## 1. Is it genuinely worth sharing? (high bar)",
  "Continue only if ALL are true: the technique is reusable across future tasks; it is",
  "non-trivial (not something any agent would just do anyway); and it would genuinely help",
  "other people's agents. If you are unsure, the answer is NO — stop here.",
  "",
  "## 2. Check the market for duplicates (keep it clean)",
  "Call `search_skills` with the ability's keywords. If an existing skill — yours or one in",
  "the market — already covers it, STOP and do not publish a duplicate. A clean market is",
  "worth more than one more skill.",
  "",
  "## 3. Draft the SKILL.md",
  "Write a tight SKILL.md from what you ACTUALLY did this session:",
  "- name: short, kebab-case.",
  "- description: the \"what + when\" — when a future agent should reach for it. This is what",
  "  makes it discoverable, so make it concrete and specific.",
  "- body: the steps, with the exact commands, paths, flags, endpoints, and config keys that",
  "  VERBATIM worked. Never invent flags, paths, or APIs — only what you verified.",
  "",
  "## 4. Ask the user once",
  "Show the drafted name + description + a one-line pitch, and say plainly that publishing",
  "mints it on-chain and costs about 0.1 SOL. Ask once whether to publish. If they say no, or",
  "do not clearly say yes, stop — do not publish.",
  "",
  "## 5. Publish",
  "On their explicit yes, call `publish_skill` with the draft (name, description, skillText,",
  "and a category / hashtags if useful). It routes through an approval card and mints the",
  "skill; you then own it and it joins the shared market.",
  "",
  "## Must not",
  "- Never publish without the user's explicit yes.",
  "- Never publish a skill that duplicates one that already exists — search first (step 2).",
  "- Never publish trivial or one-off work. When in doubt, don't.",
  "- Never include secrets, credentials, private keys, seed phrases, or wallet files — a",
  "  published skill is public and permanent.",
  "- Never invent commands, flags, paths, or APIs — only what verifiably worked this session.",
  "",
].join("\n");

// The per-runtime (active dir, holding dir) pairs. ON lives in the active (scanned) dir;
// OFF lives in the holding dir. One list so install/toggle treat both engines identically.
function locations(): { active: string; inactive: string }[] {
  return [
    { active: claudeSkillsDir(), inactive: inactiveSkillsDir("claude") },
    { active: codexSkillsDir(), inactive: inactiveSkillsDir("codex") },
  ];
}

/**
 * Make the make-skill skill present (ON) or absent (OFF) for both runtimes, by moving its
 * folder between the scanned dir and the holding dir — never deleting it. Mirrors
 * setSkillShoppingActive (passive.ts).
 *
 * ON  → ensure the SKILL.md exists in each scanned skills dir (write it fresh; supersede any
 *       copy sitting in the holding dir).
 * OFF → move the folder out of each scanned dir into the holding dir. Idempotent.
 *
 * Best-effort per location: one engine's fs hiccup doesn't block the other or the session.
 */
export async function setMakeSkillActive(on: boolean): Promise<void> {
  for (const { active, inactive } of locations()) {
    const activeDir = join(active, MAKE_SKILL_SLUG);
    const inactiveDir = join(inactive, MAKE_SKILL_SLUG);
    try {
      if (on) {
        await ensureDir(activeDir);
        await writeFile(join(activeDir, "SKILL.md"), SKILL_MD);
        await rm(inactiveDir, { recursive: true, force: true }); // active copy supersedes any held one
      } else if (await access(activeDir).then(() => true).catch(() => false)) {
        await ensureDir(inactive);
        await rm(inactiveDir, { recursive: true, force: true });
        await rename(activeDir, inactiveDir);
      }
      // else: already OFF (no active copy) — leave the holding copy untouched. Idempotent.
    } catch {
      /* best-effort: skip this runtime, don't block the other or the session */
    }
  }
}
