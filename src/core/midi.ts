// 最小 MIDI 解析（SMF 格式 0/1）。
//
// 只做这个工程需要的事：取每个音符的 onset/duration/通道/音高。
// 不解析控制器、不解析弯音 —— 口琴用不上。

export interface RawTrackNote {
  /** MIDI 音高编号。 */
  pitch: number;
  /** 起始时刻（秒）。 */
  start: number;
  /** 结束时刻（秒）。 */
  end: number;
  /** MIDI 通道（0-15），通道 9 是打击乐。 */
  channel: number;
  /** 力度。 */
  velocity: number;
}

export interface MidiTrack {
  index: number;
  name: string;
  notes: RawTrackNote[];
  /** 音色号（0-127），未指定为 null。 */
  program: number | null;
  /** 通道 9 = 打击乐轨。 */
  isDrum: boolean;
  /** 音高跨度，用于推荐主旋律轨。 */
  avgPitch: number;
}

export interface MidiFile {
  format: number;
  /** 每四分音符的 tick 数。 */
  division: number;
  /** 全曲速度换算后，tick → 秒。 */
  tempoMap: Array<{ tick: number; usPerQuarter: number }>;
  tracks: MidiTrack[];
  /** 全曲时长（秒）。 */
  duration: number;
}

/** 读大端整数。 */
function readU32(d: DataView, o: number): number {
  return d.getUint32(o, false);
}
function readU16(d: DataView, o: number): number {
  return d.getUint16(o, false);
}

/** 读变长整数（MIDI 的 VLQ）。 */
function readVarLen(d: DataView, offset: { v: number }): number {
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const b = d.getUint8(offset.v++);
    result = (result << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return result;
}

/** 把 tick 换算成秒，考虑曲中的速度变化。 */
export function tickToSeconds(
  tick: number,
  division: number,
  tempoMap: Array<{ tick: number; usPerQuarter: number }>,
): number {
  let sec = 0;
  let lastTick = 0;
  let usPerQuarter = 500000; // 默认 120 BPM

  for (const t of tempoMap) {
    if (t.tick >= tick) break;
    sec += ((t.tick - lastTick) / division) * (usPerQuarter / 1e6);
    lastTick = t.tick;
    usPerQuarter = t.usPerQuarter;
  }
  sec += ((tick - lastTick) / division) * (usPerQuarter / 1e6);
  return sec;
}

/**
 * 解析一个标准 MIDI 文件。
 * 遇到结构不对的地方抛错，调用方显示给用户。
 */
export function parseMidi(buffer: ArrayBuffer): MidiFile {
  const d = new DataView(buffer);
  if (buffer.byteLength < 14) throw new Error("文件太小，不是有效的 MIDI。");
  if (
    String.fromCharCode(
      d.getUint8(0),
      d.getUint8(1),
      d.getUint8(2),
      d.getUint8(3),
    ) !== "MThd"
  )
    throw new Error("缺少 MThd 头，不是标准 MIDI 文件。");

  const headerLen = readU32(d, 4);
  if (headerLen < 6) throw new Error("MThd 头长度不对。");
  const format = readU16(d, 8);
  const numTracks = readU16(d, 10);
  const division = readU16(d, 12);
  if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间格式的 MIDI。");

  const tempoMap: Array<{ tick: number; usPerQuarter: number }> = [];
  const rawTracks: Array<{
    index: number;
    name: string;
    program: number | null;
    events: Array<{ tick: number; status: number; a: number; b: number }>;
  }> = [];

  let offset = 8 + headerLen;

  for (let ti = 0; ti < numTracks && offset + 8 <= buffer.byteLength; ti++) {
    const id = String.fromCharCode(
      d.getUint8(offset),
      d.getUint8(offset + 1),
      d.getUint8(offset + 2),
      d.getUint8(offset + 3),
    );
    const len = readU32(d, offset + 4);
    const end = offset + 8 + len;
    if (id !== "MTrk") {
      offset = end;
      continue;
    }

    const pos = { v: offset + 8 };
    let tick = 0;
    let runningStatus = 0;
    let name = "";
    let program: number | null = null;
    const events: Array<{
      tick: number;
      status: number;
      a: number;
      b: number;
    }> = [];

    while (pos.v < end && pos.v < buffer.byteLength) {
      tick += readVarLen(d, pos);
      if (pos.v >= end) break;

      let status = d.getUint8(pos.v);
      if (status & 0x80) {
        pos.v++;
        runningStatus = status;
      } else {
        status = runningStatus; // running status：沿用上一个状态字节
      }

      const type = status & 0xf0;

      if (status === 0xff) {
        // meta 事件
        const metaType = d.getUint8(pos.v++);
        const metaLen = readVarLen(d, pos);
        if (metaType === 0x51 && metaLen === 3) {
          const us =
            (d.getUint8(pos.v) << 16) |
            (d.getUint8(pos.v + 1) << 8) |
            d.getUint8(pos.v + 2);
          tempoMap.push({ tick, usPerQuarter: us });
        } else if (metaType === 0x03) {
          // 轨名
          let s = "";
          for (let i = 0; i < metaLen; i++) {
            const c = d.getUint8(pos.v + i);
            if (c >= 0x20 || c === 0x09) s += String.fromCharCode(c);
          }
          name = s.trim() || name;
        } else if (metaType === 0x2f) {
          break;
        }
        pos.v += metaLen;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const l = readVarLen(d, pos);
        pos.v += l;
        continue;
      }

      const a = d.getUint8(pos.v++);
      let b = 0;
      if (type !== 0xc0 && type !== 0xd0) b = d.getUint8(pos.v++);

      if (type === 0xc0) program = a;
      events.push({ tick, status, a, b });
    }

    rawTracks.push({ index: ti, name, program, events });
    offset = end;
  }

  tempoMap.sort((x, y) => x.tick - y.tick);
  if (tempoMap.length === 0) tempoMap.push({ tick: 0, usPerQuarter: 500000 });

  // 把 noteOn/noteOff 配对成音符
  const tracks: MidiTrack[] = [];

  for (const rt of rawTracks) {
    const notes: RawTrackNote[] = [];
    // key = channel<<8 | pitch，记录当前按下的音
    const held = new Map<number, { tick: number; velocity: number }>();
    let channel = 0;

    for (const ev of rt.events) {
      const type = ev.status & 0xf0;
      if (type === 0x90 || type === 0x80 || type === 0xc0)
        channel = ev.status & 0x0f;

      if (type === 0x90 && ev.b > 0) {
        held.set((channel << 8) | ev.a, { tick: ev.tick, velocity: ev.b });
      } else if (type === 0x80 || (type === 0x90 && ev.b === 0)) {
        const k = (channel << 8) | ev.a;
        const on = held.get(k);
        if (on) {
          held.delete(k);
          notes.push({
            pitch: ev.a,
            start: tickToSeconds(on.tick, division, tempoMap),
            end: tickToSeconds(ev.tick, division, tempoMap),
            channel,
            velocity: on.velocity,
          });
        }
      }
    }

    // 没等到 noteOff 的音：给一个常见时长收尾
    for (const [k, on] of held) {
      const pitch = k & 0xff;
      const ch = k >> 8;
      const s = tickToSeconds(on.tick, division, tempoMap);
      notes.push({
        pitch,
        start: s,
        end: s + 0.5,
        channel: ch,
        velocity: on.velocity,
      });
    }

    const isDrum = rt.events.some((e) => (e.status & 0x0f) === 9);
    const avgPitch = notes.length
      ? notes.reduce((s, n) => s + n.pitch, 0) / notes.length
      : 0;

    tracks.push({
      index: rt.index,
      name: rt.name || `声轨 ${rt.index + 1}`,
      notes: notes.sort((a, b) => a.start - b.start),
      program: rt.program,
      isDrum,
      avgPitch,
    });
  }

  const duration = tracks.reduce(
    (m, t) =>
      Math.max(
        m,
        t.notes.reduce((x, n) => Math.max(x, n.end), 0),
      ),
    0,
  );

  return { format, division, tempoMap, tracks, duration };
}

/**
 * 推荐主旋律轨。
 * 规则：非打击乐、音符最多、音域居中。绿点标的就是它。
 */
export function recommendTrack(tracks: readonly MidiTrack[]): number {
  let best = -1;
  let bestScore = -Infinity;
  for (const t of tracks) {
    if (t.isDrum || t.notes.length === 0) continue;
    // 音符数是主要因素；音域太偏（极低/极高）扣分
    const score = t.notes.length - Math.abs(t.avgPitch - 64) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = t.index;
    }
  }
  return best;
}
