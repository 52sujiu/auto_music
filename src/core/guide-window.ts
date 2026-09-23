// 主窗侧：开/关引导窗，并把状态推给它。
//
// 只在桌面壳里可用 —— 浏览器里开不了系统级置顶窗，直接返回 false 让界面提示。

import { isDesktop } from "./save";
import { publishGuide, type GuideState } from "./guide";

const GUIDE_LABEL = "guide";

/** 引导窗是否可用（桌面壳里才有）。 */
export function guideSupported(): boolean {
  return isDesktop();
}

/** 显示引导窗；已存在就聚焦。 */
export async function openGuideWindow(): Promise<boolean> {
  if (!isDesktop()) return false;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(GUIDE_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return true;
  }
  // 8 轨下落需要更宽：每轨约 44px + 边距。悬浮窗置顶、无边框。
  new WebviewWindow(GUIDE_LABEL, {
    url: "index.html?window=guide",
    title: "引导练习",
    width: 400,
    height: 640,
    minWidth: 300,
    minHeight: 420,
    alwaysOnTop: true,
    decorations: false,
    skipTaskbar: true,
    resizable: true,
    transparent: true,
  });
  return true;
}

/** 关掉引导窗。 */
export async function closeGuideWindow(): Promise<void> {
  if (!isDesktop()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const w = await WebviewWindow.getByLabel(GUIDE_LABEL);
  if (w) await w.close();
}

/** 把引导数据推给引导窗。
 *
 * 双通道：localStorage（浏览器调试/同源共享时走 storage 事件）+
 * Tauri 事件 guide:state（桌面双 webview 的 localStorage 不互通时兜底）。
 */
export function pushGuideState(state: GuideState): void {
  publishGuide(state);
  if (!isDesktop()) return;
  void (async () => {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("guide:state", state);
    } catch {
      /* 引导窗没开时忽略 */
    }
  })();
}

/** 让引导窗退出/进入鼠标穿透（穿透后引导窗点不动，只能从主窗关）。 */
export async function setGuideThrough(through: boolean): Promise<void> {
  if (!isDesktop()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("guide:set-through", { through });
  } catch {
    /* 引导窗没开时忽略 */
  }
}

/** 让引导窗开始/停止跟着走。 */
export async function signalGuide(action: "play" | "stop", from = 0, startedAt = Date.now()): Promise<void> {
  if (!isDesktop()) return;
  const { emit } = await import("@tauri-apps/api/event");
  const speed =
    Number(localStorage.getItem("auto-music:guide-speed") ?? "1") || 1;
  // 全局广播：引导窗用 listen 收，没开窗时也安全
  await emit("guide:control", { action, speed, from, startedAt });
}
