import React from "react";
import { Text } from "ink";
import { iggy, colors } from "../theme.js";
import { useFrameLoop } from "../hooks/useFrameLoop.js";

export type Mood = keyof typeof iggy;

const moodColor: Partial<Record<Mood, string>> = {
  success: colors.ok,
  error: colors.err,
  tool: colors.iqCyan,
  thinking: colors.iqViolet,
};

// The mascot. Picks the frame set for the mood and animates through it (blink / drift /
// dance). One-shot moods (dance) don't loop. Static when delight is off → first frame.
export function Iggy({ mood = "idle", fps = 3 }: { mood?: Mood; fps?: number }) {
  const frames = iggy[mood] ?? iggy.idle;
  const loop = mood !== "dance";
  const speed = mood === "dance" ? 8 : mood === "thinking" ? 4 : fps;
  const i = useFrameLoop(frames.length, speed, loop);
  return <Text color={moodColor[mood] ?? colors.iqMagenta}>{frames[i] ?? frames[0]}</Text>;
}
