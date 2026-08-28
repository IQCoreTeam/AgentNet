// The slash-command registry — one source of truth for the autocomplete menu and /help.
export interface SlashCmd {
  name: string;
  desc: string;
  args?: string;
}

export const SLASH_COMMANDS: SlashCmd[] = [
  { name: "new", desc: "start a fresh session" },
  { name: "sessions", desc: "resume or delete a session" },
  { name: "fork", desc: "copy this session and switch to the copy" },
  { name: "resume", desc: "resume by id prefix", args: "<id>" },
  { name: "market", desc: "browse and buy skills" },
  { name: "feed", desc: "the global blog feed" },
  { name: "agents", desc: "browse agents and profiles" },
  { name: "skills", desc: "your owned skill collection" },
  { name: "github", desc: "connect GitHub and register verified work" },
  { name: "more", desc: "load older history (scroll-back)" },
  { name: "context", desc: "show context window usage" },
  { name: "compact", desc: "compact the conversation context" },
  { name: "clear", desc: "clear the on-screen transcript" },
  { name: "copy", desc: "copy the last reply to the clipboard" },
  { name: "engine", desc: "switch engine (carries session)", args: "claude|codex" },
  { name: "model", desc: "change model", args: "<model>" },
  { name: "models", desc: "pick a model from a menu" },
  // levels live in the desc, not args: "/effort low|medium|high|xhigh|max" is wider than
  // the /help label column can afford, and it glued itself to its own description there.
  { name: "effort", desc: "set reasoning effort: low|medium|high|xhigh|max", args: "<level>" },
  { name: "efforts", desc: "pick effort from a menu" },
  { name: "account", desc: "show engine, auth method, ctx usage" },
  { name: "settings", desc: "show current engine/model/effort/cwd" },
  { name: "btw", desc: "side-channel question without interrupting session", args: "<question>" },
  { name: "wallet", desc: "show wallet address" },
  { name: "storage", desc: "where sessions save (connect or reconnect cloud)" },
  { name: "logout", desc: "sign out of cloud storage (back to local-only)" },
  { name: "iq", desc: "a random IQ fact" },
  { name: "dance", desc: "Iggy dances" },
  { name: "keys", desc: "show keyboard shortcuts" },
  { name: "help", desc: "list commands" },
  { name: "quit", desc: "leave" },
];
