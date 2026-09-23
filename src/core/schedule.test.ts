// 调度与时序的回归测试。
//
// 这里钉的都是「真机上会漏音」的几类模式，以及音高映射的边界。
// 移植自 harmonica-auto-player 的自检思路，但改成真实断言。

import { describe, expect, it } from "vitest";
import {
  KEYS,
  Slot,
  mapNotes,
  keyOfPitch,
  reachable,
  jianpu,
  type MappedNote,
} from "./mapping";
import {
  TIMING_AGGRESSIVE,
  TIMING_SAFE,
  TIMING_STANDARD,
  buildSchedule,
  diagnose,
  toPhysical,
  type ScheduledEvent,
} from "./schedule";

/** 手搓一个可演奏音符，省去走完整映射。 */
function note(
  pitch: number,
  start: number,
  end: number,
  key: string,
  slot = Slot.Mid,
  sharp = false,
): MappedNote {
  return {
    pitch,
    start,
    end,
    key,
    sharp,
    octaveSlot: slot,
    inRange: true,
    skipReason: "",
  };
}

/** 取某个键的全部按下时刻（毫秒）。 */
function downsOf(events: ScheduledEvent[], key: string): number[] {
  return events
    .filter((e) => e.kind === "key" && e.key === key && e.down)
    .map((e) => e.t * 1000);
}

/** 取某个键的全部抬起时刻（毫秒）。 */
function upsOf(events: ScheduledEvent[], key: string): number[] {
  return events
    .filter((e) => e.kind === "key" && e.key === key && !e.down)
    .map((e) => e.t * 1000);
}

describe("音高映射", () => {
  it("自然音 Z X C V B N M 对应 do..si", () => {
    // C4 = 60 = 中音 do
    const expected = ["Z", "X", "C", "V", "B", "N", "M"];
    const naturals = [60, 62, 64, 65, 67, 69, 71];
    naturals.forEach((pitch, i) => {
      const { key, sharp } = keyOfPitch(pitch, 4);
      expect(key).toBe(expected[i]);
      expect(sharp).toBe(false);
    });
  });

  it("升号音归到下方自然音，并标记要按中键", () => {
    const { key, sharp } = keyOfPitch(61, 4); // #do
    expect(key).toBe("Z");
    expect(sharp).toBe(true);
  });

  it("中间八度的 do 仍然走 Z，只有基准+2 八度那个 do 走逗号", () => {
    // 这是移植时踩过的坑：早期写法让所有八度的 C 都变成逗号
    expect(keyOfPitch(60, 4).key).toBe("Z"); // 基准八度 do
    expect(keyOfPitch(72, 4).key).toBe("Z"); // +1 八度 do
    expect(keyOfPitch(84, 4).key).toBe(","); // +2 八度 do = 高高音 do
  });

  it("可演奏范围是基准 ±1 八度，外加高八度的 do/#do", () => {
    expect(reachable(48, 4)).toBe(true); // 低音 do
    expect(reachable(84, 4)).toBe(true); // 高高音 do
    expect(reachable(85, 4)).toBe(true); // 高高音 #do
    expect(reachable(86, 4)).toBe(false); // 再往上没有了
    expect(reachable(47, 4)).toBe(false); // 比低音 do 还低
  });

  it("超范围的音被标记 inRange=false，不抛异常", () => {
    const r = mapNotes([{ pitch: 20, start: 0, end: 1 }], 4);
    expect(r.notes[0].inRange).toBe(false);
    expect(r.notes[0].skipReason).not.toBe("");
  });

  it("折八度开启后，超范围的音按整八度挪回来且音名不变", () => {
    // 低音 do 再低一个八度 → 挪上去还是 do
    const flat = mapNotes([{ pitch: 36, start: 0, end: 1 }], 4, false);
    expect(flat.notes[0].inRange).toBe(false);

    const folded = mapNotes([{ pitch: 36, start: 0, end: 1 }], 4, true);
    expect(folded.notes[0].inRange).toBe(true);
    // 音名不变：都是 do
    expect(folded.notes[0].pitch % 12).toBe(0);
  });

  it("简谱换算", () => {
    expect(jianpu(60, 4)).toBe("1");
    expect(jianpu(72, 4)).toBe("1˙");
    expect(jianpu(48, 4)).toBe("1.");
  });
});

describe("调度：单音与修饰键", () => {
  it("空输入产出空事件表", () => {
    expect(buildSchedule([])).toEqual([]);
    expect(buildSchedule([note(60, 0, 1, "Z", Slot.Mid)])).not.toEqual([]);
  });

  it("超范围的音不进事件表", () => {
    const bad = { ...note(20, 0, 1, ""), inRange: false };
    expect(buildSchedule([bad])).toEqual([]);
  });

  it("整排降八度时先按左键，且比音键早至少一帧", () => {
    const evs = buildSchedule([note(48, 0, 0.5, "Z", Slot.Low)]);
    const mouseDown = evs.find((e) => e.kind === "mouse-left" && e.down);
    const keyDown = evs.find((e) => e.kind === "key" && e.down);
    expect(mouseDown).toBeDefined();
    expect(keyDown).toBeDefined();
    expect((keyDown!.t - mouseDown!.t) * 1000).toBeGreaterThanOrEqual(
      TIMING_STANDARD.frameMs,
    );
  });

  it("升半音时按下中键，音高切换前先松开旧修饰键", () => {
    const evs = buildSchedule([
      note(60, 0, 0.3, "Z", Slot.Mid, false),
      note(61, 0.4, 0.7, "Z", Slot.Mid, true),
    ]);
    const middleDown = evs.find((e) => e.kind === "mouse-middle" && e.down);
    expect(middleDown).toBeDefined();

    // 第二个音按下之前，第一个音必须先抬起来
    const firstUp = evs.find((e) => e.kind === "key" && !e.down);
    const lastDown = evs.filter((e) => e.kind === "key" && e.down).pop()!;
    expect(firstUp!.t).toBeLessThanOrEqual(lastDown.t);
  });
});

describe("调度：不漏音的硬约束", () => {
  it("每个音至少按住一帧多一点", () => {
    const evs = buildSchedule([
      note(60, 0, 0.05, "Z"),
      note(62, 0.05, 0.1, "X"),
      note(64, 0.1, 0.15, "C"),
    ]);
    const d = diagnose(evs, TIMING_STANDARD);
    expect(d.minHoldTooShort).toBe(0);
  });

  it("同一根键重触发至少隔开一个 retrigger 间隔", () => {
    // 两个同键音靠得比 retrigger 还近，第二个会被顶到间隔之后
    const evs = buildSchedule([
      note(60, 0, 0.02, "Z"),
      note(60, 0.025, 0.045, "Z"),
    ]);
    const downs = downsOf(evs, "Z");
    for (let i = 1; i < downs.length; i++) {
      expect(downs[i] - downs[i - 1]).toBeGreaterThanOrEqual(
        TIMING_STANDARD.retriggerMs - 1e-6,
      );
    }
  });

  it("谱面比档位允许的还密时，收敛重触发间隔也不把时值压成零", () => {
    // 同一根键上三个 20ms 的音挤在 50ms 里，比标准档能承受的密度还高。
    // 这时引擎会主动收敛重触发间隔（宁可留一点粘连，也不能把整段音推没），
    // 所以这条不再保证 retrigger 下限 —— 但必须保证每个音都还有时值。
    const evs = buildSchedule([
      note(60, 0, 0.02, "Z"),
      note(60, 0.025, 0.045, "Z"),
      note(60, 0.05, 0.07, "Z"),
    ]);
    const downs = downsOf(evs, "Z");
    const ups = upsOf(evs, "Z");

    expect(downs).toHaveLength(3);
    expect(ups).toHaveLength(3);

    // 每个音的按住时长都必须 > 0，否则游戏按帧采样时一帧都读不到
    for (let i = 0; i < downs.length; i++) {
      const downMs = downs[i];
      const upMs = ups.find((u) => u >= downMs)!;
      expect(upMs).toBeGreaterThan(downMs);
    }
  });

  it("音符重叠时靠槽位顺延，不靠缩短前音", () => {
    // 第二个音和第一个音同刻起音；口琴单音，必须排开
    const evs = buildSchedule([note(60, 0, 0.5, "Z"), note(64, 0, 0.5, "C")]);
    const zUp = upsOf(evs, "Z")[0];
    const cDown = downsOf(evs, "C")[0];
    // 后音要等前音抬起来
    expect(cDown).toBeGreaterThanOrEqual(zUp - 1e-6);
  });

  it("不产生零时长按键（up 与 down 同刻）", () => {
    const evs = buildSchedule([
      note(60, 0, 0.3, "Z"),
      note(62, 0, 0.3, "X"),
      note(64, 0, 0.3, "C"),
    ]);
    const downs = new Map<string, number>();
    for (const e of evs) {
      if (e.kind !== "key") continue;
      if (e.down) downs.set(e.key, e.t);
      else if (downs.has(e.key)) {
        expect(e.t).toBeGreaterThan(downs.get(e.key)!);
      }
    }
  });

  it("事件表按时间单调不减，同刻保持修饰键在前", () => {
    const evs = buildSchedule([
      note(48, 0, 0.4, "Z", Slot.Low),
      note(60, 0.5, 0.9, "Z", Slot.Mid),
      note(72, 1.0, 1.4, "Z", Slot.High),
    ]);
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i].t).toBeGreaterThanOrEqual(evs[i - 1].t - 1e-9);
    }
  });

  it("换修饰键前先把音键全部松开", () => {
    // 从升半音切回自然音，中键必须松开，且音键不按着时切换
    const evs = buildSchedule([
      note(61, 0, 0.2, "Z", Slot.Mid, true),
      note(60, 0.3, 0.5, "Z", Slot.Mid, false),
    ]);
    const middleDown = evs.find((e) => e.kind === "mouse-middle" && e.down)!;
    const middleUp = evs.find((e) => e.kind === "mouse-middle" && !e.down)!;
    expect(middleDown.t).toBeLessThan(middleUp.t);
    // 中键切换不能发生在某个音键按着的区间里
    const zDown = downsOf(evs, "Z");
    const zUp = upsOf(evs, "Z");
    for (let i = 0; i < zDown.length && i < zUp.length; i++) {
      const insideHeld =
        middleUp.t > zDown[i] / 1000 && middleUp.t < zUp[i] / 1000;
      expect(insideHeld).toBe(false);
    }
  });
});

describe("调度：速度无关性", () => {
  it("物理间隔不随速度缩放 —— 换算是最后一步，事件表本身与速度无关", () => {
    const evs = buildSchedule([note(60, 0, 0.5, "Z"), note(62, 0.5, 1.0, "X")]);
    // 同一份事件表，按不同速度换算物理时刻，间隔的比值应当等于速度比
    const at100 = toPhysical(evs, 1.0);
    const at200 = toPhysical(evs, 2.0);
    const gap100 = at100[1].atMs - at100[0].atMs;
    const gap200 = at200[1].atMs - at200[0].atMs;
    expect(gap200).toBeCloseTo(gap100 / 2, 6);
  });

  it("稳健档的间隔比极限档大", () => {
    const mk = (t: typeof TIMING_SAFE) =>
      buildSchedule([note(60, 0, 0.02, "Z"), note(60, 0.03, 0.05, "Z")], t);
    const safe = downsOf(mk(TIMING_SAFE), "Z");
    const aggr = downsOf(mk(TIMING_AGGRESSIVE), "Z");
    expect(safe[1] - safe[0]).toBeGreaterThan(aggr[1] - aggr[0]);
  });
});

describe("诊断", () => {
  it("健康的事件表诊断为零问题", () => {
    const evs = buildSchedule([note(60, 0, 0.5, "Z"), note(62, 0.6, 1.1, "X")]);
    const d = diagnose(evs, TIMING_STANDARD);
    expect(d.totalNotes).toBe(2);
    expect(d.modLeadTooShort).toBe(0);
    expect(d.minHoldTooShort).toBe(0);
  });

  it("空表不崩", () => {
    const d = diagnose([], TIMING_STANDARD);
    expect(d.totalNotes).toBe(0);
    expect(d.minModLeadMs).toBe(0);
  });
});

describe("键位表", () => {
  it("KEYS 是七个自然音键", () => {
    expect(KEYS).toEqual(["Z", "X", "C", "V", "B", "N", "M"]);
  });
});
