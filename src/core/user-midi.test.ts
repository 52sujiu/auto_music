import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi, recommendTrack } from "./midi";
import { mapNotes } from "./mapping";
import { buildSchedule, TIMING_STANDARD } from "./schedule";

describe("内置 MIDI 播放流程", () => {
  it("解析、映射并生成键盘事件", () => {
    const buf = readFileSync(join(process.cwd(), "public", "midi", "示例1-小星星.mid"));
    const midi = parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const track = midi.tracks.find((item) => item.index === recommendTrack(midi.tracks));

    expect(track).toBeDefined();
    const mapped = mapNotes(track!.notes, 4, true);
    const events = buildSchedule(mapped.notes, TIMING_STANDARD);

    expect(mapped.notes.length).toBeGreaterThan(0);
    expect(mapped.notes.every((note) => note.inRange)).toBe(true);
    expect(events.some((event) => event.kind === "key" && event.down)).toBe(true);
  });
});
