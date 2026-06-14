// Active-skill injection test (issue #17). No CLI / no chain — exercises the pure
// conversion (NFT skill metadata → SKILL.md) and the on-disk placement the runtime
// discovers. Run: pnpm tsx test/test-skills.ts
//
// Isolate writes into a temp home BEFORE importing path-resolving modules.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const tmp = mkdtempSync(join(tmpdir(), "agentnet-skills-"));
process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
process.env.CODEX_HOME = join(tmp, "codex");

const { toSkillMd, skillSlug } = await import("../src/skill-market/ingest/convert.js");
const { claudeSkillsDir, codexSkillsDir, ensureDir } = await import("../src/core/paths.js");
const { mapCodexEvent } = await import("../src/runtime/convert/codex.js");
const { chatHtml } = await import("../src/chat/ui/webview.js");
import type { SkillMintMetadata } from "../src/nft/token2022.js";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}`);
  if (!cond) failures++;
}

const MINT = "7xKq9fRa3dEf8gHj2kLm4nPq6rStUvWx1yZaBcDeFgHi";

// 1. Synthesize frontmatter when the body has none (the common case).
console.log("1. Synthesize SKILL.md frontmatter from NFT metadata");
{
  const meta: SkillMintMetadata = {
    name: "Clean Code Refactor",
    symbol: "CLEAN-CO",
    uri: "txid123",
    description: "Refactor toward clean, testable code.",
    category: "clean-code",
    hashtags: ["refactoring", "testing"],
    skillText: "# Clean Code Refactor\n\nDo the thing.",
  };
  const md = toSkillMd(meta, MINT);
  check("starts with frontmatter", md.startsWith("---\n"));
  check("name is slugified", md.includes("name: clean-code-refactor"));
  check("description present", md.includes('description: "Refactor toward clean, testable code."'));
  check("category as single trait", md.includes('category: "clean-code"'));
  check("each hashtag a repeated skill trait",
    md.includes('skill: "refactoring"') && md.includes('skill: "testing"'));
  check("body follows frontmatter", md.includes("Do the thing."));
  check("frontmatter closes before body", md.indexOf("\n---\n") < md.indexOf("Do the thing."));
}

// 2. Preserve an author's own frontmatter verbatim (don't double-wrap).
console.log("2. Preserve publisher-authored frontmatter");
{
  const authored = `---\nname: my-skill\ndescription: "authored"\nuser-invocable: true\n---\n\n# Body\n`;
  const meta: SkillMintMetadata = {
    name: "ignored-display", symbol: "X", uri: "t", description: "ignored",
    skillText: authored,
  };
  const md = toSkillMd(meta, MINT);
  check("no second frontmatter block", (md.match(/^---/gm) || []).length === 2);
  check("authored name kept", md.includes("name: my-skill"));
  check("authored user-invocable kept", md.includes("user-invocable: true"));
  check("synthesized description NOT injected", !md.includes('description: "ignored"'));
}

// 3. Slug fallbacks + safety.
console.log("3. Slug derivation");
{
  check("spaces/case → kebab", skillSlug({ name: "My Cool Skill" } as SkillMintMetadata, MINT) === "my-cool-skill");
  check("empty name → mint-based fallback",
    skillSlug({ name: "" } as SkillMintMetadata, MINT) === `skill-${MINT.slice(0, 8).toLowerCase()}`);
  const md = toSkillMd({ name: "", symbol: "X", uri: "t" } as SkillMintMetadata, MINT);
  check("no skillText → valid file with a heading", md.includes("---\n") && md.trim().endsWith("#") === false && md.includes("#"));
}

// 4. On-disk placement: the minimal shape the runtime discovers ({dir}/{slug}/SKILL.md).
console.log("4. On-disk placement (both runtimes)");
{
  const meta: SkillMintMetadata = {
    name: "trading-bot", symbol: "T", uri: "t",
    description: "Auto-trade.", skillText: "# Trading\n",
  };
  const slug = skillSlug(meta, MINT);
  for (const [label, dir] of [["claude", claudeSkillsDir()], ["codex", codexSkillsDir()]] as const) {
    const target = join(dir, slug, "SKILL.md");
    await ensureDir(join(dir, slug));
    writeFileSync(target, toSkillMd(meta, MINT));
    check(`${label}: SKILL.md written under {dir}/{slug}/`, existsSync(target));
    check(`${label}: discoverable frontmatter on disk`,
      readFileSync(target, "utf8").includes("name: trading-bot"));
  }
  check("claude + codex dirs are distinct", claudeSkillsDir() !== codexSkillsDir());
}

// 5. codex usage cue: a command referencing our skills dir → skill slug (no per-tool
//    hook on codex, so we detect from the output stream — issue #17 workaround).
console.log("5. codex skill-firing detection from the output stream");
{
  const dir = codexSkillsDir();
  const fired = mapCodexEvent({
    type: "item.completed",
    item: { type: "command_execution", command: `python3 ${dir}/trading-bot/scripts/run.py --go` },
  });
  check("command under skills dir → skill slug extracted", fired.skill === "trading-bot");

  const unrelated = mapCodexEvent({
    type: "item.completed",
    item: { type: "command_execution", command: "ls -la /tmp" },
  });
  check("unrelated command → no skill signal", unrelated.skill === undefined);

  const msgOnly = mapCodexEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "done" },
  });
  check("plain message → no skill signal", msgOnly.skill === undefined);
}

// 6. Message contract ↔ VSCode webview agreement. The webview is an HTML string
//    (no compile-time typecheck), so guard that every marketplace `type` it emits/
//    handles is a real message in the shared contract — a typo or a removed message
//    fails here instead of silently no-op'ing on that surface.
console.log("6. webview market messages match the shared contract");
{
  const html = chatHtml();
  // requests the webview SENDS (UI -> host) and events it HANDLES (host -> UI)
  const REQUESTS = ["searchSkills", "buySkill", "ownedSkills"];
  const EVENTS = ["searchResults", "buyResult", "ownedSkills", "skillActive"];
  for (const t of REQUESTS) {
    check(`webview sends '${t}'`, html.includes(`type: '${t}'`));
  }
  for (const t of EVENTS) {
    check(`webview handles '${t}'`, html.includes(`m.type === '${t}'`));
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
