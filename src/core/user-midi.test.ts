import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMidi, recommendTrack } from "./midi";
import { mapNotes } from "./mapping";
import { buildSchedule, diagnose, TIMING_STANDARD } from "./schedule";

const path = "/Users/tool/auto_music/银河与星斗_爱给网_aigei_com.mid";

describe("用户提供的 MIDI", () => {
  it("解析并映射", () => {
    const buf = readFileSync(path);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    );
    const midi = parseMidi(ab);

    console.log(
      `\n格式 ${midi.format} · division ${midi.division} · ${midi.tracks.length} 轨 · ${midi.duration.toFixed(1)}s`,
    );
    console.log(`速度事件 ${midi.tempoMap.length} 个`);

    for (const t of midi.tracks) {
      const pitches = t.notes.map((n) => n.pitch);
      console.log(
        `  轨${t.index} 「${t.name}」 ${t.notes.length}音 通道集=${[...new Set(t.notes.map((n) => n.channel))].join(",")} 音域=${Math.min(...pitches)}~${Math.max(...pitches)} 鼓=${t.isDrum}`,
      );
    }

    const rec = recommendTrack(midi.tracks);
    console.log(`推荐轨: ${rec}`);

    const track = midi.tracks.find((t) => t.index === rec)!;
    const raw = track.notes.map((n) => ({
      pitch: n.pitch,
      start: n.start,
      end: n.end,
    }));
    const first = Math.min(...raw.map((n) => n.start));
    const trimmed = raw.map((n) => ({
      ...n,
      start: n.start - first,
      end: n.end - first,
    }));

    for (const base of [3, 4, 5]) {
      const m = mapNotes(trimmed, base, false);
      const out = m.notes.filter((n) => !n.inRange).length;
      const evs = buildSchedule(m.notes, TIMING_STANDARD);
      const d = diagnose(evs, TIMING_STANDARD);
      console.log(
        `  基准C${base}: 可演奏 ${m.notes.length - out}/${m.notes.length}  事件 ${evs.length}  诊断 修饰${d.modLeadTooShort}/重触发${d.retriggerTooShort}/按持${d.minHoldTooShort}`,
      );
    }

    const mf = mapNotes(trimmed, 4, true);
    console.log(
      `  折八度 C4: 可演奏 ${mf.notes.filter((n) => n.inRange).length}/${mf.notes.length}`,
    );

    expect(track.notes.length).toBeGreaterThan(0);
  });
});
