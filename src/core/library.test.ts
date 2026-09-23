import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi, recommendTrack } from "./midi";

const dir = join(process.cwd(), "public/midi");
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".mid"));

describe("曲目库", () => {
    it("至少 20 首", () => expect(files.length).toBeGreaterThanOrEqual(20));

    for (const f of files) {
        it(`解析 ${f}`, () => {
            const buf = readFileSync(join(dir, f));
            const ab = buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength,
            );
            const midi = parseMidi(ab);
            const total = midi.tracks.reduce((s, t) => s + t.notes.length, 0);
            expect(total).toBeGreaterThan(0);
            expect(midi.duration).toBeGreaterThan(0);
            for (const t of midi.tracks) {
                for (const n of t.notes) {
                    expect(n.end).toBeGreaterThanOrEqual(n.start);
                    expect(n.pitch).toBeGreaterThanOrEqual(0);
                    expect(n.pitch).toBeLessThanOrEqual(127);
                }
            }
            const rec = recommendTrack(midi.tracks);
            const recName =
                rec >= 0
                    ? midi.tracks.find((t) => t.index === rec)!.name
                    : "无";
            console.log(
                `  ${f.padEnd(30)} ${String(midi.tracks.length).padStart(2)}轨 ${String(total).padStart(5)}音 ${midi.duration.toFixed(0).padStart(4)}s  推荐:${recName}`,
            );
        });
    }
});
