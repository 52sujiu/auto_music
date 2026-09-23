import {
  buildSchedule,
  toPhysical,
  type InputTiming,
  type ScheduledEvent,
} from "./schedule";
import type { MappedNote } from "./mapping";

export type PhysicalEvent = ScheduledEvent & { atMs: number };
export type HumanizeLevel = "off" | "light" | "natural";

const PROFILES = {
  off: { onsetMs: 0, releaseMs: 0, breathProb: 0, breathMin: 0, breathMax: 0 },
  light: { onsetMs: 8, releaseMs: 4, breathProb: 0.06, breathMin: 8, breathMax: 20 },
  natural: { onsetMs: 18, releaseMs: 9, breathProb: 0.12, breathMin: 15, breathMax: 35 },
} as const;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 三角分布采样，均值 0.5，集中在中间、偶发两端，更像真人起落。均匀分布太机械，固定间隔直方图一眼可辨。 */
function triangular(random: () => number): number {
  return (clamp01(random()) + clamp01(random())) / 2;
}

/**
 * 在物理时间线上加入小幅演奏差异。只延后事件，避免缩短按持、修饰提前量和重触发间隔。
 * 长休止时回收积累的延迟；回收后仍保留至少 200ms 的休止。
 * 防检测思路：打散固定间隔 + 按持抖动 + 乐句处偶发呼吸停顿，让 IOI 直方图呈类人偏态而非机器尖峰。
 * 不承诺绕过任何反作弊或宏检测。
 */
export function humanizePhysical(
  events: readonly PhysicalEvent[],
  level: HumanizeLevel,
  random: () => number = Math.random,
): PhysicalEvent[] {
  if (level === "off") return events.map((event) => ({ ...event }));

  const profile = PROFILES[level];
  let drift = 0;
  let previousBase = 0;
  let previousEvent: PhysicalEvent | null = null;
  const result: PhysicalEvent[] = [];

  for (const event of events) {
    const baseGap = event.atMs - previousBase;
    // 只在音键抬起后的明确休止处回收；长音的按持不能被压短。
    if (previousEvent?.kind === "key" && !previousEvent.down && baseGap > 200)
      drift = Math.max(0, drift - (baseGap - 200));

    // 乐句呼吸：较长休止后的起音偶发多停一小拍，模拟换气/看谱。只增不减。
    if (event.kind === "key" && event.down && baseGap > 500 && profile.breathProb > 0) {
      const roll = clamp01(random());
      if (roll < profile.breathProb) {
        const amt = profile.breathMin + clamp01(random()) * (profile.breathMax - profile.breathMin);
        drift += Math.round(amt);
      }
    }

    if (event.kind === "key") {
      const max = event.down ? profile.onsetMs : profile.releaseMs;
      drift += Math.round(triangular(random) * max);
    }

    result.push({ ...event, atMs: event.atMs + drift });
    previousBase = event.atMs;
    previousEvent = event;
  }

  return result;
}

/** 自动演奏和导出共用同一套物理时序处理。 */
export function preparePhysicalEvents(
  events: readonly ScheduledEvent[],
  speed: number,
  level: HumanizeLevel,
): PhysicalEvent[] {
  return humanizePhysical(toPhysical(events, speed), level);
}

/** 先把音符按速度换到物理时间，再调度，确保高速播放不压短最小输入间隔。 */
export function prepareAutoEvents(
  notes: readonly MappedNote[],
  timing: InputTiming,
  speed: number,
  level: HumanizeLevel,
): PhysicalEvent[] {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const physicalNotes = notes.map((note) => ({
    ...note,
    start: note.start / safeSpeed,
    end: note.end / safeSpeed,
  }));
  return preparePhysicalEvents(buildSchedule(physicalNotes, timing), 1, level);
}
