// The slash-command registry — one source of truth for the autocomplete menu and /help.
export interface SlashCmd {
  name: string;
  desc: string;
  args?: string;
}

export const SLASH_COMMANDS: SlashCmd[] = [
  { name: "new", desc: "start a fresh session" },
  { name: "sessions", desc: "resume or delete a session" },
  { name: "resume", desc: "resume by id prefix", args: "<id>" },
  { name: "more", desc: "load older history (scroll-back)" },
  { name: "compact", desc: "compact the conversation context" },
  { name: "clear", desc: "clear the on-screen transcript" },
  { name: "copy", desc: "copy the last reply to the clipboard" },
  { name: "engine", desc: "switch engine (carries session)", args: "claude|codex" },
  { name: "model", desc: "change model", args: "<model>" },
  { name: "models", desc: "pick a model from a menu" },
  { name: "effort", desc: "set reasoning effort", args: "low|medium|high|xhigh|max" },
  { name: "efforts", desc: "pick effort from a menu" },
  { name: "account", desc: "show engine, auth method, ctx usage" },
  { name: "settings", desc: "show current engine/model/effort/cwd" },
  { name: "btw", desc: "side-channel question without interrupting session", args: "<question>" },
  { name: "wallet", desc: "show wallet address" },
  { name: "storage", desc: "show where sessions save" },
  { name: "iq", desc: "a random IQ fact" },
  { name: "dance", desc: "Iggy dances" },
  { name: "help", desc: "list commands" },
  { name: "quit", desc: "leave" },
];
