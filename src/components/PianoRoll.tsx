// 卷帘：把谱面画出来，支持拖动改音。
//
// 渲染与命中共用同一套坐标换算 —— 只有一套换算函数，两个方向对称。

import { useCallback, useEffect, useRef } from "react";
import { MappedNote, Slot, jianpu } from "../core/mapping";

const KEY_HEIGHT = 13;
const MIN_PITCH_SPAN = 24;

export interface PianoRollProps {
  notes: MappedNote[];
  /** 全曲时长（秒）。 */
  duration: number;
  /** 每像素多少秒。 */
  secondsPerPx: number;
  /** 播放头位置（秒）。 */
  playhead: number;
  /** 当前选中的音。 */
  selected: Set<number>;
  onSelect: (idx: number, additive: boolean) => void;
  onClearSelection: () => void;
  onSeek: (seconds: number) => void;
  onMoveNote: (idx: number, deltaSeconds: number, deltaPitch: number) => void;
}

/** 计算音高范围，留出上下余量。 */
function pitchRange(notes: MappedNote[]): { min: number; max: number } {
  if (notes.length === 0) return { min: 48, max: 72 };
  let min = Infinity;
  let max = -Infinity;
  for (const n of notes) {
    if (n.pitch < min) min = n.pitch;
    if (n.pitch > max) max = n.pitch;
  }
  const span = max - min + 1;
  if (span < MIN_PITCH_SPAN) {
    const pad = Math.ceil((MIN_PITCH_SPAN - span) / 2);
    min -= pad;
    max += pad;
  } else {
    min -= 2;
    max += 2;
  }
  return { min, max };
}

/** 音高对应的颜色：可演奏绿、升号紫、超范围灰。 */
function noteColor(n: MappedNote): string {
  if (!n.inRange) return "#484f58";
  if (n.sharp) return "#a371f7";
  if (n.octaveSlot === Slot.Low) return "#1f6feb";
  if (n.octaveSlot === Slot.High) return "#3fb950";
  return "#2f81f7";
}

export function PianoRoll({
  notes,
  duration,
  secondsPerPx,
  playhead,
  selected,
  onSelect,
  onClearSelection,
  onSeek,
  onMoveNote,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 拖动状态：移动音符 or 定位播放头
  const dragRef = useRef<{
    mode: "move" | "seek";
    idx: number;
    startX: number;
    startY: number;
    originStart: number;
    originPitch: number;
  } | null>(null);

  const { min: minPitch, max: maxPitch } = pitchRange(notes);
  const pitchCount = maxPitch - minPitch + 1;

  /** 时间 → x（秒 → 像素）。 */
  const timeToX = useCallback((t: number) => t / secondsPerPx, [secondsPerPx]);
  /** x → 时间。 */
  const xToTime = useCallback((x: number) => x * secondsPerPx, [secondsPerPx]);
  /** 音高 → y。 */
  const pitchToY = useCallback(
    (p: number) => (maxPitch - p) * KEY_HEIGHT,
    [maxPitch],
  );
  /** y → 音高。 */
  const yToPitch = useCallback(
    (y: number) => maxPitch - Math.floor(y / KEY_HEIGHT),
    [maxPitch],
  );

  // ---------- 绘制 ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const width = Math.max(600, timeToX(Math.max(duration, 1)) + 80);
    const height = pitchCount * KEY_HEIGHT;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // 每秒钟一条竖线
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    const maxT = Math.max(duration, 1);
    for (let t = 0; t <= maxT; t += 1) {
      const x = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // 每个八度的 do 画一条粗线，方便看位置
    ctx.strokeStyle = "#30363d";
    for (let p = minPitch; p <= maxPitch; p++) {
      if (p % 12 === 0) {
        const y = Math.round(pitchToY(p) + KEY_HEIGHT) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // 音符
    ctx.font = "10px ui-monospace, monospace";
    notes.forEach((n, i) => {
      const x = timeToX(n.start);
      const w = Math.max(2.5, timeToX(n.end - n.start));
      const y = pitchToY(n.pitch);
      const h = KEY_HEIGHT - 2;
      const color = noteColor(n);

      ctx.fillStyle = color;
      ctx.globalAlpha = n.inRange ? 1 : 0.45;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, w, h, 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // 选中描边
      if (selected.has(i)) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 够宽就写简谱音名
      if (w > 22) {
        ctx.fillStyle = n.inRange ? "#0d1117" : "#8b949e";
        ctx.fillText(jianpu(n.pitch), x + 4, y + KEY_HEIGHT - 4);
      }
    });

    // 播放头
    const px = Math.round(timeToX(playhead)) + 0.5;
    ctx.strokeStyle = "#f85149";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }, [
    notes,
    duration,
    secondsPerPx,
    playhead,
    selected,
    pitchCount,
    minPitch,
    maxPitch,
    timeToX,
    pitchToY,
  ]);

  // ---------- 命中测试 ----------
  const hitTest = useCallback(
    (x: number, y: number): number => {
      const t = xToTime(x);
      const p = yToPitch(y);
      // 从后往前找，后画的在上面
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (p === n.pitch && t >= n.start && t <= n.end) return i;
      }
      return -1;
    },
    [notes, xToTime, yToPitch],
  );

  const localPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y } = localPos(e);
    const idx = hitTest(x, y);

    if (idx >= 0) {
      onSelect(idx, e.shiftKey);
      const n = notes[idx];
      dragRef.current = {
        mode: "move",
        idx,
        startX: x,
        startY: y,
        originStart: n.start,
        originPitch: n.pitch,
      };
    } else {
      onClearSelection();
      onSeek(xToTime(x));
      dragRef.current = {
        mode: "seek",
        idx: -1,
        startX: x,
        startY: y,
        originStart: 0,
        originPitch: 0,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = localPos(e);

    if (drag.mode === "seek") {
      onSeek(xToTime(x));
      return;
    }

    const dt = xToTime(x - drag.startX);
    const dp = -Math.round((y - drag.startY) / KEY_HEIGHT);
    if (Math.abs(dt) < 1e-4 && dp === 0) return;
    onMoveNote(drag.idx, dt, dp);
    dragRef.current = { ...drag, startX: x, startY: y };
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  return (
    <div className="roll-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="roll-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      />
    </div>
  );
}
