import { useEffect, useState } from "react";
import { SkillIcon } from "../icons";

// In-chat casting marquee — ported from the vscode webview's flashSkill(): a green,
// breathing glow bar that names the firing skill with a verb that ROTATES across
// firings (Casting / Channeling / Wielding / Invoking). Shown above the composer while
// state.firingSkill is set; ChatScreen clears it on turn end.
const VERBS = ["Casting", "Channeling", "Wielding", "Invoking"];
let pick = 0; // module-level so the verb advances on each new firing, like vscode

export function CastingMarquee({ skill }: { skill: string | null }) {
  const [verb, setVerb] = useState(VERBS[0]);

  // Advance the verb each time a NEW skill starts firing (not on every render).
  useEffect(() => {
    if (skill) setVerb(VERBS[pick++ % VERBS.length]);
  }, [skill]);

  if (!skill) return null;
  return (
    <div className="px-3 pt-2">
      <div className="casting-marquee flex items-center gap-2 rounded-xl px-3 py-2">
        <SkillIcon className="h-4 w-4 shrink-0" style={{ color: "var(--an-green)" }} />
        <span className="text-sm" style={{ color: "var(--an-green)" }}>
          <span className="font-semibold">{verb}</span>{" "}
          <span className="font-mono" style={{ color: "var(--an-fg)" }}>{skill}</span>
        </span>
      </div>
    </div>
  );
}
