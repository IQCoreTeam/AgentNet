// Seed the AgentNet skill marketplace (devnet) from scripts/seed-catalog.json.
//
// Mints every skill as a Token-2022 soulbound NFT enrolled in the skills
// collection, then mints the workflows — resolving each workflow's requiredSkills
// (by name) to the skill mint ids produced in this run. Every workflow's required
// skills MUST exist in the catalog; the script verifies that up front and refuses
// to start otherwise.
//
// Resumable: progress (name -> mint id) is written to scripts/seed-progress.json
// after each publish. Re-running skips anything already minted, so a mid-run
// failure (RPC blip, rate limit) just continues where it left off — important,
// since 60 skills + 5 workflows is ~65 transactions.
//
// The deploy wallet is the skills/workflows collection update authority (verified
// via probe-collection-authority.ts), so it serves as payer, creator, AND the
// enrollment minter — one key does everything.
//
// Usage:
//   export SOLANA_RPC_URL="https://api.devnet.solana.com"
//   export PAYER_SECRET="$(cat ~/Desktop/deploy/deploy.json)"     # JSON byte array
//   export AGENTNET_MINTER_SECRET="$(cat ~/Desktop/deploy/deploy.json)"  # same key
//   npx tsx scripts/seed-marketplace.ts
//
// Dry run (validate catalog + print plan, no chain writes):
//   npx tsx scripts/seed-marketplace.ts --dry-run

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { init as initChain } from "../src/core/chain.js";
import { publishSkill } from "../src/nft/skill.js";
import { publishWorkflow } from "../src/nft/workflow.js";
import { checkFormat, checkWorkflowFormat } from "../src/nft/checkFormat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dirname, "seed-catalog.json");
const PROGRESS_PATH = join(__dirname, "seed-progress.json");

interface SkillEntry {
  name: string;
  category: string;
  description: string;
  hashtags: string[];
}
interface WorkflowEntry extends SkillEntry {
  requiredSkills: string[]; // skill NAMES; resolved to mint ids at publish time
  recipe: string[];
}
interface Catalog {
  skills: SkillEntry[];
  workflows: WorkflowEntry[];
}

// name -> minted mint id, persisted so re-runs skip already-minted items.
type Progress = { skills: Record<string, string>; workflows: Record<string, string> };

function loadProgress(): Progress {
  if (existsSync(PROGRESS_PATH)) {
    return JSON.parse(readFileSync(PROGRESS_PATH, "utf8"));
  }
  return { skills: {}, workflows: {} };
}
function saveProgress(p: Progress): void {
  writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2));
}

// Build the SKILL.md body a skill NFT inscribes. The frontmatter satisfies
// checkFormat (kebab name, ≥20-char description, category); the body is the
// human/agent-readable instruction. Seed bodies are short but >50 chars so they
// don't trip the "very short body" info notice.
function skillMd(s: SkillEntry): string {
  const tags = s.hashtags.join(", ");
  return `---
name: ${s.name}
description: ${s.description}
category: ${s.category}
hashtags: [${tags}]
---

# ${s.name}

${s.description}

When applied, this skill guides the agent to ${s.description.charAt(0).toLowerCase()}${s.description.slice(1)} It is a reusable capability published to the AgentNet skill marketplace.
`;
}

// A workflow's SKILL.md needs type: workflow and a requiredSkills array of base58
// mint ids (checkWorkflowFormat enforces both). We pass the resolved mint ids in.
function workflowMd(w: WorkflowEntry, requiredMintIds: string[]): string {
  const tags = w.hashtags.join(", ");
  const steps = w.recipe.map((step, i) => `${i + 1}. ${step}`).join("\n");
  return `---
name: ${w.name}
description: ${w.description}
type: workflow
category: ${w.category}
hashtags: [${tags}]
requiredSkills: [${requiredMintIds.join(", ")}]
---

# ${w.name}

${w.description}

## Recipe

${steps}
`;
}

function loadSigner(envName: string): Keypair {
  const raw = process.env[envName];
  if (!raw) throw new Error(`Set ${envName} to a JSON byte array (solana-keygen format).`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.trim())));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const catalog: Catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

  // ── validate the catalog BEFORE touching the chain ──────────────────────────
  const skillNames = new Set(catalog.skills.map((s) => s.name));
  if (skillNames.size !== catalog.skills.length) {
    throw new Error("Catalog has duplicate skill names.");
  }
  // every workflow's required skills must exist as a catalog skill
  for (const w of catalog.workflows) {
    const missing = w.requiredSkills.filter((n) => !skillNames.has(n));
    if (missing.length) {
      throw new Error(`Workflow "${w.name}" requires skills not in the catalog: ${missing.join(", ")}`);
    }
  }
  // every skill md must pass the on-chain format check (catch typos before minting)
  for (const s of catalog.skills) {
    const r = checkFormat(skillMd(s));
    if (!r.ok) throw new Error(`Skill "${s.name}" fails format check: ${r.errors.map((e) => e.message).join("; ")}`);
  }
  // workflow md is validated per-workflow at publish time (needs real mint ids)

  console.log(`Catalog OK: ${catalog.skills.length} skills, ${catalog.workflows.length} workflows.`);
  console.log(
    `Workflow→skill reuse: ${
      catalog.workflows.flatMap((w) => w.requiredSkills).length
    } required-skill refs across ${
      new Set(catalog.workflows.flatMap((w) => w.requiredSkills)).size
    } distinct skills.`,
  );

  if (dryRun) {
    console.log("\n[dry-run] catalog valid; no chain writes. Workflows:");
    for (const w of catalog.workflows) {
      console.log(`  ${w.name}  ⇐  ${w.requiredSkills.join(", ")}`);
    }
    return;
  }

  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const conn = new Connection(rpc, "confirmed");
  initChain(conn); // codeIn / ensureDbRoot read the chain layer's connection
  const signer = loadSigner("PAYER_SECRET");
  console.log(`\nRPC: ${rpc}\nCreator/payer: ${signer.publicKey.toBase58()}\n`);

  const progress = loadProgress();

  // ── publish skills ──────────────────────────────────────────────────────────
  let i = 0;
  for (const s of catalog.skills) {
    i++;
    if (progress.skills[s.name]) {
      console.log(`[${i}/${catalog.skills.length}] skip ${s.name} (already ${progress.skills[s.name]})`);
      continue;
    }
    try {
      const mint = await publishSkill(conn, signer, {
        name: s.name,
        description: s.description,
        text: skillMd(s),
        category: s.category,
        hashtags: s.hashtags,
        price: 0n,
      });
      progress.skills[s.name] = mint;
      saveProgress(progress);
      console.log(`[${i}/${catalog.skills.length}] minted ${s.name} -> ${mint}`);
    } catch (e) {
      console.error(`[${i}/${catalog.skills.length}] FAILED ${s.name}: ${(e as Error).message}`);
      console.error("Stopping. Re-run to resume from here.");
      process.exit(1);
    }
  }

  // ── publish workflows (resolve requiredSkills names -> minted mint ids) ───────
  let j = 0;
  for (const w of catalog.workflows) {
    j++;
    if (progress.workflows[w.name]) {
      console.log(`[wf ${j}/${catalog.workflows.length}] skip ${w.name} (already ${progress.workflows[w.name]})`);
      continue;
    }
    const requiredMintIds = w.requiredSkills.map((n) => progress.skills[n]);
    if (requiredMintIds.some((id) => !id)) {
      throw new Error(`Workflow "${w.name}" references a skill that wasn't minted — aborting.`);
    }
    const md = workflowMd(w, requiredMintIds);
    const fmt = checkWorkflowFormat(md);
    if (!fmt.ok) {
      throw new Error(`Workflow "${w.name}" md fails format check: ${fmt.errors.map((e) => e.message).join("; ")}`);
    }
    try {
      const mint = await publishWorkflow(conn, signer, {
        name: w.name,
        description: w.description,
        text: md,
        requiredSkills: requiredMintIds,
        category: w.category,
        hashtags: w.hashtags,
        price: 0n,
      });
      progress.workflows[w.name] = mint;
      saveProgress(progress);
      console.log(`[wf ${j}/${catalog.workflows.length}] minted ${w.name} -> ${mint}  (requires ${w.requiredSkills.length} skills)`);
    } catch (e) {
      console.error(`[wf ${j}/${catalog.workflows.length}] FAILED ${w.name}: ${(e as Error).message}`);
      console.error("Stopping. Re-run to resume.");
      process.exit(1);
    }
  }

  console.log(`\nDone. ${Object.keys(progress.skills).length} skills, ${Object.keys(progress.workflows).length} workflows on devnet.`);
  console.log(`Mint ids saved to ${PROGRESS_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
