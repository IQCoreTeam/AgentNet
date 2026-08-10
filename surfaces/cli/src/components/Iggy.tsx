import React from "react";
import { Text } from "ink";
import { iggy, colors } from "../theme.js";
import { displayWidth } from "../format.js";
import { useFrameLoop } from "../hooks/useFrameLoop.js";

export type Mood = keyof typeof iggy;

const moodColor: Partial<Record<Mood, string>> = {
  success: colors.ok,
  error: colors.err,
  tool: colors.iqCyan,
  thinking: colors.iqViolet,
};

// Iggy lives INSIDE the status band, which must stay exactly one row (see StatusLine).
// Its frames are not all the same width ("◕‿◕" is 3 cells, "-‿- zzz" is 7, the dance
// frames more), so an un-padded mascot changes the band's content width on every
// animation tick — enough to make the band wrap to two rows and back on a narrow
// terminal, which in turn resizes the fixed-height frame and clips the composer in and
// out. Pad every frame to one global width so the mascot animates in place, never in size.
export const IGGY_W = Math.max(
  ...Object.values(iggy).flatMap((frames) => frames.map((f) => displayWidth(f))),
);

const pad = (frame: string): string => frame + " ".repeat(Math.max(0, IGGY_W - displayWidth(frame)));

// The mascot. Picks the frame set for the mood and animates through it (blink / drift /
// dance). One-shot moods (dance) don't loop. Static when delight is off → first frame.
export function Iggy({ mood = "idle", fps = 3 }: { mood?: Mood; fps?: number }) {
  const frames = iggy[mood] ?? iggy.idle;
  const loop = mood !== "dance";
  const speed = mood === "dance" ? 8 : mood === "thinking" ? 4 : fps;
  const i = useFrameLoop(frames.length, speed, loop);
  return <Text color={moodColor[mood] ?? colors.iqMagenta}>{pad(frames[i] ?? frames[0])}</Text>;
}
