import { execFile as execFileCb } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { SkillCard } from "../../chat/marketMessages.js";
import type { PluginEngine } from "../../core/types.js";

const execFile = promisify(execFileCb);

type InstallResult = { ok: boolean; error?: string };

function fail(error: string): InstallResult {
  return { ok: false, error };
}

function cleanName(v: string | undefined | null): string | null {
  const s = v?.trim();
  return s || null;
}

function commandError(e: unknown): string {
  if (e instanceof Error) {
    const withStreams = e as Error & { stderr?: string; stdout?: string };
    return cleanName(withStreams.stderr) ?? cleanName(withStreams.stdout) ?? e.message;
  }
  return String(e);
}

async function run(command: string, args: string[]): Promise<void> {
  await execFile(command, args, { maxBuffer: 1024 * 1024 });
}

async function codexMarketplaceName(pathOrFile: string): Promise<string> {
  const info = await stat(pathOrFile);
  const marketplaceFile = info.isDirectory() ? join(pathOrFile, "marketplace.json") : pathOrFile;
  try {
    const parsed = JSON.parse(await readFile(marketplaceFile, "utf8")) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
  } catch {
    // Fall back below. The CLI will still validate the marketplace during add/install.
  }
  return basename(info.isDirectory() ? pathOrFile : dirname(pathOrFile));
}

export async function installPluginFromCard(card: SkillCard, engine: PluginEngine): Promise<InstallResult> {
  if (card.type !== "plugin") return fail("Only plugin marketplace items can be installed as plugins.");
  const engines = card.engines?.map((e) => e.toLowerCase()) ?? [];
  if (engines.length > 0 && !engines.includes(engine)) {
    return fail(`Plugin does not declare ${engine} support. Declared engines: ${engines.join(", ")}`);
  }
  const manifest = card.pluginManifest;
  if (!manifest) {
    return fail("Plugin NFT is missing pluginManifest install metadata.");
  }

  if (engine === "codex") {
    const codex = manifest.codex;
    const pluginName = cleanName(codex?.pluginName) ?? cleanName(manifest.id) ?? cleanName(card.name);
    if (!pluginName) return fail("Codex install needs pluginManifest.codex.pluginName.");

    let marketplaceName = cleanName(codex?.marketplaceName as string | undefined)
      ?? cleanName(codex?.remoteMarketplaceName);
    const marketplacePath = cleanName(codex?.marketplacePath);
    try {
      if (!marketplaceName && marketplacePath) {
        await run("codex", ["plugin", "marketplace", "add", marketplacePath, "--json"]);
        marketplaceName = await codexMarketplaceName(marketplacePath);
      }
      if (!marketplaceName) {
        return fail("Codex install needs pluginManifest.codex.marketplaceName, remoteMarketplaceName, or marketplacePath.");
      }
      await run("codex", ["plugin", "add", pluginName, "--marketplace", marketplaceName, "--json"]);
      return { ok: true };
    } catch (e) {
      return fail(`Codex plugin install failed: ${commandError(e)}`);
    }
  }

  const claude = manifest.claude;
  const marketplaceName = cleanName(claude?.marketplaceName);
  const pluginName = cleanName(claude?.pluginName) ?? cleanName(manifest.id) ?? cleanName(card.name);
  if (!marketplaceName || !pluginName) {
    return fail("Claude install needs pluginManifest.claude.marketplaceName and a plugin name.");
  }
  try {
    if (claude?.source?.source === "github" && cleanName(claude.source.repo)) {
      const source = claude.source.ref ? `${claude.source.repo}@${claude.source.ref}` : claude.source.repo;
      await run("claude", ["plugin", "marketplace", "add", source]);
    }
    await run("claude", ["plugin", "install", `${pluginName}@${marketplaceName}`, "--scope", "user"]);
    return { ok: true };
  } catch (e) {
    return fail(`Claude plugin install failed: ${commandError(e)}`);
  }
}
