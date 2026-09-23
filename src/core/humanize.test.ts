import { describe, expect, it } from "vitest";
import { exportSchedule } from "./export";
import { humanizePhysical, prepareAutoEvents, type PhysicalEvent } from "./humanize";
import { buildSchedule, TIMING_STANDARD } from "./schedule";
import { mapNotes } from "./mapping";

describe("模拟演奏时间线", () => {
  it("连续动作只延后，不缩短音键按持和修饰提前量", () => {
    const input: PhysicalEvent[] = [
      { atMs: 0, t: 0, kind: "mouse-left", key: "", down: true },
      { atMs: 45, t: 0.045, kind: "key", key: "Z", down: true },
      { atMs: 130, t: 0.13, kind: "key", key: "Z", down: false },
      { atMs: 175, t: 0.175, kind: "key", key: "X", down: true },
      { atMs: 260, t: 0.26, kind: "key", key: "X", down: false },
    ];
    const output = humanizePhysical(input, "natural", () => 1);
    for (let i = 1; i < input.length; i++) {
      expect(output[i].atMs - output[i - 1].atMs).toBeGreaterThanOrEqual(
        input[i].atMs - input[i - 1].atMs,
      );
    }
    expect(output[1].atMs).toBe(63);
    expect(output[2].atMs - output[1].atMs).toBe(94);
  });

  it("长休止回收累计偏移，仍保留至少 200ms", () => {
    const input: PhysicalEvent[] = [
      { atMs: 0, t: 0, kind: "key", key: "Z", down: true },
      { atMs: 100, t: 0.1, kind: "key", key: "Z", down: false },
      { atMs: 600, t: 0.6, kind: "key", key: "X", down: true },
    ];
    const output = humanizePhysical(input, "natural", () => 1);
    expect(output[2].atMs - output[1].atMs).toBeGreaterThanOrEqual(200);
    expect(output[2].atMs).toBe(618);
    expect(humanizePhysical(input, "off")).toEqual(input);
  });

  it("长音按持不因偏移回收而缩短", () => {
    const input: PhysicalEvent[] = [
      { atMs: 0, t: 0, kind: "key", key: "Z", down: true },
      { atMs: 500, t: 0.5, kind: "key", key: "Z", down: false },
    ];
    const output = humanizePhysical(input, "natural", () => 1);
    expect(output[1].atMs - output[0].atMs).toBe(509);
  });

  it("两种导出格式都应用扰动，且保留全部按键事件", () => {
    const notes = mapNotes([{ pitch: 60, start: 0, end: 0.5 }], 4).notes;
    const events = buildSchedule(notes, TIMING_STANDARD);
    const original = exportSchedule(events, "csv", "测试", 1, "off");
    const humanized = exportSchedule(events, "csv", "测试", 1, "natural");
    const lua = exportSchedule(events, "ghub", "测试", 1, "natural");
    expect(humanized).toContain("Z");
    expect(humanized.split("\n").length).toBe(original.split("\n").length);
    expect(lua).toContain('PressKey("z")');
    expect(lua).toContain('ReleaseKey("z")');
    expect(lua).toContain("模拟演奏：自然");
  });

  it("自动演奏高速模式仍保留物理最短按持", () => {
    const notes = mapNotes([{ pitch: 60, start: 0, end: 0.02 }], 4).notes;
    const physical = prepareAutoEvents(notes, TIMING_STANDARD, 3, "off");
    const down = physical.find((event) => event.kind === "key" && event.down)!;
    const up = physical.find((event) => event.kind === "key" && !event.down)!;
    expect(up.atMs - down.atMs).toBeGreaterThanOrEqual(TIMING_STANDARD.frameMs + 1 - 1e-6);
  });
});
