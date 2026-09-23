// 音高 → 口琴键位映射。
//
// 游戏口琴是**单音**乐器：一次只吹一个音。键盘上是一排自然音键
// `Z X C V B N M`（do..si），加一个逗号键补最高音。
// 升降号与八度靠鼠标修饰键切换：
//   不按鼠标 = 基准八度  |  左键 = 降一个八度  |  右键 = 升一个八度  |  中键 = 升半音
//
// 这套规则照抄自 harmonica-auto-player 的 NoteMapper.cs，行为保持一致。

/** 八度档位：相对基准八度的偏移。 */
export enum Slot {
  Low = -1,
  Mid = 0,
  High = 1,
}

/** 自然音（无升降）对应的半音号。 */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

/** do..si 对应的键位。 */
export const KEYS = ["Z", "X", "C", "V", "B", "N", "M"] as const;

/** 高高音 do 用的键：键盘逗号。 */
export const TOP_KEY = ",";

/** 映射后的单个可演奏音符。 */
export interface MappedNote {
  /** MIDI 音高编号。 */
  pitch: number;
  /** 起始时刻（秒，音乐时间，未乘速度）。 */
  start: number;
  /** 结束时刻（秒）。 */
  end: number;
  /** 'Z'..'M' 或 ','。 */
  key: string;
  /** true → 需按住鼠标中键（升半音）。 */
  sharp: boolean;
  /** 八度档位。 */
  octaveSlot: Slot;
  /** false → 超出可演奏范围，演奏时跳过。 */
  inRange: boolean;
  /** 进不了可演奏范围的原因（界面显示用）。 */
  skipReason: string;
}

/** 一次映射的结果。 */
export interface MappingResult {
  /** 基准八度（MIDI 编号，C4 = 60 所在八度）。 */
  baseOctave: number;
  notes: MappedNote[];
}

/** JS 的 % 对负数返回负值，音高运算必须用这个。 */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** 取八度序号：C4 = 60 → 4。 */
function octaveOf(pitch: number): number {
  return Math.floor(pitch / 12) - 1;
}

/** 自然音半音号 → 音级下标（0=do）；升号返回 -1。 */
function diatonicIndexOf(pc: number): number {
  return NATURAL_PC.indexOf(pc);
}

/**
 * 任意音高对应的键位。
 * 升号音先降半音归到自然音，再用中键补回半音。
 *
 * topC 只在「比基准高两个八度的 do」时为 true —— 键盘上只有那一个 do 走逗号键，
 * 中间几个八度的 do 仍然是 Z。
 */
export function keyOfPitch(
  pitch: number,
  baseOctave = 4,
): { key: string; sharp: boolean } {
  let pc = mod(pitch, 12);
  let idx = diatonicIndexOf(pc);
  let sharp = false;

  if (idx < 0) {
    // 升号音：降半音后取自然音，标记需要中键
    pc = mod(pc - 1, 12);
    idx = diatonicIndexOf(pc);
    sharp = true;
  }

  // 只有基准 +2 八度那个 do 用逗号键；其余八度的 do 仍走 Z
  const isTopC = idx === 0 && !sharp && octaveOf(pitch) - baseOctave === 2;

  const key = isTopC ? TOP_KEY : KEYS[idx];
  return { key, sharp };
}

/**
 * 某个音高在基准八度下是否可演奏。
 *
 * 可演奏范围：基准 ±1 个八度，外加上方高八度里的 do / #do
 * （那两个音靠「右键 + 逗号」得到，是这套键位方案唯一能超出 ±1 的特例）。
 */
export function reachable(pitch: number, baseOctave: number): boolean {
  const d = octaveOf(pitch) - baseOctave;
  if (d >= -1 && d <= 1) return true;
  if (d === 2) {
    const pc = mod(pitch, 12);
    // 高高音 do / 高高音 #do：右键加逗号，可再加中键
    return pc === 0 || pc === 1;
  }
  return false;
}

/**
 * 把一串原始音符映射到口琴按键。
 *
 * @param notes    原始音符（已选好主旋律轨）
 * @param baseOctave 基准八度，默认 4（C4 = 中音 do）
 * @param forceOctave 折八度：音域外的音上下试最多 4 个八度，
 *                    取第一个落进范围且音名不变的。默认关。
 */
export function mapNotes(
  notes: readonly RawNote[],
  baseOctave = 4,
  forceOctave = false,
): MappingResult {
  const out: MappedNote[] = notes.map((n) => {
    let pitch = n.pitch;

    if (!reachable(pitch, baseOctave) && forceOctave) {
      // 只挪整八度，音名不变：低音 6 折上去还是 6，不是别的音
      for (let d = 1; d <= 4; d++) {
        if (reachable(pitch + 12 * d, baseOctave)) {
          pitch = pitch + 12 * d;
          break;
        }
        if (reachable(pitch - 12 * d, baseOctave)) {
          pitch = pitch - 12 * d;
          break;
        }
      }
    }

    const ok = reachable(pitch, baseOctave);
    const { key, sharp } = ok
      ? keyOfPitch(pitch, baseOctave)
      : { key: "", sharp: false };
    const d = ok ? octaveOf(pitch) - baseOctave : 0;

    return {
      pitch,
      start: n.start,
      end: n.end,
      key,
      sharp,
      octaveSlot: !ok || d === 0 ? Slot.Mid : d < 0 ? Slot.Low : Slot.High,
      inRange: ok,
      skipReason: ok ? "" : `音高 ${pitch} 超出可演奏音域`,
    };
  });

  return { baseOctave, notes: out };
}

/** 原始音符（时间单位：秒）。 */
export interface RawNote {
  pitch: number;
  start: number;
  end: number;
}

/** 把音高写成简谱，界面显示用。 */
export function jianpu(pitch: number, baseOctave = 4): string {
  const names = [
    "1",
    "#1",
    "2",
    "#2",
    "3",
    "4",
    "#4",
    "5",
    "#5",
    "6",
    "#6",
    "7",
  ];
  const oct = octaveOf(pitch) - baseOctave;
  const base = names[mod(pitch, 12)];
  if (oct === 0) return base;
  // 高八度加点在上方、低八度加点在下方，这里用纯文本近似
  return oct > 0 ? base + "˙".repeat(oct) : base + ".".repeat(-oct);
}

/** 可演奏音域的简谱描述，界面显示用。 */
export function rangeLabel(baseOctave: number): string {
  const low = (baseOctave + 1) * 12; // 低音 do
  const high = (baseOctave + 2) * 12 + 1; // 高高音 #do
  return `${jianpu(low, baseOctave)} ~ ${jianpu(high, baseOctave)}`;
}
