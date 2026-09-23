// 导出落盘：桌面壳里走系统保存对话框，浏览器里退回 <a download>。
//
// 两条路给用户的感受不同 —— 桌面壳能自己选目录，浏览器只能进下载文件夹。

/** 是否跑在 Tauri 桌面壳里。 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 保存文本文件。
 * @param suggested 建议的文件名
 * @param contents  文件内容
 * @param filterName 保存对话框里的类型名
 * @param extension  扩展名（不含点）
 * @returns 保存成功返回 true；用户取消返回 false
 */
export async function saveTextFile(
  suggested: string,
  contents: string,
  filterName: string,
  extension: string,
): Promise<boolean> {
  if (isDesktop()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({
      defaultPath: suggested,
      filters: [{ name: filterName, extensions: [extension] }],
    });
    if (!path) return false; // 用户取消
    await invoke("save_text_file", { path, contents });
    return true;
  }

  // 浏览器回退
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggested;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
