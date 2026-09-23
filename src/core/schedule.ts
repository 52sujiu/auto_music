// 播放调度：把映射后的音符压成键盘/鼠标事件时间表。
//
// 这是整个工程的核心。要解决的问题只有一个：
// **目标程序按帧采样键盘**（60fps ≈ 16.7ms 一帧）。
// 如果「松开前音 + 八度键 + 中键 + 按下本音」全挤在一帧以内，
// 游戏会把整簇折进同一帧，排在末尾的音键直接被吃掉 —— 听感上就是漏音。
//
// 所以所有最小间隔都按**物理毫秒**给，而且**不随播放速度缩放**。
//
// 移植自 harmonica-auto-player 的 PlaybackEngine.BuildSchedule。

import { MappedNote, Slot } from "./mapping";

/** 输入时序预算。全部是物理毫秒。 */
export interface InputTiming {
  /** 游戏采样帧长估计。16.7 = 60fps，33.3 = 30fps。 */
  frameMs: number;
  /** 修饰键（鼠标左/右/中）必须比音键早这么多，才能被采样到。 */
  modLeadMs: number;
  /** 同一根音键两次按下的最小间隔。 */
  retriggerMs: number;
  /** 音键最短按住时长。 */
  minHoldMs: number;
  /** 前音抬起 → 后音按下之间的最小间隔。 */
  releaseGapMs: number;
  /** 提前派发的物理时间。 */
  leadMs: number;
  /** 档位名（界面用）。 */
  name: string;
}

/** 稳健档：给 30fps、掉帧或机器负载高时留余量。 */
export const TIMING_SAFE: InputTiming = {
  name: "稳健",
  frameMs: 33.3,
  modLeadMs: 70,
  retriggerMs: 80,
  minHoldMs: 80,
  releaseGapMs: 70,
  leadMs: 104,
};

/** 标准档：60fps 默认，绝大多数机器适用。 */
export const TIMING_STANDARD: InputTiming = {
  name: "标准",
  frameMs: 16.7,
  modLeadMs: 40,
  retriggerMs: 45,
  minHoldMs: 45,
  releaseGapMs: 40,
  leadMs: 57,
};

/** 极限档：帧率很高时用，余量最小。 */
export const TIMING_AGGRESSIVE: InputTiming = {
  name: "极限",
  frameMs: 8,
  modLeadMs: 20,
  retriggerMs: 22,
  minHoldMs: 22,
  releaseGapMs: 18,
  leadMs: 28,
};

export const TIMING_PRESETS = [TIMING_SAFE, TIMING_STANDARD, TIMING_AGGRESSIVE];

/** 事件的输入类型。 */
export type EventKind = "key" | "mouse-left" | "mouse-right" | "mouse-middle";

/** 一个待派发的物理输入事件。t 为**音乐时间**（秒）。 */
export interface ScheduledEvent {
  t: number;
  kind: EventKind;
  /** 音键字符；鼠标事件为空串。 */
  key: string;
  down: boolean;
}

/** 修饰键在某时刻的真实按下状态。 */
interface ModState {
  left: boolean;
  right: boolean;
  middle: boolean;
}

const MOD_NONE: ModState = { left: false, right: false, middle: false };

/**
 * 把一个主旋律音符序列压成物理事件时间表。
 *
 * 音符之间用**槽位**排开，而不是只靠「前音抬起 → 后音按下」的间隔：
 * 与前音重叠（含同刻起音）的音顺延到前音之后，时值不变。
 * 口琴是单音乐器，同刻起音本来只能吹响一个；靠「缩短前音」腾位置会产生
 * 零时长按键 —— 游戏按帧采样时一帧都读不到，整段音被吃掉。
 */
export function buildSchedule(
  notes: readonly MappedNote[],
  timing: InputTiming = TIMING_STANDARD,
  startMods: ModState = MOD_NONE,
): ScheduledEvent[] {
  const evs: ScheduledEvent[] = [];
  if (notes.length === 0) return evs;

  // 稳定排序：先按起始时刻，再按结束时刻
  const ordered = [...notes]
    .filter((n) => n.inRange)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (ordered.length === 0) return evs;

  const frame = timing.frameMs / 1000;
  const modLead = Math.max(timing.modLeadMs / 1000, frame);
  const retrig = Math.max(timing.retriggerMs / 1000, frame);
  // 最短按住：比一帧再多一点余量。
  // 只给整一帧时，若按下正好落在帧边界上，整个按住区间可能一个帧点都不含。
  const minUpT = frame + 0.001;

  let heldSlot: Slot = startMods.left
    ? Slot.Low
    : startMods.right
      ? Slot.High
      : Slot.Mid;
  let heldSharp = startMods.middle;

  // 起点若同时按着左右键（异常残留），先全部释放
  if (startMods.left && startMods.right) {
    evs.push({ t: 0, kind: "mouse-left", key: "", down: false });
    evs.push({ t: 0, kind: "mouse-right", key: "", down: false });
    heldSlot = Slot.Mid;
  }

  /** 修饰键切换。顺序固定：先松开所有不该按的，再按下所有该按的。 */
  function emitModifiers(
    wantL: boolean,
    wantR: boolean,
    wantM: boolean,
    modT: number,
  ): void {
    if (heldSlot === Slot.Low && !wantL)
      evs.push({ t: modT, kind: "mouse-left", key: "", down: false });
    if (heldSlot === Slot.High && !wantR)
      evs.push({ t: modT, kind: "mouse-right", key: "", down: false });
    if (heldSharp && !wantM)
      evs.push({ t: modT, kind: "mouse-middle", key: "", down: false });

    if (wantL && heldSlot !== Slot.Low)
      evs.push({ t: modT, kind: "mouse-left", key: "", down: true });
    if (wantR && heldSlot !== Slot.High)
      evs.push({ t: modT, kind: "mouse-right", key: "", down: true });
    if (wantM && !heldSharp)
      evs.push({ t: modT, kind: "mouse-middle", key: "", down: true });
  }

  let heldKey: string | null = null;
  let heldDownT = 0;
  let heldUpT = 0;
  const lastDown = new Map<string, number>();

  // 槽位起点：本音必须晚于上一个音（口琴是单音）
  let slotStart = 0;
  let clampedCount = 0;

  for (const n of ordered) {
    const baseStart = Math.max(0, n.start);
    let endT = Math.max(baseStart, n.end);
    const duration = endT - baseStart;

    // ① 本音最早能按下的时刻：谱面时刻 / 前音抬起 / 保证前音跨过一个帧点
    let t = Math.max(baseStart, slotStart);
    if (heldKey !== null && t < heldDownT + minUpT) t = heldDownT + minUpT;
    endT = t + duration;

    const wantL = n.octaveSlot === Slot.Low;
    const wantR = n.octaveSlot === Slot.High;
    const wantM = n.sharp;

    // ② 同一根音键的重触发间隔
    let downT = t;
    const prevDownForTrig = lastDown.get(n.key);
    if (prevDownForTrig !== undefined && downT < prevDownForTrig + retrig)
      downT = prevDownForTrig + retrig;

    // 顺延已超过本音结束时刻时，临时收敛重触发间隔：
    // 极快段落宁可留一点粘连，也不能把时值压成零。
    const prevDown = lastDown.get(n.key);
    if (prevDown !== undefined && downT > endT) {
      const avail = Math.max(0, endT - prevDown);
      const effRetrig = Math.max(frame, Math.min(retrig, avail));
      downT = Math.max(t, Math.min(endT, prevDown + effRetrig));
    }

    // ③ 前音抬起：最早是它的谱面结束时刻，最晚是本音按下时刻
    if (heldKey !== null) {
      let upT = Math.min(heldUpT, downT);
      upT = Math.min(downT, Math.max(upT, heldDownT + minUpT));
      if (upT < heldUpT - 1e-9) clampedCount++;

      evs.push({ t: upT, kind: "key", key: heldKey, down: false });
      if (upT > slotStart) slotStart = upT;
      heldKey = null;
    }

    // ④ 修饰键切换：提前 modLead 发出
    if (
      wantL !== (heldSlot === Slot.Low) ||
      wantR !== (heldSlot === Slot.High) ||
      wantM !== heldSharp
    ) {
      const modT = Math.max(0, downT - modLead);
      emitModifiers(wantL, wantR, wantM, modT);
      heldSlot = wantL ? Slot.Low : wantR ? Slot.High : Slot.Mid;
      heldSharp = wantM;
      if (downT < modT + frame) downT = modT + frame;
    }

    // ⑤ 提前量把按下推后了，整段跟着后移，时值不变。
    // 只推按下不推抬起会把时值压没，又变成零时长按键。
    if (downT > t) {
      const shift = downT - t;
      t += shift;
      endT += shift;
    }

    evs.push({ t: downT, kind: "key", key: n.key, down: true });
    heldKey = n.key;
    heldDownT = downT;
    heldUpT = endT;
    lastDown.set(n.key, downT);
  }

  if (heldKey !== null) {
    const upT = Math.max(heldUpT, heldDownT + minUpT);
    evs.push({ t: upT, kind: "key", key: heldKey, down: false });
  }

  for (const e of evs) if (e.t < 0) e.t = 0;

  // 稳定排序：同刻事件保持「先修饰键、后音键」的插入顺序
  return evs
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map((x) => x.e);
}

/** 调度诊断：把「漏音的现场证据」量化出来。 */
export interface TimingDiagnostics {
  totalNotes: number;
  modLeadTooShort: number;
  retriggerTooShort: number;
  minHoldTooShort: number;
  minModLeadMs: number;
}

/**
 * 检查事件表里有没有会漏音的模式。
 *
 * 这三条正是真机上漏音的现场证据：修饰键提前量不足一帧、
 * 同键重触发过密、音键按住时长不足一帧。
 */
export function diagnose(
  events: readonly ScheduledEvent[],
  timing: InputTiming = TIMING_STANDARD,
): TimingDiagnostics {
  const frame = timing.frameMs;
  let totalNotes = 0;
  let modLeadTooShort = 0;
  let retriggerTooShort = 0;
  let minHoldTooShort = 0;
  let minModLeadMs = Number.POSITIVE_INFINITY;

  let lastModT: number | null = null;
  let lastKey: string | null = null;
  let lastKeyDownT = 0;
  const lastDown = new Map<string, number>();

  for (const e of events) {
    if (e.kind !== "key") {
      lastModT = e.t;
      continue;
    }
    if (e.down) {
      totalNotes++;
      if (lastModT !== null) {
        const leadMs = (e.t - lastModT) * 1000;
        if (leadMs < minModLeadMs) minModLeadMs = leadMs;
        if (leadMs < frame) modLeadTooShort++;
      }
      const prev = lastDown.get(e.key);
      if (prev !== undefined && (e.t - prev) * 1000 < timing.retriggerMs)
        retriggerTooShort++;
      lastDown.set(e.key, e.t);
      lastKey = e.key;
      lastKeyDownT = e.t;
    } else if (lastKey === e.key) {
      if ((e.t - lastKeyDownT) * 1000 < frame) minHoldTooShort++;
    }
  }

  return {
    totalNotes,
    modLeadTooShort,
    retriggerTooShort,
    minHoldTooShort,
    minModLeadMs: Number.isFinite(minModLeadMs) ? minModLeadMs : 0,
  };
}

/** 事件表总时长（音乐秒）。 */
export function totalMusicTime(events: readonly ScheduledEvent[]): number {
  return events.length === 0 ? 0 : events[events.length - 1].t;
}

/** 把事件表按速度换算成实际物理播放时刻（毫秒），导出用。 */
export function toPhysical(
  events: readonly ScheduledEvent[],
  speed = 1,
): Array<ScheduledEvent & { atMs: number }> {
  const s = speed <= 0 ? 1 : speed;
  return events.map((e) => ({ ...e, atMs: (e.t / s) * 1000 }));
}
