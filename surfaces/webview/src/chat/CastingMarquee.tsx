import { SkillIcon } from "../icons";

// In-chat casting strip — ported from the vscode webview's flashSkill(): a breathing glow
// bar that names each firing skill/workflow with a verb that ROTATES across firings
// (Casting / Channeling / Wielding / Invoking). One row per active cast, so a workflow and
// the skills it chains stack together; each row is tinted by kind (workflow = amber/gold,
// skill = violet). ChatScreen clears the list on turn end.
type Firing = { name: string; kind: "skill" | "workflow" };

const VERBS = ["Casting", "Channeling", "Wielding", "Invoking"];
// Stable verb per skill name so a row keeps its verb while others join/leave. Module-level
// so the rotation advances across firings (parity with the vscode marquee).
const verbByName = new Map<string, string>();
let pick = 0;
function verbFor(name: string): string {
  let v = verbByName.get(name);
  if (!v) {
    v = VERBS[pick++ % VERBS.length];
    verbByName.set(name, v);
  }
  return v;
}

export function CastingMarquee({ skills }: { skills: Firing[] }) {
  if (!skills.length) return null;
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2">
      {skills.map((s) => {
        const accent = s.kind === "workflow" ? "var(--an-amber)" : "var(--an-violet)";
        const cls = s.kind === "workflow" ? "is-workflow" : "is-skill";
        return (
          <div key={s.name} className={`casting-marquee ${cls} flex items-center gap-2 rounded-xl px-3 py-2`}>
            <SkillIcon className="h-4 w-4 shrink-0" style={{ color: accent }} />
            <span className="text-sm" style={{ color: accent }}>
              <span className="font-semibold">{verbFor(s.name)}</span>{" "}
              <span className="font-mono" style={{ color: "var(--an-fg)" }}>{s.name}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
