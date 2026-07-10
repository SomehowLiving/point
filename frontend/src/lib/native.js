export const isNativeShell = () => Boolean(window.__TAURI_INTERNALS__);

export async function listenForNativeCapture(handler) {
  if (!isNativeShell()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("spatial-native-capture", (event) => handler(event.payload));
}

export async function captureNative(mode = "active") {
  if (!isNativeShell()) throw new Error("Native capture is available in the Windows app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(mode === "all" ? "capture_all_monitors" : "capture_active_monitor");
}

export async function writeClipboard(text) {
  if (isNativeShell()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    return writeText(text);
  }
  return navigator.clipboard.writeText(text);
}