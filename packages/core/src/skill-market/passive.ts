// Passive skill-shopping workflow (issue #21). ONE always-on workflow, force-loaded
// every session, that changes how the agent handles a MISSING capability mid-task.
//
//   ON  ("shop for me", default): search owned skills → search marketplace → verify the
//        candidate's text → ask the user to confirm payment → buy_skill (the install path
//        auto-equips it). verify is a STEP here, hard-gated in handleToolCall.
//   OFF ("quiet"): use owned skills only, silently, never buy. The single allowance is to
//        OCCASIONALLY suggest a buy — recommendation only — and ONLY when a capability is
//        clearly missing AND the wallet can afford it (funds-gated by the host).
//
// The same prose drives both runtimes: Claude gets it via systemPrompt.append; Codex gets
// it spliced into AGENTS.md (distinct `:skills:` markers), mirroring the memory inject path.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  claudeSkillsDir,
  codexSkillsDir,
  codexAgentsFile,
  ensureDir,
} from "../core/paths.js";
import { spliceMarkedBlock } from "../memory/convert/codex.js";

export const PASSIVE_SKILL_SLUG = "skill-shopping";

const SKILLS_START = "<!-- agentnet:skills:start -->";
const SKILLS_END = "<!-- agentnet:skills:end -->";

export interface PassiveMode {
  on: boolean;
  // OFF only: may the agent surface the single buy-suggestion? The host sets this to
  // true ONLY when the wallet is funded (issue #21 funds-gate) — an empty wallet gets
  // the fully-silent OFF variant, so we never nag someone with no SOL to spend.
  offCanSuggest?: boolean;
}

// The behavior text. `on` selects the shop variant; OFF picks funded-suggest vs silent.
export function passiveWorkflowProse(mode: PassiveMode): string {
  if (mode.on) {
    return [
      "## Skill-shopping (ON)",
      "",
      "When you lack a capability needed for the task, shop for a skill instead of giving up:",
      "1. First search the skills you ALREADY own (installed SKILL.md files) for a fit.",
      "2. If none fits, call `search_skills` to find a marketplace candidate.",
      "3. Call `verify_skill` on the candidate and review its text for format and safety.",
      "   (You cannot buy a skill until verify_skill has passed for it this session.)",
      "4. Ask the user to confirm the payment, then call `buy_skill`. The bought skill is",
      "   installed and equipped automatically — then use it.",
      "Never buy a skill you have not verified, and never buy without the user confirming the spend.",
    ].join("\n");
  }
  const lines = [
    "## Skill-shopping (OFF — quiet)",
    "",
    "Use only the skills you ALREADY own, silently. Do NOT search the marketplace and do NOT buy anything.",
  ];
  if (mode.offCanSuggest) {
    lines.push(
      "The single exception: if a capability is CLEARLY missing for the task, you may ONCE surface a",
      "recommendation. Before you do, funds-gate it: call `search_skills` to find the candidate and its",
      "price, then `wallet_balance` to read the wallet's SOL — and ONLY suggest if the balance covers the",
      "price plus the network fee. If it can't afford it, stay silent. When affordable, surface exactly one",
      "line — \"Found a skill that'd help here — buy it? (≈X SOL)\" — and nothing more. You have NO buy or",
      "verify tools here: it is a suggestion only, never a purchase. Only suggest on a real gap, not a timer.",
    );
  } else {
    lines.push(
      "Do not suggest buying anything either — stay fully silent about the marketplace.",
    );
  }
  return lines.join("\n");
}

// Bundled SKILL.md for the always-on workflow (not a bought NFT). Force-installed into
// the skills dir so the runtime discovers it like any other skill.
function passiveSkillMd(mode: PassiveMode): string {
  const description = mode.on
    ? "Shop the marketplace for a skill when a capability is missing (verify, confirm payment, buy)."
    : "Use owned skills only; occasionally suggest (never buy) a skill when one is clearly missing.";
  return [
    "---",
    `name: ${PASSIVE_SKILL_SLUG}`,
    `description: ${description}`,
    "---",
    "",
    passiveWorkflowProse(mode),
    "",
  ].join("\n");
}

// Force-load the workflow skill into both runtimes' skills dirs. Returns the slug.
export async function installPassiveSkill(mode: PassiveMode): Promise<string> {
  const md = passiveSkillMd(mode);
  for (const base of [claudeSkillsDir(), codexSkillsDir()]) {
    const dir = join(base, PASSIVE_SKILL_SLUG);
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), md);
  }
  return PASSIVE_SKILL_SLUG;
}

// The managed AGENTS.md block (between the `:skills:` markers). Regenerated each session.
export function renderSkillsBlock(mode: PassiveMode): string {
  const head = "# Skill-shopping (managed by AgentNet — do not edit between the markers)";
  return `${SKILLS_START}\n${head}\n\n${passiveWorkflowProse(mode)}\n${SKILLS_END}\n`;
}

// Splice the skills directive into the cwd's AGENTS.md, preserving human content and any
// coexisting memory block (distinct markers).
export async function writeCodexSkills(cwd: string, mode: PassiveMode): Promise<void> {
  const file = codexAgentsFile(cwd);
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* no AGENTS.md yet */
  }
  await writeFile(
    file,
    spliceMarkedBlock(existing, renderSkillsBlock(mode), SKILLS_START, SKILLS_END),
  );
}
