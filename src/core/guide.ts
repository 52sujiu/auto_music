// 引导窗的状态：把事件表变成「下落音符」。
//
// 主窗算好事件表后，通过 localStorage + storage 事件同步给引导窗 ——
// 两个窗口同源，这是最省事的一条通道，不需要 IPC 往返。

import type { ScheduledEvent } from "./schedule";
import type { MappedNote } from "./mapping";
import { Slot } from "./mapping";

export interface GuideState {
    /** 曲名。 */
    songName: string;
    /** 要下落的音符（只含音键按下，不含抬起）。 */
    notes: GuideNote[];
    /** 全曲时长（秒，音乐时间）。 */
    duration: number;
    /** 基准八度。 */
    baseOctave: number;
}

export interface GuideNote {
    /** 该音按下的音乐时刻（秒）。 */
    t: number;
    /** 时长（秒），用于画长度。 */
    dur: number;
    /** 键位字符。 */
    key: string;
    /** 简谱音名，显示用。 */
    label: string;
    /** 是否要按中键。 */
    sharp: boolean;
    /** 八度档位，决定颜色。 */
    slot: Slot;
}

export const GUIDE_KEY = "auto-music:guide";

/** 从事件表 + 音符表构造引导数据。 */
export function buildGuideState(
    events: readonly ScheduledEvent[],
    notes: readonly MappedNote[],
    songName: string,
    baseOctave: number,
    jianpuOf: (pitch: number, base: number) => string,
): GuideState {
    // 事件表里 key down/up 分开；按音键配对回音符，取时长
    const pressed = new Map<string, { t: number; note?: MappedNote }>();
    const out: GuideNote[] = [];
    const ordered = notes.filter((note) => note.inRange)
        .sort((a, b) => a.start - b.start || a.end - b.end);
    let nextNote = 0;

    for (const e of events) {
        if (e.kind !== "key") continue;
        if (e.down) {
            pressed.set(e.key, { t: e.t, note: ordered[nextNote++] });
        } else {
            const pair = pressed.get(e.key);
            if (!pair) continue;
            pressed.delete(e.key);
            const n = pair.note;
            out.push({
                t: pair.t,
                dur: Math.max(0.05, e.t - pair.t),
                key: e.key,
                label: n ? jianpuOf(n.pitch, baseOctave) : "",
                sharp: n?.sharp ?? false,
                slot: n?.octaveSlot ?? Slot.Mid,
            });
        }
    }

    const duration = events.length ? events[events.length - 1].t : 0;
    return {
        songName,
        notes: out.sort((a, b) => a.t - b.t),
        duration,
        baseOctave,
    };
}

/** 音符颜色：跟卷帘保持一致。 */
export function guideColor(n: GuideNote): string {
    if (n.sharp) return "#a371f7";
    if (n.slot === Slot.Low) return "#1f6feb";
    if (n.slot === Slot.High) return "#3fb950";
    return "#2f81f7";
}

/** 键名显示：鼠标修饰 + 音键。 */
export function keyLabel(n: GuideNote): string {
    const base = n.key === "," ? "，" : n.key;
    if (n.sharp) return `中键+${base}`;
    if (n.slot === Slot.Low) return `左键+${base}`;
    if (n.slot === Slot.High) return `右键+${base}`;
    return base;
}

/** 把状态写进 localStorage（主窗用）。 */
export function publishGuide(state: GuideState): void {
    localStorage.setItem(GUIDE_KEY, JSON.stringify(state));
}

/** 读状态（引导窗用）。 */
export function readGuide(): GuideState | null {
    const raw = localStorage.getItem(GUIDE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as GuideState;
    } catch {
        return null;
    }
}
