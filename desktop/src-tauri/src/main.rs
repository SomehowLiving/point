use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            let capture_shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS);
            if shortcut == &capture_shortcut && event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("capture") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("spatial-capture-requested", ());
                }
            }
        }).build())
        .setup(|app| {
            let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyS);
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Spatial AI desktop shell failed");
}