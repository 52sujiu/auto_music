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
  off: { onsetMs: 0, releaseMs: 0 },
  light: { onsetMs: 8, releaseMs: 4 },
  natural: { onsetMs: 18, releaseMs: 9 },
} as const;

/**
 * 在物理时间线上加入小幅演奏差异。只延后事件，避免缩短按持、修饰提前量和重触发间隔。
 * 长休止时回收积累的延迟；回收后仍保留至少 200ms 的休止。
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

    if (event.kind === "key") {
      const max = event.down ? profile.onsetMs : profile.releaseMs;
      const sample = random();
      drift += Math.round(Math.min(1, Math.max(0, sample)) * max);
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
