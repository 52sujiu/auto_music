import { isDesktop } from "./save";

export type UpdateProgress = (message: string) => void;

/** Installed release builds get their repository and endpoint from the release workflow. */
export async function installAvailableUpdate(onProgress: UpdateProgress): Promise<void> {
  if (!isDesktop()) throw new Error("更新仅支持桌面版");
  if (!import.meta.env.VITE_UPDATE_REPOSITORY) {
    throw new Error("此构建未配置更新源，请从 GitHub Release 安装正式版");
  }

  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  onProgress("正在检查更新…");
  const update = await check();
  if (!update) {
    onProgress("已经是最新版本");
    return;
  }

  onProgress(`发现 ${update.version}，正在下载…`);
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event === "Progress") downloaded += event.data.chunkLength;
    if (event.event === "Finished") {
      onProgress("下载完成，正在安装…");
    } else if (total > 0) {
      onProgress(`下载更新 ${Math.min(100, Math.round(downloaded / total * 100))}%`);
    }
  });
  onProgress("更新已安装，正在重启…");
  await relaunch();
}
