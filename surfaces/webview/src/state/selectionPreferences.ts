import type { Cli } from "../transport/protocol";

export interface SelectionPreferences {
  cli: Cli;
  modelByCli: Record<Cli, string>;
  effortByCli: Record<Cli, string>;
}

export const DEFAULT_SELECTION_PREFERENCES: SelectionPreferences = {
  cli: "claude",
  modelByCli: { claude: "default", codex: "default", custom: "default" },
  effortByCli: { claude: "default", codex: "default", custom: "default" },
};

const ENGINES: Cli[] = ["claude", "codex", "custom"];
const key = (walletAddress: string | null) => `agentnet.chatSelection.v1:${walletAddress ?? "guest"}`;

export function readSelectionPreferences(walletAddress: string | null): SelectionPreferences {
  const prefs: SelectionPreferences = {
    cli: DEFAULT_SELECTION_PREFERENCES.cli,
    modelByCli: { ...DEFAULT_SELECTION_PREFERENCES.modelByCli },
    effortByCli: { ...DEFAULT_SELECTION_PREFERENCES.effortByCli },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key(walletAddress)) ?? "null");
    if (!saved || typeof saved !== "object") return prefs;
    if (ENGINES.includes(saved.cli)) prefs.cli = saved.cli;
    for (const cli of ENGINES) {
      if (typeof saved.modelByCli?.[cli] === "string" && saved.modelByCli[cli]) prefs.modelByCli[cli] = saved.modelByCli[cli];
      if (typeof saved.effortByCli?.[cli] === "string" && saved.effortByCli[cli]) prefs.effortByCli[cli] = saved.effortByCli[cli];
    }
  } catch {
    // Storage can be disabled or contain an older/broken value; chat remains usable.
  }
  return prefs;
}

export function writeSelectionPreferences(walletAddress: string | null, prefs: SelectionPreferences): void {
  try {
    // Persist only these nonsecret choices. Permission modes always start safely on reload.
    localStorage.setItem(key(walletAddress), JSON.stringify({ cli: prefs.cli, modelByCli: prefs.modelByCli, effortByCli: prefs.effortByCli }));
  } catch {
    // A private/embedded browser may deny storage; the current selections still work.
  }
}
