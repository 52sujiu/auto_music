import { Slot } from "./mapping";
import type { GuideNote } from "./guide";

export type GuideGrade = "perfect" | "great" | "miss";

export interface GuideInput {
  key: string;
  left: boolean;
  right: boolean;
  middle: boolean;
}

export interface GuideJudgement {
  index: number;
  grade: GuideGrade;
  deltaMs: number;
}

export interface GuideScore {
  score: number;
  combo: number;
  perfect: number;
  great: number;
  miss: number;
  judged: number;
}

export const PERFECT_MS = 70;
export const GREAT_MS = 160;

const EMPTY_SCORE: GuideScore = {
  score: 0,
  combo: 0,
  perfect: 0,
  great: 0,
  miss: 0,
  judged: 0,
};

function matches(note: GuideNote, input: GuideInput): boolean {
  return note.key === input.key &&
    input.left === (note.slot === Slot.Low) &&
    input.right === (note.slot === Slot.High) &&
    input.middle === note.sharp;
}

/** 一个练习回合的判定器。时间使用与下落谱相同的音乐秒数。 */
export class GuideJudge {
  private readonly judged = new Set<number>();
  private score: GuideScore = { ...EMPTY_SCORE };

  constructor(private readonly notes: readonly GuideNote[], private readonly speed: number) {}

  snapshot(): GuideScore {
    return { ...this.score };
  }

  isJudged(index: number): boolean {
    return this.judged.has(index);
  }

  /** 超过 Great 窗口还没按下的音符逐个记 Miss。 */
  expire(time: number): GuideJudgement[] {
    const missed: GuideJudgement[] = [];
    for (let index = 0; index < this.notes.length; index++) {
      const deltaMs = this.deltaMs(time, this.notes[index].t);
      if (deltaMs <= GREAT_MS) break;
      if (!this.judged.has(index)) missed.push(this.record(index, "miss", deltaMs));
    }
    return missed;
  }

  /** 仅在判定窗内消费最近的音符；错误键或修饰键算该音符 Miss。 */
  press(input: GuideInput, time: number): GuideJudgement | null {
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < this.notes.length; index++) {
      if (this.judged.has(index)) continue;
      const deltaMs = this.deltaMs(time, this.notes[index].t);
      if (deltaMs < -GREAT_MS) break;
      const distance = Math.abs(deltaMs);
      if (distance <= GREAT_MS && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best < 0) return null;
    const deltaMs = this.deltaMs(time, this.notes[best].t);
    const grade = !matches(this.notes[best], input)
      ? "miss"
      : Math.abs(deltaMs) <= PERFECT_MS ? "perfect" : "great";
    return this.record(best, grade, deltaMs);
  }

  private deltaMs(time: number, noteTime: number): number {
    return (time - noteTime) * 1000 / Math.max(0.01, this.speed);
  }

  private record(index: number, grade: GuideGrade, deltaMs: number): GuideJudgement {
    this.judged.add(index);
    this.score.judged++;
    this.score[grade]++;
    if (grade === "perfect") {
      this.score.score += 100;
      this.score.combo++;
    } else if (grade === "great") {
      this.score.score += 50;
      this.score.combo++;
    } else {
      this.score.score -= 50;
      this.score.combo = 0;
    }
    return { index, grade, deltaMs };
  }
}
