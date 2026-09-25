
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, ChildStdout, Command}, sync::Mutex};

#[derive(Deserialize, Serialize)]
struct ApiRequest { url: String, method: String, body: Option<Value> }
#[derive(Serialize)]
struct ApiResponse { status: u16, data: Value }
#[derive(Deserialize)]
struct BackendResponse { status: u16, data: Value, session: Option<Value>, #[serde(default)] clear_session: bool }
struct Backend { _child: Child, input: ChildStdin, output: BufReader<ChildStdout> }
#[derive(Default)]
struct Runtime { backend: Option<Backend>, session: Option<Value>, loaded: bool, updating: bool }
#[derive(Default)]
struct AppState(Mutex<Runtime>);

#[tauri::command]
async fn new_app_window(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    open_window(app, state, None).await
}

async fn open_window(app: tauri::AppHandle, state: State<'_, AppState>, file: Option<PathBuf>) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
    let runtime = state.0.lock().await;
    if runtime.updating { return Err(error("Vänta tills uppdateringen är klar.")); }
    let label = format!("editor-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    if let Some(file) = file { crate::local_files::queue_launch_file(&label, file); }
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("nand — Notes and more").inner_size(1250.0, 830.0).min_inner_size(760.0, 540.0)
        .build().map_err(|_| { crate::local_files::forget_window(&label); error("Kunde inte öppna ett nytt fönster.") })?;
    Ok(())
}

fn error(message: &str) -> String { message.to_owned() }
fn credential(app: &tauri::AppHandle) -> Result<keyring::Entry, String> {
    // Match the app's data namespace, including separately identified verification builds.
    keyring::Entry::new(&app.config().identifier, "github-session").map_err(|_| error("Kunde inte öppna datorns säkra inloggningslagring."))
}
fn node_path() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/gitbsidian-node-x86_64-pc-windows-msvc.exe"));
    }
    Ok(std::env::current_exe().map_err(|_| error("Kunde inte hitta appens sökväg."))?.with_file_name(if cfg!(windows) { "gitbsidian-node.exe" } else { "gitbsidian-node" }))
}
fn start_backend(app: &tauri::AppHandle) -> Result<Backend, String> {
    let data_dir = app.path().app_local_data_dir().map_err(|_| error("Kunde inte hitta appens datamapp."))?;
    std::fs::create_dir_all(&data_dir).map_err(|_| error("Kunde inte skapa appens datamapp."))?;
    let script = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/backend.cjs") }
        else { app.path().resource_dir().map_err(|_| error("Appens resurser saknas."))?.join("resources/backend.cjs") };
    let mut command = Command::new(node_path()?);
    command.arg(script).arg(&data_dir).current_dir(&data_dir).env_clear();
    // No NODE_OPTIONS, proxy, Git tracing or user-supplied startup scripts inherited.
    for name in ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "ProgramFiles", "PROGRAMFILES(X86)"] {
        if let Some(value) = std::env::var_os(name) { command.env(name, value); }
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|_| error("Synkningsdelen kunde inte startas. Dina lokala utkast finns kvar."))?;
    let input = child.stdin.take().ok_or_else(|| error("Kunde inte öppna synkningen."))?;
    let output = BufReader::new(child.stdout.take().ok_or_else(|| error("Kunde inte läsa synkningen."))?);
    Ok(Backend { _child: child, input, output })
}
async fn exchange(backend: &mut Backend, message: Value) -> Result<BackendResponse, String> {
    let mut bytes = serde_json::to_vec(&message).map_err(|_| error("Ogiltigt anrop."))?;
    bytes.push(b'\n');
    backend.input.write_all(&bytes).await.map_err(|_| error("Synkningen avbröts. Kontrollera sparningen innan du försöker igen."))?;
    backend.input.flush().await.map_err(|_| error("Synkningen avbröts."))?;
    let mut line = String::new();
    backend.output.read_line(&mut line).await.map_err(|_| error("Synkningens svar kunde inte läsas."))?;
    if line.len() > 16 * 1024 * 1024 { return Err(error("Svaret är för stort.")); }
    serde_json::from_str(&line).map_err(|_| error("Synkningen avbröts. Utkasten finns kvar; kontrollera sparningen."))
}

#[tauri::command]
async fn backend_request(app: tauri::AppHandle, state: State<'_, AppState>, request: ApiRequest) -> Result<ApiResponse, String> {
    if !request.url.starts_with("/api/") || request.url.len() > 4096 || !["GET", "POST", "PUT"].contains(&request.method.as_str()) || request.body.as_ref().is_some_and(|b| b.to_string().len() > 2 * 1024 * 1024) {
        return Err(error("Ogiltigt appanrop."));
    }
    let mut runtime = state.0.lock().await;
    if runtime.updating { return Err(error("Appen förbereder en uppdatering. Utkasten finns kvar.")); }
    if !runtime.loaded {
        match credential(&app)?.get_password() {
            Ok(raw) => runtime.session = serde_json::from_str(&raw).ok(),
            Err(keyring::Error::NoEntry) => {},
            Err(_) => return Err(error("Kunde inte läsa den sparade inloggningen. Den lokala skrivytan fungerar fortfarande.")),
        }
        runtime.loaded = true;
    }
    if runtime.backend.is_none() { runtime.backend = Some(start_backend(&app)?); }
    let message = json!({ "request": request, "session": runtime.session });
    let result = tokio::time::timeout(Duration::from_secs(180), exchange(runtime.backend.as_mut().unwrap(), message)).await;
    let reply = match result {
        Ok(Ok(reply)) => reply,
        other => { runtime.backend = None; return Err(match other { Ok(Err(message)) => message, _ => error("Synkningen tog för lång tid. Utkasten finns kvar; kontrollera sparningen.") }); }
    };
    // Secret fields are consumed here and never serialized into the WebView response.
    if reply.clear_session {
        match credential(&app)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => {}, Err(_) => return Err(error("Kunde inte ta bort den sparade inloggningen. Försök igen.")) }
        runtime.session = None;
    }
    if let Some(session) = reply.session {
        credential(&app)?.set_password(&session.to_string()).map_err(|_| error("Inloggningen kunde inte sparas säkert. Försök igen."))?;
        runtime.session = Some(session);
    }
    Ok(ApiResponse { status: reply.status, data: reply.data })
}

#[tauri::command]
async fn export_markdown(app: tauri::AppHandle, name: String, text: String) -> Result<bool, String> {
    if text.len() > 1024 * 1024 || name.len() > 240 || name.contains(['/', '\\', '\0']) { return Err(error("Ogiltigt filnamn eller för stor anteckning.")); }
    tauri::async_runtime::spawn_blocking(move || {
        let is_csv = name.to_lowercase().ends_with(".csv");
        let is_txt = name.to_lowercase().ends_with(".txt");
        let Some(file) = app.dialog().file().add_filter(if is_csv { "CSV" } else if is_txt { "Text" } else { "Markdown" }, if is_csv { &["csv"] } else if is_txt { &["txt"] } else { &["md"] }).set_file_name(name).blocking_save_file() else { return Ok(false); };
        let path = file.into_path().map_err(|_| error("Ogiltig filsökväg."))?;
        std::fs::write(path, text.as_bytes()).map_err(|_| error("Kunde inte exportera filen. Utkastet finns kvar."))?;
        Ok(true)
    }).await.map_err(|_| error("Kunde inte öppna fildialogen."))?
}

#[tauri::command]
async fn prepare_app_update(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut runtime = state.0.lock().await;
    if app.webview_windows().len() > 1 { return Err(error("Stäng de andra nand-fönstren innan du installerar uppdateringen. Deras arbete sparas när de stängs.")); }
    if let Some(backend) = runtime.backend.as_mut() {
        backend._child.kill().await.map_err(|_| error("Kunde inte stänga synkningen inför uppdateringen."))?;
    }
    runtime.backend = None;
    runtime.updating = true;
    Ok(())
}

#[tauri::command]
async fn export_image(app: tauri::AppHandle, name: String, data_url: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (header, encoded) = data_url.split_once(',').ok_or_else(|| error("Ogiltig bilddata."))?;
        let extension = match header { "data:image/png;base64" => "png", "data:image/jpeg;base64" => "jpg", "data:image/webp;base64" => "webp", "data:image/gif;base64" => "gif", "data:image/bmp;base64" => "bmp", _ => return Err(error("Bildformatet stöds inte.")) };
        let stem = std::path::Path::new(&name).file_stem().and_then(|v| v.to_str()).unwrap_or("bild");
        let filename = format!("{stem}.{extension}");
        let Some(file) = app.dialog().file().add_filter("Bild", &["png", "jpg", "jpeg", "webp", "gif", "bmp"]).set_file_name(filename).blocking_save_file() else { return Ok(false); };
        let path = file.into_path().map_err(|_| error("Ogiltig filsökväg."))?;
        let bytes = decode_base64(encoded)?;
        std::fs::write(path, bytes).map_err(|_| error("Kunde inte exportera bildfilen."))?;
        Ok(true)
    }).await.map_err(|_| error("Kunde inte öppna fildialogen."))?
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(value.len() * 3 / 4); let mut acc = 0u32; let mut bits = 0u8;
    for byte in value.bytes() { let digit = match byte { b'A'..=b'Z' => byte - b'A', b'a'..=b'z' => byte - b'a' + 26, b'0'..=b'9' => byte - b'0' + 52, b'+' => 62, b'/' => 63, b'=' => break, b'\r' | b'\n' | b' ' => continue, _ => return Err(error("Ogiltig bilddata.")) }; acc = (acc << 6) | digit as u32; bits += 6; if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; } }
    Ok(out)
}

#[tauri::command]
async fn resume_after_update_error(state: State<'_, AppState>) -> Result<(), String> {
    state.0.lock().await.updating = false;
    Ok(())
}

fn launch_paths(args: impl Iterator<Item = String>, cwd: PathBuf) -> Vec<PathBuf> {
    args.filter(|arg| !arg.starts_with("--")).map(|arg| {
        let path = PathBuf::from(arg);
        if path.is_absolute() { path } else { cwd.join(path) }
    }).collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let files = launch_paths(args.into_iter().skip(1), PathBuf::from(cwd));
                if files.is_empty() { let _ = new_app_window(app.clone(), app.state::<AppState>()).await; }
                for file in files { let _ = open_window(app.clone(), app.state::<AppState>(), Some(file)).await; }
            });
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let mut files = launch_paths(std::env::args_os().skip(1).map(|value| value.to_string_lossy().into_owned()), std::env::current_dir().unwrap_or_default()).into_iter();
            if let Some(file) = files.next() { crate::local_files::queue_launch_file("main", file); }
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for file in files { let _ = open_window(app.clone(), app.state::<AppState>(), Some(file)).await; }
            });
            Ok(())
        })
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { crate::local_files::forget_window(window.label()); } })
        .invoke_handler(tauri::generate_handler![crate::local_files::take_launch_file, new_app_window, backend_request, export_markdown, export_image, prepare_app_update, resume_after_update_error, crate::local_files::local_folder_info, crate::local_files::choose_local_folder, crate::local_files::local_folder_history, crate::local_files::open_recent_local_folder, crate::local_files::local_list_directory, crate::local_files::local_snapshot, crate::local_files::local_save, crate::local_files::local_save_image, crate::local_files::open_local_folder])
        .run(tauri::generate_context!())
        .expect("Appen kunde inte startas");
}
