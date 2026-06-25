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

// The bundled SKILL.md. `description` = the TRIGGER (you just worked out something reusable
// that isn't already a skill); body = the draft → confirm → publish flow. The costly step
// (the on-chain mint) and the user's yes are enforced in code; the body tells the agent the
// shape, the on-chain framing, and what it must not do.
const SKILL_MD = [
  "---",
  `name: ${MAKE_SKILL_SLUG}`,
  "description: >-",
  "  Capture a reusable technique you just worked out as a publishable on-chain skill. Reach",
  "  for this right after you solve a non-trivial, repeatable task (a fix, a workflow, a setup)",
  "  that your installed skills did not already cover. It drafts a SKILL.md from what you just",
  "  did and, with the user's explicit go-ahead, publishes it to the marketplace so every",
  "  agent can reuse it.",
  "---",
  "",
  "# Make a skill",
  "",
  "Reach for this the moment you finish something reusable that wasn't already one of your",
  "skills. Publishing mints an on-chain NFT and costs the user SOL, so it ALWAYS needs their",
  "explicit yes (enforced in code — you cannot skip it). Don't capture one-off or trivial work,",
  "and don't duplicate a skill that already exists.",
  "",
  "## 1. Decide it's worth keeping",
  "Only capture a genuinely reusable technique: a fix, a multi-step workflow, a config/setup,",
  "a debugging pattern that will recur. A one-off answer is not a skill. If an installed skill",
  "already covers it, stop — use that instead.",
  "",
  "## 2. Draft the SKILL.md",
  "Write a tight SKILL.md from what you ACTUALLY did this session:",
  "- name: short, kebab-case.",
  "- description: the \"what + when\" — when a future agent should reach for it. This is what",
  "  makes it discoverable, so make it concrete and specific.",
  "- body: the steps, with the exact commands, paths, flags, endpoints, and config keys that",
  "  VERBATIM worked. Never invent flags, paths, or APIs — only what you verified.",
  "",
  "## 3. Show the user and ask",
  "Show the drafted name + description + a one-line summary, and say plainly that publishing",
  "mints it on-chain and costs about 0.1 SOL. Ask if they want to publish it. If they say no,",
  "stop — do not publish.",
  "",
  "## 4. Publish",
  "On their explicit yes, call `publish_skill` with the draft (name, description, skillText,",
  "and a category / hashtags if useful). It routes through an approval card and mints the",
  "skill; you then own it and it joins the shared market. Use it to keep working if relevant.",
  "",
  "## Must not",
  "- Never publish without the user's explicit yes.",
  "- Never include secrets, credentials, private keys, seed phrases, or wallet files — a",
  "  published skill is public and permanent.",
  "- Never invent commands, flags, paths, or APIs — only what verifiably worked this session.",
  "- Don't publish trivial or one-off work, or a skill that duplicates one that already exists",
  "  (search first if unsure).",
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
