// 导出：把事件表变成外部宏软件能用的按键脚本。
//
// 这一模块只产出脚本；桌面自动演奏由 Rust 后端负责。
// 导出与试听共用原始调度；可选的模拟演奏只作用于导出时间线。

import type { ScheduledEvent } from "./schedule";
import {
  preparePhysicalEvents,
  type HumanizeLevel,
  type PhysicalEvent,
} from "./humanize";

export type ExportFormat = "ghub" | "csv";

/** 内部按键字符 → G HUB Lua 的按键名。 */
function luaKeyName(key: string): string {
  const map: Record<string, string> = {
    Z: "z",
    X: "x",
    C: "c",
    V: "v",
    B: "b",
    N: "n",
    M: "m",
    ",": "comma",
  };
  return map[key] ?? key.toLowerCase();
}

/** 鼠标事件 → 中文说明（日志与 CSV 里用）。 */
function mouseName(kind: ScheduledEvent["kind"]): string {
  switch (kind) {
    case "mouse-left":
      return "左键";
    case "mouse-right":
      return "右键";
    default:
      return "中键";
  }
}

/**
 * 生成罗技 G HUB 的 Lua 脚本。
 * 用官方脚本 API：PressKey / ReleaseKey / PressMouseButton / ReleaseMouseButton / Sleep。
 */
function buildLua(
  events: readonly PhysicalEvent[],
  songName: string,
  speed: number,
  humanize: HumanizeLevel,
): string {
  const lines: string[] = [];
  const escape = (s: string) =>
    s.replace(/[\r\n]+/g, " ").replace(/--/g, "- -");

  lines.push("-- 由 Auto Music 生成");
  lines.push(`-- 曲目：${escape(songName || "未命名")}`);
  lines.push(`-- 速度：${Math.round(speed * 100)}%`);
  lines.push(`-- 模拟演奏：${humanize === "off" ? "关闭" : humanize === "light" ? "轻微" : "自然"}`);
  lines.push(
    "-- 用法：G HUB → 游戏与应用程序 → 脚本 → 编辑脚本 → 粘贴全文 → 保存",
  );
  lines.push("-- 注意：按住 W/A/S/D 时键盘矩阵会吞掉部分音键，这是硬件限制。");
  lines.push("");
  lines.push("local last = 0");
  lines.push("");
  lines.push("function OnEvent(event, arg)");
  lines.push('  if event == "PROFILE_ACTIVATED" then');
  lines.push("    last = 0");
  lines.push("    return");
  lines.push("  end");
  lines.push('  if event ~= "MOUSE_BUTTON_PRESSED" or arg ~= 4 then');
  lines.push("    return");
  lines.push("  end");
  lines.push("");

  let prev = 0;
  for (const e of events) {
    const at = Math.round(e.atMs);
    const gap = Math.max(0, at - prev);
    prev = at;
    if (gap > 0) lines.push(`  Sleep(${gap})`);
    if (e.kind === "key") {
      lines.push(
        `  ${e.down ? "PressKey" : "ReleaseKey"}("${luaKeyName(e.key)}")`,
      );
    } else {
      const btn =
        e.kind === "mouse-left" ? 1 : e.kind === "mouse-right" ? 3 : 2;
      lines.push(
        `  ${e.down ? "PressMouseButton" : "ReleaseMouseButton"}(${btn})`,
      );
    }
  }

  lines.push("");
  lines.push("  Sleep(50)");
  lines.push("end");
  lines.push("");
  return lines.join("\n");
}

/** 生成通用 CSV：时刻(ms),动作,按键。 */
function buildCsv(events: readonly PhysicalEvent[]): string {
  const rows = ["时刻(毫秒),动作,按键/按钮"];
  for (const e of events) {
    const action = e.down ? "按下" : "抬起";
    const what = e.kind === "key" ? e.key : `鼠标${mouseName(e.kind)}`;
    rows.push(`${Math.round(e.atMs)},${action},${what}`);
  }
  return rows.join("\n") + "\n";
}

/** 按格式导出。 */
export function exportSchedule(
  events: ScheduledEvent[],
  format: ExportFormat,
  songName = "",
  speed = 1,
  humanize: HumanizeLevel = "off",
): string {
  const physical = preparePhysicalEvents(events, speed, humanize);
  return format === "ghub"
    ? buildLua(physical, songName, speed, humanize)
    : buildCsv(physical);
}

/** 导出文件的建议名字。 */
export function exportFilename(format: ExportFormat, songName: string): string {
  const base = (songName || "曲目").replace(/[\\/:*?"<>|]/g, "_");
  return `${base}.${format === "ghub" ? "lua" : "csv"}`;
}
