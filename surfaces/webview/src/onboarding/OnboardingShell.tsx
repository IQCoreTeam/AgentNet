// Shared frame for the onboarding screens (connect wallet, connect Claude). Centers a
// branded column — the IQLabs mark in brand green, a title/subtitle, and a slot for the
// screen's action card — on the dark surface, so both steps feel like one flow.

import type { ReactNode } from "react";
import { IqLogo } from "./IqLogo";

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
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6">
      <div className="flex flex-col items-center gap-4">
        <IqLogo className="h-12 w-auto" fill="#00E673" />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{title}</h1>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-zinc-400">{subtitle}</p>
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
  const base = "rounded-xl px-4 py-3 text-sm font-medium transition disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-[#00E673] text-black hover:bg-[#00d068]"
      : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800/60";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
