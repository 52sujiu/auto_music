import { isDesktop } from "./save";

export type VhidDriverStatus = { ready: boolean; message: string };

export async function vhidDriverStatus(): Promise<VhidDriverStatus> {
  if (!isDesktop()) return { ready: false, message: "驱动检查仅支持桌面版" };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<VhidDriverStatus>("vhid_driver_status");
}

/** Open the official LizardByte MSI download; no third-party driver is bundled. */
export async function downloadVhidDriver(): Promise<string> {
  if (!isDesktop()) throw new Error("驱动下载仅支持桌面版");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("download_vhid_driver");
}
