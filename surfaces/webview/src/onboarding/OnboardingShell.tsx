// Shared frame for the onboarding screens (connect wallet, connect Claude). Centers a
// branded column — the IQLabs mark in brand green, a title/subtitle, and a slot for the
// screen's action card — on the dark surface, so both steps feel like one flow.

import type { ReactNode } from "react";
import agentnetWordmark from "../assets/agentnet.png";

export function OnboardingShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-7 overflow-y-auto px-6"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "calc(max(1.5rem, env(safe-area-inset-bottom)) + var(--keyboard-inset-bottom, 0px))",
      }}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="relative flex items-center justify-center">
          {/* soft brand halo behind the mark — quiet depth, not a glow gimmick */}
          <div
            className="absolute h-16 w-52 rounded-full blur-2xl"
            style={{ background: "var(--an-green-dim)" }}
          />
          {/* Agentnet wordmark (wide single-line lockup) */}
          <img src={agentnetWordmark} alt="AgentNet" className="relative h-11 w-auto max-w-[80%]" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--an-fg)" }}>{title}</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{subtitle}</p>
        </div>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2.5">{children}</div>
    </div>
  );
}

// Shared button style for onboarding actions: filled = primary (brand green), outline =
// secondary. Keeps the two screens visually consistent.
export function OnboardingButton({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" }) {
  return <button className={`${variant === "primary" ? "an-btn" : "an-btn an-btn-ghost"} ${className}`} {...props} />;
}
