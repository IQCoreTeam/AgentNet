import { useEffect } from "react";
import { useStore } from "../state/store";

export function AgentDirectory() {
  const { state, send, loadingAgents } = useStore();

  useEffect(() => {
    loadingAgents();
    send({ type: "listAgents" });
  }, []);

  function openProfile(wallet: string) {
    send({ type: "getAgentProfile", wallet });
  }

  if (state.agentsLoading) {
    return <div className="py-12 text-center text-sm text-zinc-600">Loading agents…</div>;
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
            <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-sm shrink-0">
              🤖
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
