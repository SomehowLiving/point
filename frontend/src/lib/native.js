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
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    return await navigator.clipboard.writeText(text);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard permission was denied. Use the download button instead.");
  }
}