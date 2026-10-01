use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops, DynamicImage, ImageBuffer, ImageFormat, Rgba, RgbaImage};
use serde::Serialize;
use std::{env, fs, io::Cursor, path::Path, process, sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use xcap::Monitor;

#[derive(Clone, Serialize, serde::Deserialize)]
struct DisplayInfo {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
    is_primary: bool,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
    capture_scale_x: Option<f32>,
    capture_scale_y: Option<f32>,
    metadata_matches_capture: Option<bool>,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct NativeSource {
    application: String,
    window_title: String,
    url: String,
    displays: Vec<DisplayInfo>,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct NativeCapture {
    screenshot: String,
    mime_type: String,
    source: NativeSource,
}

#[derive(Serialize)]
struct VirtualBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
struct SeamCheck {
    first_display: u32,
    second_display: u32,
    orientation: String,
    edge_delta_pixels: i32,
    overlap_pixels: i32,
    passed: bool,
}

#[derive(Serialize)]
struct HardwareReport {
    schema_version: u8,
    platform: String,
    per_monitor_v2: bool,
    mixed_dpi_detected: bool,
    displays: Vec<DisplayInfo>,
    virtual_bounds: VirtualBounds,
    seams: Vec<SeamCheck>,
    stitched_screenshot: String,
    passed: bool,
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
        capture_width: None,
        capture_height: None,
        capture_scale_x: None,
        capture_scale_y: None,
        metadata_matches_capture: None,
    })
}

fn apply_capture_metrics(mut info: DisplayInfo, image: &RgbaImage) -> DisplayInfo {
    info.capture_width = Some(image.width());
    info.capture_height = Some(image.height());
    info.capture_scale_x = Some(image.width() as f32 / info.width.max(1) as f32);
    info.capture_scale_y = Some(image.height() as f32 / info.height.max(1) as f32);
    info.metadata_matches_capture = Some(
        (image.width() as i64 - info.width as i64).abs() <= 2
            && (image.height() as i64 - info.height as i64).abs() <= 2,
    );
    info
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
    let image = monitor.capture_image().map_err(|error| error.to_string())?;
    let info = apply_capture_metrics(display_info(&monitor)?, &image);
    let screenshot = encode_png(image)?;
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

fn capture_virtual_desktop() -> Result<(RgbaImage, Vec<DisplayInfo>, VirtualBounds), String> {
    let monitors = Monitor::all().map_err(|error| error.to_string())?;
    let mut captures = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let image = monitor.capture_image().map_err(|error| error.to_string())?;
        let info = apply_capture_metrics(display_info(&monitor)?, &image);
        captures.push((info, image));
    }
    if captures.is_empty() {
        return Err("No Windows displays were detected".into());
    }

    let min_x = captures.iter().map(|(info, _)| info.x).min().unwrap_or(0);
    let min_y = captures.iter().map(|(info, _)| info.y).min().unwrap_or(0);
    let max_x = captures
        .iter()
        .map(|(info, image)| info.x + image.width() as i32)
        .max()
        .unwrap_or(1);
    let max_y = captures
        .iter()
        .map(|(info, image)| info.y + image.height() as i32)
        .max()
        .unwrap_or(1);
    let bounds = VirtualBounds {
        x: min_x,
        y: min_y,
        width: (max_x - min_x).max(1) as u32,
        height: (max_y - min_y).max(1) as u32,
    };
    let mut canvas = ImageBuffer::from_pixel(bounds.width, bounds.height, Rgba([0, 0, 0, 255]));
    let mut infos = Vec::with_capacity(captures.len());
    for (info, image) in captures {
        imageops::overlay(
            &mut canvas,
            &image,
            (info.x - min_x) as i64,
            (info.y - min_y) as i64,
        );
        infos.push(info);
    }
    Ok((canvas, infos, bounds))
}

fn seam_checks(displays: &[DisplayInfo]) -> Vec<SeamCheck> {
    let mut checks = Vec::new();
    for first_index in 0..displays.len() {
        for second_index in (first_index + 1)..displays.len() {
            let first = &displays[first_index];
            let second = &displays[second_index];
            let first_width = first.capture_width.unwrap_or(first.width) as i32;
            let first_height = first.capture_height.unwrap_or(first.height) as i32;
            let second_width = second.capture_width.unwrap_or(second.width) as i32;
            let second_height = second.capture_height.unwrap_or(second.height) as i32;
            let vertical_overlap =
                (first.y + first_height).min(second.y + second_height) - first.y.max(second.y);
            let horizontal_overlap =
                (first.x + first_width).min(second.x + second_width) - first.x.max(second.x);
            if vertical_overlap > 0 {
                let delta = ((first.x + first_width) - second.x)
                    .abs()
                    .min(((second.x + second_width) - first.x).abs());
                if delta <= 8 {
                    checks.push(SeamCheck {
                        first_display: first.id,
                        second_display: second.id,
                        orientation: "vertical".into(),
                        edge_delta_pixels: delta,
                        overlap_pixels: vertical_overlap,
                        passed: delta <= 2,
                    });
                }
            }
            if horizontal_overlap > 0 {
                let delta = ((first.y + first_height) - second.y)
                    .abs()
                    .min(((second.y + second_height) - first.y).abs());
                if delta <= 8 {
                    checks.push(SeamCheck {
                        first_display: first.id,
                        second_display: second.id,
                        orientation: "horizontal".into(),
                        edge_delta_pixels: delta,
                        overlap_pixels: horizontal_overlap,
                        passed: delta <= 2,
                    });
                }
            }
        }
    }
    checks
}

fn write_hardware_report(report_path: &Path, per_monitor_v2: bool) -> Result<bool, String> {
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let (canvas, displays, bounds) = capture_virtual_desktop()?;
    let screenshot_path = report_path.with_extension("png");
    DynamicImage::ImageRgba8(canvas)
        .save(&screenshot_path)
        .map_err(|error| error.to_string())?;
    let seams = seam_checks(&displays);
    let mixed_dpi_detected = displays.iter().enumerate().any(|(index, display)| {
        displays
            .iter()
            .skip(index + 1)
            .any(|other| (display.scale_factor - other.scale_factor).abs() > 0.05)
    });
    let metadata_passed = displays
        .iter()
        .all(|display| display.metadata_matches_capture == Some(true));
    let seam_passed =
        displays.len() <= 1 || (!seams.is_empty() && seams.iter().all(|seam| seam.passed));
    let passed = per_monitor_v2 && metadata_passed && seam_passed;
    let report = HardwareReport {
        schema_version: 1,
        platform: env::consts::OS.into(),
        per_monitor_v2,
        mixed_dpi_detected,
        displays,
        virtual_bounds: bounds,
        seams,
        stitched_screenshot: screenshot_path.to_string_lossy().into_owned(),
        passed,
    };
    fs::write(
        report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(passed)
}

#[cfg(target_os = "windows")]
fn enable_per_monitor_v2() -> bool {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).is_ok() }
}

#[cfg(not(target_os = "windows"))]
fn enable_per_monitor_v2() -> bool {
    true
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
    let (canvas, infos, _) = capture_virtual_desktop()?;
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

/// Latest frozen-screen snip, kept so the overlay can pull it on mount if it missed the event.
#[derive(Default)]
struct SnipState(Mutex<Option<NativeCapture>>);

/// Snipping-Tool-style flow: freeze the monitor under the cursor, then cover exactly that monitor
/// with the borderless "snip" overlay showing the frozen frame, so selection happens in place.
fn start_snip(app: &AppHandle) -> Result<(), String> {
    let snip = app
        .get_webview_window("snip")
        .ok_or("snip overlay window is missing")?;
    if snip.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let cursor = snip.cursor_position().map_err(|error| error.to_string())?;
    let monitor = Monitor::from_point(cursor.x as i32, cursor.y as i32)
        .map_err(|error| error.to_string())?;
    let (x, y) = (
        monitor.x().map_err(|error| error.to_string())?,
        monitor.y().map_err(|error| error.to_string())?,
    );
    let capture = capture_monitor(monitor)?;
    let (width, height) = capture
        .source
        .displays
        .first()
        .map(|display| {
            (
                display.capture_width.unwrap_or(display.width),
                display.capture_height.unwrap_or(display.height),
            )
        })
        .unwrap_or((1920, 1080));
    *app.state::<SnipState>().0.lock().unwrap() = Some(capture.clone());
    snip.set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    snip.set_size(PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    snip.emit("spatial-snip-capture", capture)
        .map_err(|error| error.to_string())?;
    snip.show().map_err(|error| error.to_string())?;
    let _ = snip.set_always_on_top(true);
    let _ = snip.set_focus();
    Ok(())
}

#[tauri::command]
fn get_snip_capture(state: State<SnipState>) -> Option<NativeCapture> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn close_snip(app: AppHandle, state: State<SnipState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    if let Some(snip) = app.get_webview_window("snip") {
        snip.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Hand a snip (with the user's selection) to the full Point workspace for the heavier tools.
#[tauri::command]
fn open_snip_in_point(app: AppHandle, capture: serde_json::Value) -> Result<(), String> {
    if let Some(snip) = app.get_webview_window("snip") {
        let _ = snip.hide();
    }
    let window = app
        .get_webview_window("capture")
        .ok_or("capture window is missing")?;
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.maximize();
    let _ = window.set_focus();
    window
        .emit("spatial-native-capture", capture)
        .map_err(|error| error.to_string())
}

fn main() {
    let dpi_enabled = enable_per_monitor_v2();
    if let Some(index) = env::args().position(|argument| argument == "--hardware-report") {
        let arguments: Vec<String> = env::args().collect();
        let Some(path) = arguments.get(index + 1) else {
            process::exit(2)
        };
        match write_hardware_report(Path::new(path), dpi_enabled) {
            Ok(true) => process::exit(0),
            Ok(false) => process::exit(3),
            Err(error) => {
                eprintln!("{error}");
                process::exit(2);
            }
        }
    }
    if !dpi_enabled {
        eprintln!("Per-Monitor V2 DPI awareness could not be enabled");
    }
    tauri::Builder::default()
        .manage(SnipState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let capture_shortcut =
                        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS);
                    if shortcut == &capture_shortcut && event.state() == ShortcutState::Pressed {
                        if let Err(error) = start_snip(app) {
                            eprintln!("snip failed: {error}");
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
            capture_all_monitors,
            get_snip_capture,
            close_snip,
            open_snip_in_point
        ])
        .run(tauri::generate_context!())
        .expect("Spatial AI desktop shell failed");
}
