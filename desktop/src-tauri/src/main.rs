use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops, DynamicImage, ImageBuffer, ImageFormat, Rgba};
use serde::Serialize;
use std::{io::Cursor, thread, time::Duration};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use xcap::Monitor;

#[derive(Clone, Serialize)]
struct DisplayInfo {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
    is_primary: bool,
}

#[derive(Clone, Serialize)]
struct NativeSource {
    application: String,
    window_title: String,
    url: String,
    displays: Vec<DisplayInfo>,
}

#[derive(Clone, Serialize)]
struct NativeCapture {
    screenshot: String,
    mime_type: String,
    source: NativeSource,
}

fn display_info(monitor: &Monitor) -> Result<DisplayInfo, String> {
    Ok(DisplayInfo {
        id: monitor.id().map_err(|error| error.to_string())?,
        name: monitor
            .friendly_name()
            .unwrap_or_else(|_| "Display".to_string()),
        x: monitor.x().map_err(|error| error.to_string())?,
        y: monitor.y().map_err(|error| error.to_string())?,
        width: monitor.width().map_err(|error| error.to_string())?,
        height: monitor.height().map_err(|error| error.to_string())?,
        scale_factor: monitor.scale_factor().unwrap_or(1.0),
        is_primary: monitor.is_primary().unwrap_or(false),
    })
}

fn encode_png(image: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Result<String, String> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    ))
}

#[cfg(target_os = "windows")]
fn foreground_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };
    unsafe {
        let window = GetForegroundWindow();
        let length = GetWindowTextLengthW(window);
        if length <= 0 {
            return String::new();
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let read = GetWindowTextW(window, &mut buffer);
        String::from_utf16_lossy(&buffer[..read as usize])
    }
}

#[cfg(not(target_os = "windows"))]
fn foreground_title() -> String {
    String::new()
}

fn capture_monitor(monitor: Monitor) -> Result<NativeCapture, String> {
    let info = display_info(&monitor)?;
    let screenshot = encode_png(monitor.capture_image().map_err(|error| error.to_string())?)?;
    Ok(NativeCapture {
        screenshot,
        mime_type: "image/png".into(),
        source: NativeSource {
            application: "Windows Desktop".into(),
            window_title: foreground_title(),
            url: String::new(),
            displays: vec![info],
        },
    })
}

#[tauri::command]
fn list_monitors() -> Result<Vec<DisplayInfo>, String> {
    Monitor::all()
        .map_err(|error| error.to_string())?
        .iter()
        .map(display_info)
        .collect()
}

#[tauri::command]
fn capture_active_monitor(window: WebviewWindow) -> Result<NativeCapture, String> {
    let cursor = window
        .cursor_position()
        .map_err(|error| error.to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    thread::sleep(Duration::from_millis(140));
    let capture = Monitor::from_point(cursor.x as i32, cursor.y as i32)
        .map_err(|error| error.to_string())
        .and_then(capture_monitor);
    let _ = window.show();
    let _ = window.maximize();
    let _ = window.set_focus();
    capture
}

#[tauri::command]
fn capture_all_monitors(window: WebviewWindow) -> Result<NativeCapture, String> {
    window.hide().map_err(|error| error.to_string())?;
    thread::sleep(Duration::from_millis(140));
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let infos: Vec<DisplayInfo> = monitors
        .iter()
        .map(display_info)
        .collect::<Result<_, _>>()?;
    let min_x = infos.iter().map(|item| item.x).min().unwrap_or(0);
    let min_y = infos.iter().map(|item| item.y).min().unwrap_or(0);
    let max_x = infos
        .iter()
        .map(|item| item.x + item.width as i32)
        .max()
        .unwrap_or(1);
    let max_y = infos
        .iter()
        .map(|item| item.y + item.height as i32)
        .max()
        .unwrap_or(1);
    let mut canvas = ImageBuffer::from_pixel(
        (max_x - min_x) as u32,
        (max_y - min_y) as u32,
        Rgba([0, 0, 0, 255]),
    );
    for (monitor, info) in monitors.into_iter().zip(infos.iter()) {
        let image = monitor.capture_image().map_err(|error| error.to_string())?;
        imageops::overlay(
            &mut canvas,
            &image,
            (info.x - min_x) as i64,
            (info.y - min_y) as i64,
        );
    }
    let capture = NativeCapture {
        screenshot: encode_png(canvas)?,
        mime_type: "image/png".into(),
        source: NativeSource {
            application: "Windows Desktop · All displays".into(),
            window_title: foreground_title(),
            url: String::new(),
            displays: infos,
        },
    };
    let _ = window.show();
    let _ = window.maximize();
    let _ = window.set_focus();
    Ok(capture)
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let capture_shortcut =
                        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS);
                    if shortcut == &capture_shortcut && event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("capture") {
                            if let Ok(capture) = capture_active_monitor(window.clone()) {
                                let _ = window.emit("spatial-native-capture", capture);
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS);
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            capture_active_monitor,
            capture_all_monitors
        ])
        .run(tauri::generate_context!())
        .expect("Spatial AI desktop shell failed");
}
