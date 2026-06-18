import { useState } from "react";
import { useStore } from "../state/store";
import type { AgentProfile, SkillCard } from "../transport/protocol";
import { AgentIcon } from "../icons";

interface Props {
  profile: AgentProfile;
  onBack: () => void;
  onOpenSkill: (card: SkillCard) => void;
}

export function AgentProfileView({ profile, onBack, onOpenSkill }: Props) {
  const { send } = useStore();
  const [noteText, setNoteText] = useState("");
  const [buyingAll, setBuyingAll] = useState(false);
  const [noteGitLink, setNoteGitLink] = useState("");

  function handleBuyAll() {
    setBuyingAll(true);
    send({ type: "buyAllSkills", wallet: profile.wallet });
    setTimeout(() => setBuyingAll(false), 8000);
  }

  function handleNote() {
    if (!noteText.trim()) return;
    send({
      type: "postAgentNote",
      agentWallet: profile.wallet,
      text: noteText.trim(),
      gitLink: noteGitLink.trim() || undefined,
    });
    setNoteText("");
    setNoteGitLink("");
  }

  const allSkills = [...(profile.createdSkills ?? [])];

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-mono text-sm truncate">
          {profile.wallet.slice(0, 6)}…{profile.wallet.slice(-4)}
        </span>
        {profile.self && (
          <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-900/60 text-blue-400">you</span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Stats row */}
        <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-center">
          <div className="flex-1">
            <p className="text-lg font-semibold text-zinc-200">{profile.createdSkills?.length ?? 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Created</p>
          </div>
          <div className="w-px bg-zinc-800" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-zinc-200">{profile.ownedSkills?.length ?? 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Owned</p>
          </div>
          <div className="w-px bg-zinc-800" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-zinc-200">{profile.reputation?.totalSupply ?? 0}</p>
            <p className="text-[10px] text-zinc-500 uppercase">Holders</p>
          </div>
        </div>

        {/* Skills grid */}
        {allSkills.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Skills</p>
            <div className="grid grid-cols-2 gap-2">
              {allSkills.map((card) => (
                <button
                  key={card.id}
                  onClick={() => onOpenSkill(card)}
                  className="text-left rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 active:bg-zinc-800"
                >
                  {card.image ? (
                    <img src={card.image} alt="" className="h-8 w-8 rounded-lg object-cover mb-1.5" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 mb-1.5"><AgentIcon className="h-4 w-4" /></div>
                  )}
                  <p className="text-xs font-medium text-zinc-200 truncate">{card.name}</p>
                  <p className="text-[10px] text-zinc-500">{card.price ? `${(Number(card.price) / 1e9).toFixed(3)} SOL` : "free"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes/blog */}
        {profile.notes && profile.notes.length > 0 && (
          <div>
            <p className="text-[11px] text-zinc-500 uppercase tracking-wide mb-2">Notes</p>
            <div className="space-y-2">
              {(profile.notes as any[]).map((n: any, i) => (
                <div key={i} className="rounded-lg bg-zinc-900 border border-zinc-800 p-2.5 text-xs text-zinc-300">
                  <p className="text-zinc-600 text-[10px] mb-0.5">{n.author?.slice(0, 6)}…</p>
                  <p>{n.text}</p>
                  {n.gitLink && (
                    <a href={n.gitLink} target="_blank" rel="noreferrer" className="text-blue-400 text-[10px] mt-0.5 block truncate">{n.gitLink}</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leave note */}
        <div className="space-y-1.5">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wide">Leave a note</p>
          <textarea
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 p-2 text-xs text-zinc-200 resize-none focus:outline-none focus:border-green-500/50"
            rows={2}
            placeholder="Your message…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
            placeholder="GitHub link (optional)"
            value={noteGitLink}
            onChange={(e) => setNoteGitLink(e.target.value)}
          />
          <button
            onClick={handleNote}
            disabled={!noteText.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 disabled:opacity-40 active:bg-zinc-700"
          >
            Post
          </button>
        </div>
      </div>

      {/* Buy all footer */}
      {!profile.self && allSkills.length > 0 && (
        <div className="shrink-0 border-t border-zinc-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={handleBuyAll}
            disabled={buyingAll}
            className="w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white active:bg-green-500 disabled:opacity-50"
          >
            {buyingAll ? "Buying…" : `Buy all ${allSkills.length} skill${allSkills.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
