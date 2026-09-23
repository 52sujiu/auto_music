import { describe, expect, it } from "vitest";
import { Slot } from "./mapping";
import { GuideJudge } from "./guide-judge";
import { buildGuideState } from "./guide";

const note = (t: number, key = "Z", slot = Slot.Mid, sharp = false) => ({
  t, key, slot, sharp, dur: 0.2, label: "1",
});
const input = (key = "Z", left = false, right = false, middle = false) => ({
  key, left, right, middle,
});

describe("引导练习判定", () => {
  it("按时间误差给 Perfect、Great，并只判一次", () => {
    const judge = new GuideJudge([note(1), note(2)], 1);
    expect(judge.press(input(), 1.04)?.grade).toBe("perfect");
    expect(judge.press(input(), 1.05)).toBeNull();
    expect(judge.press(input(), 2.12)?.grade).toBe("great");
    expect(judge.snapshot()).toMatchObject({ score: 150, combo: 2, perfect: 1, great: 1, miss: 0 });
  });

  it("错误键、错误修饰和逾期都扣分，速度不改变物理判定窗", () => {
    const judge = new GuideJudge([note(1, "X", Slot.Low), note(2, "C", Slot.Mid, true), note(3)], 2);
    expect(judge.press(input("X"), 1)?.grade).toBe("miss");
    expect(judge.press(input("C", false, false, true), 2.24)?.grade).toBe("great");
    expect(judge.expire(3.34).map((item) => item.grade)).toEqual(["miss"]);
    expect(judge.snapshot()).toMatchObject({ score: -50, combo: 0, great: 1, miss: 2, judged: 3 });
  });

  it("按对八度和升半音才算正确", () => {
    const judge = new GuideJudge([note(1, "M", Slot.High, true)], 1);
    expect(judge.press(input("M", false, true, true), 1)?.grade).toBe("perfect");
  });

  it("调度延后音符时仍保留原音符的修饰键", () => {
    const events = [
      { t: 1, kind: "key" as const, key: "Z", down: true },
      { t: 1.2, kind: "key" as const, key: "Z", down: false },
    ];
    const notes = [{
      pitch: 48, start: 0, end: 0.2, key: "Z", sharp: false,
      octaveSlot: Slot.Low, inRange: true, skipReason: "",
    }];
    expect(buildGuideState(events, notes, "测试", 4, () => "1").notes[0])
      .toMatchObject({ key: "Z", slot: Slot.Low, t: 1 });
  });
});
