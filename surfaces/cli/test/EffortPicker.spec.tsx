import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffortPicker } from "../src/views/EffortPicker.js";

const load = vi.hoisted(() => vi.fn());
vi.mock("../src/models.js", () => ({ loadModelOptions: load }));
const screens: ReturnType<typeof render>[] = [];
beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue([
    { value: "wide", supportedEfforts: ["low", "high", "ultra"] },
    { value: "limited", supportedEfforts: ["low"] },
  ]);
});
afterEach(() => { for (const screen of screens) screen.unmount(); screens.length = 0; });

describe("CLI effort picker", () => {
  it("highlights the current effort after loading and resets focus when model capabilities shrink", async () => {
    const pick = vi.fn();
    let output = "";
    const stdout = Object.assign(new PassThrough(), { columns: 80, isTTY: false });
    stdout.on("data", chunk => { output += chunk.toString(); });
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn(),
    });
    const element = (model: string) => <EffortPicker cli="claude" model={model} current="ultra" onPick={pick} onClose={() => {}} />;
    const screen = render(element("wide"), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false, exitOnCtrlC: false,
    });
    screens.push(screen);
    await vi.waitFor(() => expect(output).toContain("› ultra"));
    stdin.write("\r");
    await vi.waitFor(() => expect(pick).toHaveBeenLastCalledWith("ultra"));

    pick.mockClear();
    output = "";
    screen.rerender(element("limited"));
    await vi.waitFor(() => expect(output).toContain("› default"));
    stdin.write("\r");
    await vi.waitFor(() => expect(pick).toHaveBeenLastCalledWith(undefined));
  });
});
