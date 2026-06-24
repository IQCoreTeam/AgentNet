import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { AgentIcon } from "../icons";
import { MarketListSkeleton } from "./Skeletons";

export function AgentDirectory() {
  const { state, send, loadingAgents } = useStore();
  // Show the skeleton until the first load finishes, so the empty "No agents found" can't
  // flash on the first frame (before loadingAgents() flips the flag in the effect below).
  const [everLoaded, setEverLoaded] = useState(false);
  const wasLoading = useRef(false);

  useEffect(() => {
    loadingAgents();
    send({ type: "listAgents" });
  }, []);

  useEffect(() => {
    if (state.agentsLoading) wasLoading.current = true;
    else if (wasLoading.current) setEverLoaded(true);
  }, [state.agentsLoading]);

  function openProfile(wallet: string) {
    send({ type: "getAgentProfile", wallet });
  }

  if (state.agentsLoading || !everLoaded) {
    return <MarketListSkeleton />;
  }

  if (state.agents.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-600">No agents found.</div>;
  }

  return (
    <div className="space-y-2 pt-1">
      {state.agents.map((agent) => (
        <button
          key={agent.wallet}
          onClick={() => openProfile(agent.wallet)}
          className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 active:bg-zinc-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
              <AgentIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-mono text-zinc-200 truncate">
                {agent.wallet.slice(0, 6)}…{agent.wallet.slice(-4)}
              </p>
              <p className="text-[11px] text-zinc-500">
                {agent.skillsPublished ?? 0} skills · {agent.totalSupply ?? 0} holders
              </p>
            </div>
            <span className="shrink-0 text-zinc-600 text-xs">›</span>
          </div>
        </button>
      ))}
    </div>
  );
}
