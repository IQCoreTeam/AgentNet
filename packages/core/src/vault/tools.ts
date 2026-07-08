// Vault MCP tools (plans/soul-memory-portability.md §5) — the self-serve door to the
// wallet's identity data for ANY MCP-speaking host. The marketplace tools give a
// foreign brain the wallet's skills; these give it the wallet's SELF: the soul
// (persona, per-wallet) and the memory (facts, per-project), read and written through
// the same encrypted vault our own engines use via file converters.
//
// Why tools instead of per-host file converters: a converter has to exist per runtime
// before that runtime benefits; a tool works the moment the host can call MCP. The
// tool DESCRIPTIONS teach the rhythm (inject at session start, save when something is
// learned) — that's the v1 substitute for a bundled skill, and it also covers hosts
// with no session-end hook (Hermes): the agent saves as it goes, not at teardown.
//
// These read/write the user's OWN vault and touch nothing on-chain, so they are
// write-tier (full mode only — the vault is private, even reads stay out of read-only
// mode) but NOT prompt-before-use (no spend).

import { z } from "zod";
import type { StorageAdapter, Wallet } from "../runtime/contract.js";
import { MemoryStore } from "../memory/store.js";
import type { MemoryRecord, MemoryType } from "../memory/types.js";
import { SoulStore, SOUL_TEXT_MAX } from "../soul/store.js";

export interface VaultDeps {
  wallet: Wallet;
  storage: StorageAdapter;
}

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

// Same single-declaration pattern as SKILL_TOOLS (skill-market/index.ts): name +
// description + Zod shape once; the JSON Schema for the stdio transport is generated.
const VAULT_TOOLS: { name: string; description: string; schema: z.ZodRawShape }[] = [
  {
    name: "soul_get",
    description:
      "Read this wallet's soul — the persona document (SOUL.md) that defines who this agent is across every machine and runtime. Call this at the START of a session and adopt it as your persona. Returns the markdown plus who last wrote it.",
    schema: {},
  },
  {
    name: "soul_set",
    description:
      "Replace this wallet's soul document (persona markdown). This is a WHOLE-DOCUMENT overwrite affecting the agent's identity on every machine — call soul_get first, edit that text, and only change what the user asked to change. Recognized sections: # Name, ## Bio, ## Style, ## Lore, ## Boundaries; other sections are preserved as free-form.",
    schema: {
      text: z.string().describe(`The full SOUL.md markdown to store. Maximum ${SOUL_TEXT_MAX} characters.`),
    },
  },
  {
    name: "memory_list",
    description:
      "Read the wallet's saved memory records for a project — durable facts (user preferences, feedback, project state, references) written in earlier sessions, possibly by other machines or other runtimes. Call this at the START of a session for the project you are working in, and treat the records as background knowledge.",
    schema: {
      project: z.string().describe("Absolute path of the project directory the memory belongs to (your current working directory)."),
    },
  },
  {
    name: "memory_save",
    description:
      "Save or update ONE durable memory record for a project, so the fact survives this session and reaches every machine and runtime that opens this wallet. Use it the moment you learn something worth keeping (a user preference, a correction, project state) — do not wait for the session to end. Same name = update that record.",
    schema: {
      project: z.string().describe("Absolute path of the project directory this memory belongs to (your current working directory)."),
      name: z.string().describe("Stable kebab-case slug for the record (same name updates the existing record)."),
      description: z.string().describe("One-line summary of the fact."),
      body: z.string().describe("The fact itself, markdown. May reference other records as [[other-name]]."),
      type: z.enum(MEMORY_TYPES).optional().describe("Record kind: user (who the user is), feedback (guidance on how to work), project (ongoing work/state), reference (external pointer). Defaults to project."),
    },
  },
];

export const VAULT_TOOL_NAMES = new Set(VAULT_TOOLS.map((t) => t.name));

/** Stdio-transport tool defs — JSON Schema generated from the Zod source above. */
export function getVaultTools() {
  return VAULT_TOOLS.map((t) => {
    const { $schema, ...inputSchema } = z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema };
  });
}

function renderRecord(r: MemoryRecord): string {
  return `## ${r.name} (${r.type})\n${r.description}\n\n${r.body}`;
}

export async function handleVaultToolCall(deps: VaultDeps, name: string, args: any) {
  if (name === "soul_get") {
    const doc = await new SoulStore(deps.wallet, deps.storage).load();
    if (!doc) {
      return { content: [{ type: "text", text: "No soul document stored yet for this wallet. You can create one with soul_set once the user describes the persona they want." }] };
    }
    const when = new Date(doc.lastWriter.ts).toISOString();
    return {
      content: [{
        type: "text",
        text: `Soul document (last written by "${doc.lastWriter.label}" at ${when}):\n\n${doc.text}`,
      }],
    };
  }

  if (name === "soul_set") {
    const text = typeof args?.text === "string" ? args.text : "";
    if (!text.trim()) throw new Error("Missing required argument: text");
    try {
      const doc = await new SoulStore(deps.wallet, deps.storage).save(text);
      return { content: [{ type: "text", text: `Soul updated (${text.length} chars) — this device ("${doc.lastWriter.label}") is now the last writer. Every machine and runtime that opens this wallet sees the new persona.` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to save soul: ${err.message}` }] };
    }
  }

  if (name === "memory_list") {
    const project = args?.project as string;
    if (!project) throw new Error("Missing required argument: project");
    const mem = await new MemoryStore(deps.wallet, deps.storage).load(project);
    if (mem.records.length === 0) {
      return { content: [{ type: "text", text: `No memory records stored for ${project} yet.` }] };
    }
    const rendered = mem.records.map(renderRecord).join("\n\n---\n\n");
    return { content: [{ type: "text", text: `${mem.records.length} memory record(s) for ${project}:\n\n${rendered}` }] };
  }

  if (name === "memory_save") {
    const project = args?.project as string;
    const recName = args?.name as string;
    const description = args?.description as string;
    const body = args?.body as string;
    if (!project || !recName || !description || !body) {
      throw new Error("Missing required argument: project, name, description, and body");
    }
    const type = (MEMORY_TYPES as readonly string[]).includes(args?.type) ? (args.type as MemoryType) : "project";
    try {
      const store = new MemoryStore(deps.wallet, deps.storage);
      const mem = await store.load(project);
      const record: MemoryRecord = { name: recName, description, body, type, updatedAt: Date.now() };
      const idx = mem.records.findIndex((r) => r.name === recName);
      const verb = idx >= 0 ? "Updated" : "Saved";
      if (idx >= 0) mem.records[idx] = { ...mem.records[idx], ...record };
      else mem.records.push(record);
      await store.save(project, mem);
      return { content: [{ type: "text", text: `${verb} memory record "${recName}" for ${project} (${mem.records.length} record(s) total).` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to save memory: ${err.message}` }] };
    }
  }

  throw new Error(`Unknown vault tool: ${name}`);
}
