import agentnetWordmark from "../assets/agentnet.png";

// The single boot splash: the wordmark over a soft brand halo + "Starting up...". Shared by
// the connecting phase and the (instant) engine auto-route so the user sees one continuous
// screen instead of two different starting-up screens in a row.
export function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <div className="relative flex items-center justify-center">
        {/* soft brand halo behind the mark - quiet depth, not a glow gimmick */}
        <div className="absolute h-16 w-52 rounded-full blur-2xl" style={{ background: "var(--an-green-dim)" }} />
        <img src={agentnetWordmark} alt="AgentNet" className="relative h-11 w-auto max-w-[80%]" />
      </div>
      <span className="text-sm" style={{ color: "var(--an-fg-mute)" }}>Starting up...</span>
    </div>
  );
}
