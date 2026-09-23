// 引导练习窗：节奏大师式竖向下落 + 悬浮指引。
//
// 这是**练习辅助**，不是自动演奏 —— 它只显示「该按什么」，按键由用户自己按。
// 窗口置顶，穿透模式下鼠标直通给下层游戏，ESC 退出穿透。

import { useEffect, useMemo, useRef, useState } from "react";
import { guideColor, keyLabel, readGuide, type GuideState } from "./core/guide";
import { GuideJudge, type GuideGrade, type GuideInput, type GuideJudgement, type GuideScore } from "./core/guide-judge";
import { Slot } from "./core/mapping";

/** 8 条轨道：Z X C V B N M + 逗号（最高音 do）。 */
const LANES = ["Z", "X", "C", "V", "B", "N", "M", ","] as const;
/** 判定线在窗口高度的哪个位置（0=顶，1=底）。 */
const JUDGE_RATIO = 0.8;

function laneOf(key: string): number {
  const i = (LANES as readonly string[]).indexOf(key);
  return i >= 0 ? i : -1;
}

/** 修饰角标：左=降八度 右=升八度 中=升半音。 */
function modTag(n: GuideState["notes"][number]): string | null {
  // 中键优先：升半音的显示比八度更关键
  if (n.sharp) return "中";
  if (n.slot === Slot.Low) return "左";
  if (n.slot === Slot.High) return "右";
  return null;
}

export default function GuideApp() {
  const [state, setState] = useState<GuideState | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedState, setSpeedState] = useState(1);
  // 下落速度：纵向像素/秒，节奏大师里的调速概念
  const [pxPerSec, setPxPerSec] = useState(150);
  const [through, setThrough] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const stateRef = useRef<GuideState | null>(null);
  const speedRef = useRef(1);
  const playingRef = useRef(false);
  const judgeRef = useRef<GuideJudge | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseRef = useRef({ left: false, right: false, middle: false });
  const nativeReadyRef = useRef(false);
  const [score, setScore] = useState<GuideScore>(() => new GuideJudge([], 1).snapshot());
  const [feedback, setFeedback] = useState<{ grade: GuideGrade; deltaMs: number } | null>(null);
  const [judgeRevision, setJudgeRevision] = useState(0);
  const [inputStatus, setInputStatus] = useState("");

  const acceptState = (next: GuideState | null) => {
    stateRef.current = next;
    setState(next);
    judgeRef.current = next ? new GuideJudge(next.notes, speedRef.current) : null;
    setScore(judgeRef.current?.snapshot() ?? new GuideJudge([], 1).snapshot());
    setJudgeRevision((value) => value + 1);
    setFeedback(null);
  };

  const beginPractice = (nextSpeed: number) => {
    const actualSpeed = Math.max(0.1, nextSpeed || 1);
    speedRef.current = actualSpeed;
    judgeRef.current = new GuideJudge(stateRef.current?.notes ?? [], actualSpeed);
    setScore(judgeRef.current.snapshot());
    setJudgeRevision((value) => value + 1);
    setFeedback(null);
    startRef.current = performance.now();
    setSpeedState(actualSpeed);
    setT(0);
    playingRef.current = true;
    setPlaying(true);
  };

  const stopPractice = () => {
    playingRef.current = false;
    setPlaying(false);
    setT(0);
  };

  const showJudgements = (items: GuideJudgement[]) => {
    if (items.length === 0 || !judgeRef.current) return;
    setScore(judgeRef.current.snapshot());
    setJudgeRevision((value) => value + 1);
    const last = items[items.length - 1];
    setFeedback({ grade: last.grade, deltaMs: last.deltaMs });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 650);
  };

  const processInput = (input: GuideInput) => {
    if (!playingRef.current || !judgeRef.current) return;
    const time = ((performance.now() - startRef.current) / 1000) * speedRef.current;
    const expired = judgeRef.current.expire(time);
    const result = judgeRef.current.press(input, time);
    showJudgements(result ? [...expired, result] : expired);
  };
  const inputHandlerRef = useRef(processInput);
  inputHandlerRef.current = processInput;

  // ---------- 接收主窗状态 ----------
  useEffect(() => {
    const load = () => acceptState(readGuide());
    load();
    window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);

  // ---------- 播放控制：主窗通过 Tauri 事件广播 ----------
  useEffect(() => {
    const unlistens: (() => void)[] = [];
    let dead = false;
    (async () => {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { listen } = await import("@tauri-apps/api/event");
      if (dead) return;
      // 1) 谱面本身：localStorage 在桌面双 webview 间不互通时靠这个兜底
      unlistens.push(
        await listen<GuideState>("guide:state", (e) => {
          if (e.payload && Array.isArray(e.payload.notes)) {
            acceptState(e.payload);
          }
        }),
      );
      // 2) 播放/停止
      unlistens.push(
        await listen<{ action: string; speed: number }>(
          "guide:control",
          (e) => {
            if (e.payload.action === "play") {
              localStorage.setItem(
                "auto-music:guide-speed",
                String(e.payload.speed || 1),
              );
              beginPractice(e.payload.speed || 1);
            } else {
              stopPractice();
            }
          },
        ),
      );
      // 3) 穿透开关：穿透后本窗点不动，只能靠主窗发事件关
      unlistens.push(
        await listen<{ through: boolean }>("guide:set-through", (e) => {
          setThrough(!!e.payload.through);
        }),
      );
    })();
    return () => {
      dead = true;
      for (const u of unlistens) u();
    };
  }, []);

  /** 本窗独立试播：主窗信号没过来时也能验证下落是否正常。 */
  const localPreview = () => {
    if (!state) return;
    const s =
      Number(localStorage.getItem("auto-music:guide-speed") ?? "1") || 1;
    beginPractice(s);
  };

  const speed = speedState;

  // 时间推进（t 是音乐时间，已含速度换算，画布直接用 t 对齐）
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const elapsed = ((performance.now() - startRef.current) / 1000) * speed;
      setT(elapsed);
      if (judgeRef.current) showJudgements(judgeRef.current.expire(elapsed));
      if (state && elapsed > state.duration + 1) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, state]);

  // ---------- 穿透：鼠标直通给下层游戏，ESC 退出 ----------
  useEffect(() => {
    (async () => {
      if (!("__TAURI_INTERNALS__" in window)) return;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setIgnoreCursorEvents(through);
    })();
  }, [through]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && through) setThrough(false);
      if (nativeReadyRef.current || e.repeat) return;
      const key = e.key === "," ? "," : e.key.toUpperCase();
      if (!LANES.includes(key as typeof LANES[number])) return;
      inputHandlerRef.current({ key, ...mouseRef.current });
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) mouseRef.current.left = true;
      if (e.button === 1) mouseRef.current.middle = true;
      if (e.button === 2) mouseRef.current.right = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseRef.current.left = false;
      if (e.button === 1) mouseRef.current.middle = false;
      if (e.button === 2) mouseRef.current.right = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [through]);

  // Windows 原生轮询在其他窗口获得焦点时仍能收到玩家按键。
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !/Windows/i.test(navigator.userAgent)) {
      setInputStatus("仅在引导窗聚焦时计分");
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
      ]);
      const release = await listen<GuideInput>("guide:input", (event) => {
        inputHandlerRef.current(event.payload);
      });
      if (disposed) { release(); return; }
      unlisten = release;
      await invoke("start_guide_input");
      nativeReadyRef.current = true;
      setInputStatus("正在全局监听按键");
    })().catch((error) => setInputStatus(`全局监听失败，仅本窗可计分：${String(error)}`));
    return () => {
      disposed = true;
      unlisten?.();
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // ---------- 判定线上的当前音符 ----------
  const current = useMemo(() => {
    if (!state) return null;
    let best: GuideState["notes"][number] | null = null;
    let bestDelta = Infinity;
    for (const [index, n] of state.notes.entries()) {
      if (judgeRef.current?.isJudged(index)) continue;
      const delta = n.t - t;
      if (delta < -0.35) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta;
        best = n;
      }
      if (delta > 5) break;
    }
    return best;
  }, [state, t, judgeRevision]);

  // ---------- 绘制下落轨道（8 轨，节奏大师式） ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width;
      const h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, w, h);

      const laneW = w / LANES.length;
      const judgeY = h * JUDGE_RATIO;

      // 轨道底色（相邻轨交替，找键更快）
      for (let i = 0; i < LANES.length; i++) {
        if (i % 2 === 1) {
          ctx.fillStyle = "rgba(255,255,255,0.025)";
          ctx.fillRect(i * laneW, 0, laneW, h);
        }
      }
      // 轨道线
      ctx.strokeStyle = "#21262d";
      ctx.lineWidth = 1;
      for (let i = 1; i < LANES.length; i++) {
        const x = Math.round(i * laneW) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // 音符块：y 由「距离判定线还有多少秒」决定，落在自己的轨里
      if (state) {
        // 判定线上下各显示多少秒
        const showFuture = judgeY / pxPerSec + 0.2;
        const showPast = (h - judgeY) / pxPerSec + 0.9;
        for (const [index, n] of state.notes.entries()) {
          const li = laneOf(n.key);
          if (li < 0) continue;
          const delta = n.t - t;
          if (delta > showFuture || delta < -showPast) continue;

          const y = judgeY - delta * pxPerSec;
          // 长音画成 holde 条（节奏大师式），短音保底 30px 高度
          const noteH = Math.min(160, Math.max(30, n.dur * pxPerSec));
          const cx = li * laneW + laneW / 2;
          const bw = Math.min(laneW - 8, 44);
          const near = Math.abs(delta) < 0.3;
          const past = delta < -0.15;

          ctx.globalAlpha = judgeRef.current?.isJudged(index) ? 0.18 : past ? 0.32 : 1;
          ctx.fillStyle = guideColor(n);
          // 发光：快到判定线的加一圈
          if (near && !past) {
            ctx.shadowColor = guideColor(n);
            ctx.shadowBlur = 14;
          } else {
            ctx.shadowBlur = 0;
          }
          ctx.beginPath();
          ctx.roundRect(cx - bw / 2, y - noteH / 2, bw, noteH, 6);
          ctx.fill();
          ctx.shadowBlur = 0;

          // 块内键名（块够高才写，避免糊）
          if (noteH >= 26) {
            ctx.fillStyle = "#0d1117";
            ctx.font = "700 13px -apple-system, ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(n.key === "," ? "，" : n.key, cx, y + (noteH > 44 ? -8 : 0));
          }
          // 修饰角标：左/右/中
          const tag = modTag(n);
          if (tag) {
            ctx.fillStyle = past ? "rgba(13,17,23,0.75)" : "#0d1117";
            ctx.font = "700 10px -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const ty = y + (noteH > 44 ? 10 : 0);
            // 角标小圆点
            ctx.beginPath();
            ctx.arc(cx, ty, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.fillText(tag, cx, ty + 0.5);
          }
          ctx.globalAlpha = 1;
        }
      }

      // 判定线 + 光晕
      const grad = ctx.createLinearGradient(0, judgeY - 24, 0, judgeY);
      grad.addColorStop(0, "rgba(248,81,73,0)");
      grad.addColorStop(1, "rgba(248,81,73,0.22)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, judgeY - 24, w, 24);
      ctx.strokeStyle = "#f85149";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, judgeY);
      ctx.lineTo(w, judgeY);
      ctx.stroke();

      // 轨名条（判定线下方）：告诉每条轨是哪个键
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < LANES.length; i++) {
        const cx = i * laneW + laneW / 2;
        const label = LANES[i] === "," ? "，" : LANES[i];
        const active =
          current != null && laneOf(current.key) === i && Math.abs(current.t - t) < 0.3;
        ctx.fillStyle = active ? "#f85149" : "#6e7681";
        ctx.fillText(label, cx, judgeY + 6);
      }
    };

    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [state, t, pxPerSec, current, judgeRevision]);

  const closeGuide = async () => {
    stopPractice();
    if (!("__TAURI_INTERNALS__" in window)) {
      window.close();
      return;
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const guide = getCurrentWindow();
    await guide.setIgnoreCursorEvents(false);
    await guide.close();
  };

  if (!state) {
    return (
      <div className="guide-root">
        <div className="guide-head" data-tauri-drag-region>
          <span className="guide-song">引导练习</span>
          <button className="guide-close" aria-label="关闭引导窗" title="关闭引导窗" onClick={() => void closeGuide()}>×</button>
        </div>
        <div className="guide-empty">
          等待主窗载入曲目…
          <br />
          在主窗点「引导练习」后这里会显示。
        </div>
      </div>
    );
  }

  return (
    <div className="guide-root">
      <div className="guide-head" data-tauri-drag-region>
        <span className="guide-song">{state.songName || "未命名"}</span>
        <div className="guide-head-end">
          <span className="guide-time">{t.toFixed(1)}s / {state.duration.toFixed(0)}s</span>
          <button className="guide-close" aria-label="关闭引导窗" title="关闭引导窗" onClick={() => void closeGuide()}>×</button>
        </div>
      </div>

      <div className="guide-tools">
        <button
          className="btn btn-xs"
          onClick={() => (playing ? stopPractice() : localPreview())}
          title="不经主窗、直接在本窗试看下落是否正常"
        >
          {playing ? "⏸" : "▶试播"}
        </button>
        <label className="guide-speed">
          下落
          <input
            type="range"
            min={70}
            max={300}
            step={5}
            value={pxPerSec}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
          />
        </label>
        <button
          className={`btn btn-xs${through ? " btn-warn" : ""}`}
          onClick={() => setThrough((v) => !v)}
          title="穿透后本窗点不动，去主窗点“取消穿透”（主窗 ESC 也行）"
        >
          {through ? "穿透中" : "鼠标穿透"}
        </button>
      </div>

      <div className="guide-score" aria-live="polite">
        <strong>{score.score} 分</strong>
        <span>{score.combo} 连击</span>
        <span className="grade-perfect">Perfect {score.perfect}</span>
        <span className="grade-great">Great {score.great}</span>
        <span className="grade-miss">Miss {score.miss}</span>
      </div>

      <canvas ref={canvasRef} className="guide-canvas" />

      <div className={`guide-hint${feedback ? ` grade-${feedback.grade}` : ""}`}>
        {feedback && <span className={`guide-result grade-${feedback.grade}`}>
          {feedback.grade.toUpperCase()} {feedback.grade === "miss" ? "−50" : feedback.grade === "great" ? "+50" : "+100"}
        </span>}
        {current ? (
          <>
            <span className="guide-hint-label">{keyLabel(current)}</span>
            <span className="guide-hint-sub">
              {current.label}
              {current.sharp ? " · 中键(升半音)" : ""}
              {current.slot === Slot.Low ? " · 左键(降八度)" : ""}
              {current.slot === Slot.High ? " · 右键(升八度)" : ""}
            </span>
          </>
        ) : (
          <span className="guide-hint-sub">{playing ? "…" : "未开始"}</span>
        )}
        <span className="guide-input-status">{inputStatus}</span>
      </div>
    </div>
  );
}
