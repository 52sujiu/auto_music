import { isDesktop } from "./save";

export async function vhidDriverStatus(): Promise<{ ready: boolean; bundled: boolean }> {
  if (!isDesktop()) return { ready: false, bundled: false };
  const { invoke } = await import("@tauri-apps/api/core");
  const [ready, bundled] = await Promise.all([
    invoke<boolean>("vhid_driver_status"),
    invoke<boolean>("vhid_driver_package_available"),
  ]);
  return { ready, bundled };
}

/** Bundled signed package needs one click; otherwise choose an existing signed INF package. */
export async function installVhidDriver(bundled: boolean): Promise<string | null> {
  if (!isDesktop()) throw new Error("驱动安装仅支持 Windows 桌面版");
  let infPath: string | null = null;
  if (!bundled) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({
      title: "选择已签名驱动包中的 AutoMusicVhid.inf",
      filters: [{ name: "Windows 驱动 INF", extensions: ["inf"] }],
      multiple: false,
    });
    if (typeof chosen !== "string") return null;
    infPath = chosen;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("install_vhid_driver", { infPath });
}
