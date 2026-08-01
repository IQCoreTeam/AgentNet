// Shown on an engine's connect screen when the host reports its CLI as not installed:
// sign-in cannot succeed until the binary exists, so show the install command (with a
// copy button) instead of letting the login attempt fail cryptically. Renders nothing
// when the engine is present, so the normal login flow is untouched.

import { useState } from "react";
import { ENGINE_INSTALL_COMMAND } from "@iqlabs-official/agent-sdk/runtime/engineInstall";
import { useStore } from "../state/store";

export function EngineMissingNotice({ cli }: { cli: "claude" | "codex" }) {
  const { state } = useStore();
  const [copied, setCopied] = useState(false);
  if (state.cliReport?.[cli] !== "missing") return null;
  const command = ENGINE_INSTALL_COMMAND[cli];
  return (
    <div className="rounded-xl bg-zinc-900 p-3 ring-1 ring-zinc-800">
      <p className="text-xs text-zinc-400 leading-normal">
        The {cli === "claude" ? "Claude" : "Codex"} CLI is not installed on this device, so
        sign-in will fail. Install it in a terminal first, then come back here:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-an-green">
          {command}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(command).catch(() => {});
            setCopied(true);
          }}
          className="rounded-lg bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-200"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
