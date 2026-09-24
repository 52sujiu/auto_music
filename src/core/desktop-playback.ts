import { isDesktop } from "./save";
import type { PhysicalEvent } from "./humanize";

export type AutoPlaybackStatus = {
  state: "countdown" | "playing" | "stopped" | "finished" | "error";
  message: string;
};

export type PlaybackBackend = "system" | "virtual-hid" | "interception";

export async function listenAutoPlayback(
  callback: (status: AutoPlaybackStatus) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<AutoPlaybackStatus>("auto-playback:status", (event) => callback(event.payload));
}

export async function startAutoPlayback(
  events: readonly PhysicalEvent[], backend: PlaybackBackend = "system",
): Promise<boolean> {
  if (!isDesktop()) throw new Error("自动演奏只支持桌面版");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("start_playback", { events, countdownMs: 5000, backend });
}

export async function stopAutoPlayback(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_playback");
}
