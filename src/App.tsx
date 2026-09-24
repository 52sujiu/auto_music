// 主界面：选曲 → 选主旋律 → 映射 → 调度 → 自动演奏 / 导出 / 试听。
//
// 桌面版自动演奏通过系统输入或 Windows 虚拟 HID；试听仍走 Web Audio。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PianoRoll } from "./components/PianoRoll";
import { mapNotes, rangeLabel, type RawNote } from "./core/mapping";
import {
  TIMING_PRESETS,
  buildSchedule,
  diagnose,
  totalMusicTime,
} from "./core/schedule";
import { parseMidi, recommendTrack, type MidiFile } from "./core/midi";
import {
  exportFilename,
  exportSchedule,
  type ExportFormat,
} from "./core/export";
import { prepareAutoEvents, type HumanizeLevel } from "./core/humanize";
import {
  listenAutoPlayback,
  startAutoPlayback,
  stopAutoPlayback,
  type AutoPlaybackStatus,
  type PlaybackBackend,
} from "./core/desktop-playback";
import { isDesktop, saveTextFile } from "./core/save";
import { installAvailableUpdate } from "./core/updater";
import { downloadInterceptionDriver, downloadVhidDriver, interceptionDriverStatus, vhidDriverStatus } from "./core/vhid-driver";
import {
  LIBRARY,
  groupByComposer,
  loadLibraryEntry,
  type LibraryEntry,
} from "./core/library";
import {
  closeGuideWindow,
  guideSupported,
  openGuideWindow,
  pushGuideState,
  setGuideThrough,
  signalGuide,
} from "./core/guide-window";
import { buildGuideState } from "./core/guide";
import { jianpu } from "./core/mapping";

type LogKind = "info" | "ok" | "warn" | "err";
interface LogLine {
  kind: LogKind;
  text: string;
}

const TRACK_COLORS = [
  "#2f81f7",
  "#3fb950",
  "#d29922",
  "#a371f7",
  "#f85149",
  "#39c5cf",
];

export default function App() {
  const [midi, setMidi] = useState<MidiFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [activeTrack, setActiveTrack] = useState<number>(-1);
  const [baseOctave, setBaseOctave] = useState(4);
  const [forceOctave, setForceOctave] = useState(false);
  const [timingIdx, setTimingIdx] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [humanize, setHumanize] = useState<HumanizeLevel>("off");
  const [autoState, setAutoState] = useState<AutoPlaybackStatus["state"] | "idle" | "stopping">("idle");
  const [autoMessage, setAutoMessage] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const [playbackBackend, setPlaybackBackend] = useState<PlaybackBackend>(
    () => /Windows/i.test(navigator.userAgent) ? "interception" : "system",
  );
  const [trimLead, setTrimLead] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Map<number, RawNote>>(new Map());
  const [log, setLog] = useState<LogLine[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [showAbout, setShowAbout] = useState(false);
  const [zoom, setZoom] = useState(0.12);
  const [libOpen, setLibOpen] = useState(true);
  const [libFilter, setLibFilter] = useState("");
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const [libCollapsed, setLibCollapsed] = useState<Set<string>>(new Set());
  const [guideOn, setGuideOn] = useState(false);
  const [driverReady, setDriverReady] = useState(false);
  const [driverBusy, setDriverBusy] = useState(false);
  const [driverMessage, setDriverMessage] = useState("");

  useEffect(() => {
    if (!isDesktop() || !/Windows/i.test(navigator.userAgent)) return;
    void interceptionDriverStatus().then(({ ready, message }) => {
      setDriverReady(ready);
      setDriverMessage(message);
    }).catch((error) => setDriverMessage(`驱动状态检查失败：${String(error)}`));
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("guide:closed", () => setGuideOn(false)),
    ).then((release) => {
      if (disposed) release();
      else unlisten = release;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const logRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef(0);

  const appendLog = useCallback((kind: LogKind, text: string) => {
    setLog((prev) => [...prev.slice(-199), { kind, text }]);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenAutoPlayback((status) => {
      setAutoState(status.state);
      setAutoMessage(status.message);
      appendLog(status.state === "error" ? "err" : "info", status.message);
    }).then((release) => {
      if (disposed) release();
      else unlisten = release;
    }).catch((error) => appendLog("err", `播放状态监听失败：${String(error)}`));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appendLog]);

  // ---------- 选曲 ----------
  /** 载入一个已拿到的 MIDI 缓冲区。文件选择与曲目库都走这里。 */
  const loadBuffer = useCallback(
    (buf: ArrayBuffer, name: string, entryFile: string | null) => {
      try {
        const parsed = parseMidi(buf);
        setMidi(parsed);
        setFileName(name);
        setActiveEntry(entryFile);
        setEdits(new Map());
        setSelected(new Set());

        const rec = recommendTrack(parsed.tracks);
        setActiveTrack(rec);
        appendLog(
          "ok",
          `已载入 ${name}：${parsed.tracks.length} 条声轨，时长 ${parsed.duration.toFixed(1)}s`,
        );
        if (rec >= 0) {
          appendLog(
            "info",
            `推荐主旋律：${parsed.tracks[rec].name}（${parsed.tracks[rec].notes.length} 个音）`,
          );
        } else {
          appendLog("warn", "没有找到可用的旋律轨。");
        }
      } catch (err) {
        appendLog(
          "err",
          `解析失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [appendLog],
  );

  const onPickFile = async (file: File) => {
    try {
      loadBuffer(await file.arrayBuffer(), file.name, null);
    } catch (err) {
      appendLog(
        "err",
        `读取失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const openLibraryEntry = async (entry: LibraryEntry) => {
    appendLog("info", `载入曲目库：${entry.composer} ${entry.title}`);
    try {
      loadBuffer(await loadLibraryEntry(entry), entry.file, entry.file);
    } catch (err) {
      appendLog(
        "err",
        `读取失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // ---------- 取当前谱面 ----------
  const rawNotes = useMemo<RawNote[]>(() => {
    if (!midi || activeTrack < 0) return [];
    const track = midi.tracks.find((t) => t.index === activeTrack);
    if (!track) return [];
    const list = [...track.notes];
    // 手动改动只动 pitch/start/end，其余字段（通道、力度）保持原样
    for (const [i, edited] of edits) {
      if (i < list.length) list[i] = { ...list[i], ...edited };
    }
    if (!trimLead)
      return list.map((n) => ({ pitch: n.pitch, start: n.start, end: n.end }));
    // 去掉开头空拍
    const first = list.reduce((m, n) => Math.min(m, n.start), Infinity);
    if (!Number.isFinite(first) || first <= 0) {
      return list.map((n) => ({ pitch: n.pitch, start: n.start, end: n.end }));
    }
    appendLog("info", `已剪掉开头 ${first.toFixed(2)}s 空拍。`);
    return list.map((n) => ({
      pitch: n.pitch,
      start: n.start - first,
      end: n.end - first,
    }));
  }, [midi, activeTrack, edits, trimLead, appendLog]);

  const mapping = useMemo(
    () => mapNotes(rawNotes, baseOctave, forceOctave),
    [rawNotes, baseOctave, forceOctave],
  );

  const timing = TIMING_PRESETS[timingIdx];
  const events = useMemo(
    () => buildSchedule(mapping.notes, timing),
    [mapping.notes, timing],
  );
  const diag = useMemo(() => diagnose(events, timing), [events, timing]);
  const total = useMemo(() => totalMusicTime(events), [events]);

  const outOfRange = mapping.notes.filter((n) => !n.inRange).length;

  // ---------- 试听（Web Audio，不碰系统输入） ----------
  // 已排期的振荡器必须自己记下来，否则暂停/切歌时声音停不掉。
  const nodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const playheadRef = useRef(0);
  const setPlayheadBoth = useCallback((v: number) => {
    playheadRef.current = v;
    setPlayhead(v);
  }, []);

  /** 立刻让所有已排期的声音闭嘴。暂停/停止/跳转/切歌都要先调它。 */
  const silenceAudio = useCallback(() => {
    const list = nodesRef.current;
    nodesRef.current = [];
    for (const { osc, gain } of list) {
      try {
        osc.onended = null;
        gain.disconnect();
      } catch {
        /* 已释放 */
      }
      try {
        osc.stop(0);
      } catch {
        /* 已经停了 */
      }
      try {
        osc.disconnect();
      } catch {
        /* 已释放 */
      }
    }
  }, []);

  /** 彻底停止：静音 + 回到开头。 */
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    silenceAudio();
    setPlaying(false);
    setPlayheadBoth(0);
  }, [silenceAudio, setPlayheadBoth]);

  /** 暂停：静音但保留进度，下次 play 从原地继续。 */
  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    silenceAudio();
    setPlaying(false);
  }, [silenceAudio]);

  /** 从指定音乐时刻（秒）开始播；不传则从当前进度继续。 */
  const play = useCallback(
    (from?: number) => {
      if (events.length === 0) return;
      // 先把上一轮的掐掉，否则重叠播两层、永远停不掉
      cancelAnimationFrame(rafRef.current);
      silenceAudio();
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      void ctx.resume();

      const fromSec = from ?? playheadRef.current;
      // 只排 from 之后的事件：暂停继续播时前面已经响过的不重排
      const upcoming = events.filter((e) => e.t >= fromSec - 1e-6);

      // 用正弦波近似：音高 → 频率，按下抬起 → 起止
      const now = ctx.currentTime + 0.08;
      const held = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
      const fresh: { osc: OscillatorNode; gain: GainNode }[] = [];

      for (const e of upcoming) {
        const at = now + (e.t - fromSec) / speed;
        if (at < now - 0.05) continue;
        if (e.kind !== "key") continue;
        if (e.down) {
          const midiPitch =
            mapping.notes.find(
              (n) => n.key === e.key && Math.abs(n.start - e.t) < 0.5,
            )?.pitch ?? 60;
          const freq = 440 * 2 ** ((midiPitch - 69) / 12);
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, Math.max(now, at));
          gain.gain.linearRampToValueAtTime(0.18, Math.max(now, at) + 0.01);
          osc.connect(gain).connect(ctx.destination);
          osc.start(Math.max(now, at));
          held.set(e.key, { osc, gain });
          fresh.push({ osc, gain });
        } else {
          const h = held.get(e.key);
          if (h) {
            h.gain.gain.setValueAtTime(h.gain.gain.value, at);
            h.gain.gain.linearRampToValueAtTime(0, at + 0.02);
            h.osc.stop(at + 0.03);
            held.delete(e.key);
          }
        }
      }
      nodesRef.current = fresh;

      const totalSec = (total - fromSec) / speed + 0.3;
      startRef.current = performance.now();
      setPlaying(true);
      setPlayheadBoth(fromSec);
      void signalGuide("play", fromSec, Date.now() + 80);
      if (fromSec <= 0.01) {
        appendLog(
          "ok",
          `试听开始：${diag.totalNotes} 个音，约 ${totalSec.toFixed(1)}s`,
        );
      }

      const tick = () => {
        const elapsed = (performance.now() - startRef.current) / 1000;
        if (elapsed >= totalSec) {
          stop();
          appendLog("info", "试听结束。");
          return;
        }
        setPlayheadBoth(fromSec + elapsed * speed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [
      events,
      speed,
      total,
      mapping.notes,
      diag.totalNotes,
      appendLog,
      stop,
      silenceAudio,
      setPlayheadBoth,
    ],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      silenceAudio();
    },
    [silenceAudio],
  );

  // 切歌/切轨/参数大变时先静音，避免旧曲继续响
  useEffect(() => {
    silenceAudio();
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    setPlayheadBoth(0);
    void stopAutoPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName, activeTrack]);

  // ---------- 导出 ----------
  const autoBusy = autoState === "countdown" || autoState === "playing" || autoState === "stopping";

  const doUpdate = async () => {
    if (updateBusy || autoBusy) return;
    setUpdateBusy(true);
    try {
      await installAvailableUpdate(setUpdateMessage);
    } catch (error) {
      const message = `更新失败：${String(error)}`;
      setUpdateMessage(message);
      appendLog("err", message);
    } finally {
      setUpdateBusy(false);
    }
  };

  const doAutoPlay = async () => {
    if (events.length === 0) return;
    try {
      stop();
      const physical = prepareAutoEvents(mapping.notes, timing, speed, humanize);
      setAutoState("countdown");
      setAutoMessage("正在连接输入设备…");
      await startAutoPlayback(physical, playbackBackend);
    } catch (error) {
      setAutoState("error");
      setAutoMessage(`自动演奏启动失败：${String(error)}`);
      appendLog("err", `自动演奏启动失败：${String(error)}`);
    }
  };

  const doDownloadDriver = async () => {
    if (driverBusy || autoBusy) return;
    setDriverBusy(true);
    setDriverMessage(
      playbackBackend === "virtual-hid"
        ? "正在打开 libvirtualhid 官方安装包…"
        : "正在打开 Interception 官方安装包…",
    );
    try {
      const message = await (playbackBackend === "virtual-hid"
        ? downloadVhidDriver()
        : downloadInterceptionDriver());
      setDriverMessage(message);
      appendLog("ok", message);
    } catch (error) {
      const message = `打开驱动下载失败：${String(error)}`;
      setDriverMessage(message);
      appendLog("err", message);
    } finally {
      setDriverBusy(false);
    }
  };

  const doCheckDriver = async () => {
    if (driverBusy || autoBusy) return;
    setDriverBusy(true);
    setDriverMessage(
      playbackBackend === "virtual-hid"
        ? "正在检查 libvirtualhid 驱动和许可证…"
        : "正在检查 Interception 驱动…",
    );
    try {
      const status = await (playbackBackend === "virtual-hid"
        ? vhidDriverStatus()
        : interceptionDriverStatus());
      setDriverReady(status.ready);
      setDriverMessage(status.message);
    } catch (error) {
      setDriverReady(false);
      setDriverMessage(`驱动检查失败：${String(error)}`);
    } finally {
      setDriverBusy(false);
    }
  };

  const doStopAuto = async () => {
    const previousState = autoState;
    try {
      setAutoState("stopping");
      await stopAutoPlayback();
    } catch (error) {
      setAutoState(previousState);
      appendLog("err", `停止失败：${String(error)}`);
    }
  };

  const doExport = async (fmt: ExportFormat) => {
    if (events.length === 0) {
      appendLog("warn", "没有可导出的内容。");
      return;
    }
    const songName = fileName.replace(/\.[^.]+$/, "");
    const text = exportSchedule(events, fmt, songName, speed, humanize);
    const name = exportFilename(fmt, songName || "曲目");

    try {
      // 桌面壳里弹系统保存对话框（用户能自己选目录），浏览器里退回下载
      const ok = await saveTextFile(
        name,
        text,
        fmt === "ghub" ? "G HUB 脚本" : "CSV 按键表",
        fmt === "ghub" ? "lua" : "csv",
      );
      if (ok) {
        appendLog("ok", `已导出 ${name}（${events.length} 个事件，模拟演奏：${humanize === "off" ? "关闭" : humanize === "light" ? "轻微" : "自然"}）`);
      } else {
        appendLog("info", "已取消导出。");
      }
    } catch (err) {
      appendLog(
        "err",
        `导出失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // ---------- 引导练习窗 ----------
  /** 把当前事件表与音符表推给引导窗。 */
  const syncGuide = useCallback(() => {
    if (events.length === 0) return;
    const songName = fileName.replace(/\.[^.]+$/, "") || "未命名";
    pushGuideState(
      buildGuideState(events, mapping.notes, songName, baseOctave, jianpu),
    );
    localStorage.setItem("auto-music:guide-speed", String(speed));
  }, [events, mapping.notes, fileName, baseOctave, speed]);

  const toggleGuide = async () => {
    if (!guideSupported()) {
      appendLog("warn", "引导窗只在桌面版可用。用 npm run desktop 启动。");
      return;
    }
    if (guideOn) {
      await signalGuide("stop");
      await closeGuideWindow();
      setGuideOn(false);
      appendLog("info", "已关闭引导窗。");
      return;
    }
    syncGuide();
    await openGuideWindow();
    setGuideOn(true);
    // 新开的窗监听器还没注册，第一发 guide:state 会丢；补一发
    setTimeout(() => {
      syncGuide();
      if (playing) void signalGuide("play", playheadRef.current);
    }, 600);
    appendLog("ok", "引导窗已打开 —— 音符竖着落下，到红线时按提示的键。");
  };

  // 谱面/参数变了就同步给引导窗（已开着时才推）
  useEffect(() => {
    if (guideOn) syncGuide();
  }, [guideOn, syncGuide]);

  // 试听开始/暂停/停止时，让引导窗跟着走。
  // 不用 guideOn 守门：截图里出现过主窗 guideOn=false 但引导窗还开着，
  // 守门后 play 信号发不出去、引导窗永远 0.0s。emit 没人收也是安全的。
  useEffect(() => {
    if (!playing) void signalGuide("stop");
  }, [playing]);

  // 主窗按 ESC 也能退出引导窗的穿透（穿透后引导窗收不到键盘）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void setGuideThrough(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- 编辑 ----------
  const onMoveNote = useCallback(
    (idx: number, dt: number, dp: number) => {
      setEdits((prev) => {
        const next = new Map(prev);
        const base = next.get(idx) ?? rawNotes[idx];
        if (!base) return prev;
        next.set(idx, {
          pitch: Math.max(0, Math.min(127, base.pitch + dp)),
          start: Math.max(0, base.start + dt),
          end: Math.max(0.01, base.end + dt),
        });
        return next;
      });
    },
    [rawNotes],
  );

  const onSelect = useCallback((idx: number, additive: boolean) => {
    setSelected((prev) => {
      if (!additive) return new Set([idx]);
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const onClearSelection = useCallback(() => setSelected(new Set()), []);

  const deleteSelected = () => {
    if (selected.size === 0) return;
    setEdits((prev) => {
      const next = new Map(prev);
      for (const i of selected) {
        const base = next.get(i) ?? rawNotes[i];
        if (base) next.set(i, { ...base, end: base.start + 0.001 });
      }
      return next;
    });
    appendLog("info", `已删除 ${selected.size} 个音。`);
    setSelected(new Set());
  };

  const resetEdits = () => {
    setEdits(new Map());
    setSelected(new Set());
    appendLog("info", "已丢弃手动改动。");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">♪</div>
          <div>
            Auto Music
            <div className="brand-sub">口琴谱面工坊 · 自动演奏 / 导出</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        {/Windows/i.test(navigator.userAgent) && isDesktop() && (
          <>
            {updateMessage && <span className="brand-sub" role="status">{updateMessage}</span>}
            <button className="btn" onClick={() => void doUpdate()} disabled={updateBusy || autoBusy}>
              {updateBusy ? "更新中…" : "检查更新"}
            </button>
          </>
        )}
        <button className="btn" onClick={() => setShowAbout(true)}>
          说明
        </button>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="section">
            <div className="section-title">曲目</div>
            <label
              className="btn btn-primary btn-block"
              style={{ textAlign: "center" }}
            >
              打开 MIDI 文件…
              <input
                type="file"
                accept=".mid,.midi,.kar,.rmi"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            {fileName && (
              <div className="track-meta" style={{ paddingLeft: 2 }}>
                {fileName}
              </div>
            )}
          </div>

          <div className="section">
            <div
              className="section-title"
              style={{ cursor: "pointer" }}
              onClick={() => setLibOpen((v) => !v)}
            >
              <span style={{ fontSize: 10 }}>{libOpen ? "▾" : "▸"}</span>
              曲目库 · {LIBRARY.length} 首
            </div>

            {libOpen && (
              <>
                <input
                  className="input"
                  placeholder="搜索曲名或作曲家…"
                  value={libFilter}
                  onChange={(e) => setLibFilter(e.target.value)}
                />

                <div className="lib-list">
                  {groupByComposer()
                    .map((g) => ({
                      ...g,
                      items: g.items.filter((it) => {
                        const q = libFilter.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          it.title.toLowerCase().includes(q) ||
                          it.composer.toLowerCase().includes(q)
                        );
                      }),
                    }))
                    .filter((g) => g.items.length > 0)
                    .map((g) => {
                      const collapsed = libCollapsed.has(g.composer);
                      return (
                        <div key={g.composer}>
                          <div
                            className="lib-group"
                            onClick={() =>
                              setLibCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(g.composer))
                                  next.delete(g.composer);
                                else next.add(g.composer);
                                return next;
                              })
                            }
                          >
                            <span style={{ fontSize: 9 }}>
                              {collapsed ? "▸" : "▾"}
                            </span>
                            {g.composer}
                            <span style={{ marginLeft: "auto", opacity: 0.6 }}>
                              {g.items.length}
                            </span>
                          </div>
                          {!collapsed &&
                            g.items.map((it) => (
                              <div
                                key={it.file}
                                className={`lib-item${activeEntry === it.file ? " active" : ""}`}
                                onClick={() => void openLibraryEntry(it)}
                                title={it.file}
                              >
                                {it.title}
                              </div>
                            ))}
                        </div>
                      );
                    })}
                  {libFilter.trim() &&
                    groupByComposer().every((g) =>
                      g.items.every(
                        (it) =>
                          !it.title
                            .toLowerCase()
                            .includes(libFilter.trim().toLowerCase()) &&
                          !it.composer
                            .toLowerCase()
                            .includes(libFilter.trim().toLowerCase()),
                      ),
                    ) && (
                      <div
                        className="track-meta"
                        style={{ padding: "8px 4px" }}
                      >
                        没有匹配的曲目。
                      </div>
                    )}
                </div>
              </>
            )}
          </div>

          {midi && (
            <div className="section">
              <div className="section-title">声轨 · 选主旋律</div>
              {midi.tracks.map((t, i) => {
                const rec = recommendTrack(midi.tracks) === t.index;
                return (
                  <div
                    key={t.index}
                    className={`track${activeTrack === t.index ? " active" : ""}`}
                    onClick={() => {
                      setActiveTrack(t.index);
                      setEdits(new Map());
                      setSelected(new Set());
                      appendLog("info", `切到「${t.name}」，已丢弃手动改动。`);
                    }}
                  >
                    <div
                      className="track-dot"
                      style={{
                        background: TRACK_COLORS[i % TRACK_COLORS.length],
                      }}
                    />
                    <div className="track-info">
                      <div className="track-name">{t.name}</div>
                      <div className="track-meta">
                        {t.notes.length} 音 · 平均 {t.avgPitch.toFixed(0)}
                      </div>
                    </div>
                    {t.isDrum && <span className="badge badge-drum">鼓</span>}
                    {rec && !t.isDrum && (
                      <span className="badge badge-rec">推荐</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="section">
            <div className="section-title">演奏参数</div>

            <div className="field">
              <div className="field-label">
                <span>基准八度</span>
                <span className="field-value">C{baseOctave}</span>
              </div>
              <input
                type="range"
                min={1}
                max={7}
                step={1}
                value={baseOctave}
                onChange={(e) => setBaseOctave(Number(e.target.value))}
              />
              <div className="track-meta">可演奏 {rangeLabel(baseOctave)}</div>
            </div>

            <div className="field">
              <div className="field-label">
                <span>速度</span>
                <span className="field-value">{Math.round(speed * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={3}
                step={0.05}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
            </div>

            <div className="field">
              <div className="field-label">
                <span>输入时序档位</span>
              </div>
              <select
                className="select"
                value={timingIdx}
                onChange={(e) => setTimingIdx(Number(e.target.value))}
              >
                {TIMING_PRESETS.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}（帧 {p.frameMs}ms · 修饰 {p.modLeadMs}ms）
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <div className="field-label"><span>模拟演奏</span></div>
              <select
                className="select"
                value={humanize}
                onChange={(e) => setHumanize(e.target.value as HumanizeLevel)}
              >
                <option value="off">关闭（原始时序）</option>
                <option value="light">轻微（按下 0–8ms）</option>
                <option value="natural">自然（按下 0–18ms）</option>
              </select>
              <div className="track-meta">自动演奏与导出均适用；不能保证避开检测。</div>
            </div>

            <label className="check">
              <input
                type="checkbox"
                checked={forceOctave}
                onChange={(e) => setForceOctave(e.target.checked)}
              />
              折八度（音域外的音挪整八度）
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={trimLead}
                onChange={(e) => setTrimLead(e.target.checked)}
              />
              去除开头空拍
            </label>
          </div>

          <div className="section">
            <div className="section-title">谱面</div>
            <div className="btn-row">
              <button
                className="btn"
                onClick={deleteSelected}
                disabled={selected.size === 0}
              >
                删除选中
              </button>
              <button
                className="btn"
                onClick={resetEdits}
                disabled={edits.size === 0}
              >
                撤销改动
              </button>
            </div>
            <div className="track-meta" style={{ paddingLeft: 2 }}>
              拖动音符改时间与音高 · Shift 多选
            </div>
          </div>

          <div className="section">
            <div className="section-title">自动演奏</div>
            {/Windows/i.test(navigator.userAgent) && (
              <div className="field">
                <label className="field-label" htmlFor="playback-backend">输入方式</label>
                <select className="select" id="playback-backend" value={playbackBackend}
                  onChange={(event) => setPlaybackBackend(event.target.value as PlaybackBackend)}
                  disabled={autoBusy}>
                  <option value="interception">Interception（免费）</option>
                  <option value="virtual-hid">虚拟 HID（付费）</option>
                  <option value="system">系统模拟输入</option>
                </select>
              </div>
            )}
            {/Windows/i.test(navigator.userAgent) && playbackBackend === "virtual-hid" && (
              <>
                <div className="btn-row">
                  <span className="track-meta">驱动：{driverReady ? "已就绪" : "未就绪"}</span>
                  <button className="btn" onClick={() => void doDownloadDriver()}
                    disabled={!isDesktop() || driverBusy || autoBusy}>
                    下载官方驱动
                  </button>
                  <button className="btn" onClick={() => void doCheckDriver()}
                    disabled={!isDesktop() || driverBusy || autoBusy}>
                    {driverBusy ? "检查中…" : "检查驱动"}
                  </button>
                </div>
                <div className="track-meta" style={{ lineHeight: 1.5 }}>
                  {driverMessage ||
                    (playbackBackend === "virtual-hid"
                      ? "安装 libvirtualhid 官方 MSI 并激活许可证后，点击检查驱动。"
                      : "解压 Interception 官方 zip，管理员运行 Install-interception.exe /install 并重启后，点击检查驱动；再把 x64/interception.dll 放到程序 driver 目录同名位置。")}
                </div>
              </>
            )}
            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={() => void doAutoPlay()}
                disabled={!isDesktop() || !events.length || autoBusy}
              >
                ▶ 开始
              </button>
              <button
                className="btn"
                onClick={() => void doStopAuto()}
                disabled={!autoBusy || autoState === "stopping"}
              >
                ■ 停止
              </button>
            </div>
            <div className="track-meta" style={{ paddingLeft: 2, lineHeight: 1.6 }}>
              {autoMessage || "桌面版可用。开始后有 5 秒切换目标窗口；可用时按 F8 停止。"}
            </div>
          </div>

          <div className="section">
            <div className="section-title">导出按键脚本</div>
            <button
              className="btn btn-block"
              onClick={() => doExport("ghub")}
              disabled={!events.length}
            >
              罗技 G HUB（.lua）
            </button>
            <button
              className="btn btn-block"
              onClick={() => doExport("csv")}
              disabled={!events.length}
            >
              通用 CSV
            </button>
            <div
              className="track-meta"
              style={{ paddingLeft: 2, lineHeight: 1.6 }}
            >
              导出文件供宏软件使用；自动演奏可直接发送输入。
            </div>
          </div>
        </aside>

        <div className="workspace">
          {midi ? (
            activeTrack < 0 ? (
              <div className="empty">
                <div className="empty-hint">这个文件里没有可演奏的旋律轨。</div>
              </div>
            ) : (
              <PianoRoll
                notes={mapping.notes}
                duration={total}
                secondsPerPx={zoom}
                playhead={playhead}
                selected={selected}
                onSelect={onSelect}
                onClearSelection={onClearSelection}
                onSeek={(s) => {
                  // 跳转先静音：否则旧排期继续响，新排期又起一层
                  if (playing) play(s);
                  else {
                    pause();
                    setPlayheadBoth(s);
                  }
                }}
                onMoveNote={onMoveNote}
              />
            )
          ) : (
            <div className="empty">
              <div className="empty-icon">♪</div>
              <div className="empty-hint">
                打开一个 MIDI 文件开始。
                <br />
                支持 .mid / .midi / .kar / .rmi。
                <br />
                载入后在左侧选一行作为主旋律。
              </div>
            </div>
          )}

          {midi && activeTrack >= 0 && (
            <div className="transport">
              <button
                className="btn btn-primary"
                onClick={playing ? pause : () => play()}
                disabled={events.length === 0}
                style={{ minWidth: 84 }}
                title={playing ? "暂停（保留进度）" : "试听 / 继续"}
              >
                {playing ? "⏸ 暂停" : playhead > 0.01 ? "▶ 继续" : "▶ 试听"}
              </button>
              {(playing || playhead > 0.01) && (
                <button
                  className="btn"
                  onClick={stop}
                  title="彻底停止并回到开头"
                >
                  ■
                </button>
              )}
              <button
                className="btn"
                onClick={toggleGuide}
                disabled={events.length === 0}
                title={
                  guideSupported()
                    ? "开一个置顶窗口，音符竖着落下提示该按哪个键"
                    : "只在桌面版可用（npm run desktop）"
                }
              >
                {guideOn ? "■ 关引导" : "↓ 引导练习"}
              </button>
              {guideOn && (
                <button
                  className="btn"
                  onClick={() => void setGuideThrough(false)}
                  title="引导窗穿透后点不动？点这里退出穿透（ESC 也行）"
                >
                  取消穿透
                </button>
              )}
              <div
                className="progress-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  const s = ratio * total;
                  if (playing) play(s);
                  else {
                    pause();
                    setPlayheadBoth(s);
                  }
                }}
              >
                <div
                  className="progress-fill"
                  style={{
                    width: `${total > 0 ? (playhead / total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="time-display">
                {playhead.toFixed(1)} / {total.toFixed(1)}s
              </div>
              <div className="field" style={{ width: 120 }}>
                <input
                  type="range"
                  min={0.03}
                  max={0.6}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  title="缩放"
                />
              </div>
            </div>
          )}

          <div className="log" ref={logRef}>
            {log.length === 0 ? (
              <div className="log-line">就绪。打开一个 MIDI 文件开始。</div>
            ) : (
              log.map((l, i) => (
                <div key={i} className={`log-line ${l.kind}`}>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <footer className="footer">
        {midi ? (
          <>
            <span>音符 {mapping.notes.length}</span>
            <span>可演奏 {mapping.notes.length - outOfRange}</span>
            {outOfRange > 0 && <span>超范围 {outOfRange}</span>}
            <span>事件 {events.length}</span>
            <span>时长 {total.toFixed(1)}s</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
              <span className={diag.modLeadTooShort === 0 ? "" : "warn"}>
                修饰不足 {diag.modLeadTooShort}
              </span>
              <span className={diag.retriggerTooShort === 0 ? "" : "warn"}>
                重触发过密 {diag.retriggerTooShort}
              </span>
              <span className={diag.minHoldTooShort === 0 ? "" : "warn"}>
                按持不足 {diag.minHoldTooShort}
              </span>
            </span>
          </>
        ) : (
          <span>未载入曲目</span>
        )}
      </footer>

      {showAbout && (
        <div className="modal-backdrop" onClick={() => setShowAbout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">关于这个工具</h3>
            <div className="modal-body">
              <p>把 MIDI 谱面映射到口琴键位，桌面版可直接演奏，也可导出按键脚本。</p>
              <p>
                <strong>它做什么</strong>
              </p>
              <ul>
                <li>解析 MIDI，选主旋律轨</li>
                <li>音高 → 键位 / 八度 / 升半音映射</li>
                <li>按帧采样下的时序调度（防漏音）</li>
                <li>桌面版直接自动演奏，或导出 G HUB Lua / 通用 CSV</li>
                <li>Web Audio 试听，不碰系统输入</li>
              </ul>
              <p>
                <strong>使用范围</strong>
              </p>
              <ul>
                <li>自动演奏发送键盘与鼠标事件；Windows 可选择虚拟 HID。</li>
                <li>模拟演奏只改变时间间隔，不保证避开检测。</li>
              </ul>
              <p>
                请在允许自动化的练习、单机或自定义场景使用。
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => setShowAbout(false)}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
