use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, io::Write, path::{Component, Path, PathBuf}, sync::{LazyLock, Mutex}, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
static FILE_LOCK: Mutex<()> = Mutex::new(());
static WINDOW_FOLDERS: LazyLock<Mutex<HashMap<String, FolderInfo>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static LAUNCH_FILES: LazyLock<Mutex<HashMap<String, PathBuf>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn queue_launch_file(label: &str, path: PathBuf) {
    if let Ok(mut files) = LAUNCH_FILES.lock() { files.insert(label.to_owned(), path); }
}

#[derive(Serialize)]
pub struct LaunchFile { folder: FolderInfo, path: String }

#[tauri::command]
pub async fn take_launch_file(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<LaunchFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let requested = LAUNCH_FILES.lock().map_err(|_| "Kunde inte läsa filvalet.")?.remove(window.label());
        let Some(requested) = requested else { return Ok(None); };
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let file = requested.canonicalize().map_err(|_| "Filen finns inte eller kan inte öppnas.".to_owned())?;
        if !file.is_file() || !supported(&file) { return Err("Öppna en TXT-, Markdown-, CSV- eller bildfil.".into()); }
        if is_image(&file) { image_data(&file)?.ok_or("Filen finns inte längre.")?; } else { read(&file)?.ok_or("Filen finns inte längre.")?; }
        let parent = file.parent().ok_or("Kunde inte hitta filens mapp.")?;
        let name = file.file_name().and_then(|name| name.to_str()).ok_or("Ogiltigt filnamn.")?.to_owned();
        target(parent, &name)?;
        let info = select_folder(&app, window.label(), parent.to_path_buf())?;
        Ok(Some(LaunchFile { folder: info, path: name }))
    }).await.map_err(|_| "Kunde inte öppna filen.".to_owned())?
}

pub fn forget_window(label: &str) {
    if let Ok(mut folders) = WINDOW_FOLDERS.lock() { folders.remove(label); }
    if let Ok(mut files) = LAUNCH_FILES.lock() { files.remove(label); }
}

fn window_folder_info(app: &tauri::AppHandle, label: &str) -> Result<FolderInfo, String> {
    let mut folders = WINDOW_FOLDERS.lock().map_err(|_| "Kunde inte läsa fönstrets mapp.")?;
    if let Some(info) = folders.get(label) { return Ok(info.clone()); }
    let info = folder_info(app)?;
    folders.insert(label.to_owned(), info.clone());
    Ok(info)
}

#[derive(Serialize)]
pub struct LocalFile { path: String, text: String }
#[derive(Serialize)]
pub struct Snapshot { directory: String, files: Vec<LocalFile> }
#[derive(Serialize)]
pub struct Saved { saved: bool, text: Option<String> }
#[derive(Clone, Serialize, Deserialize)]
pub struct FolderInfo { directory: String, scope: String }

fn default_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Alternate bundle identities must never migrate or write the user's real collection.
    let path = if app.config().identifier == "se.gitbsidian.desktop" {
        app.path().document_dir().map_err(|_| "Kunde inte hitta Dokument-mappen.")?.join("nand")
    } else {
        app.path().app_local_data_dir().map_err(|_| "Kunde inte hitta appens datamapp.")?.join("files")
    };
    Ok(path)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|_| "Kunde inte hitta appens datamapp.")?.join("local-folder.json"))
}

fn folder_info(app: &tauri::AppHandle) -> Result<FolderInfo, String> {
    match fs::read(config_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Inställningen för rotmapp kunde inte läsas. Välj rotmapp igen.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let path = default_folder(app)?;
            fs::create_dir_all(&path).map_err(|_| "Kunde inte skapa den lokala nand-mappen.")?;
            let path = path.canonicalize().map_err(|_| "Kunde inte öppna den lokala nand-mappen.")?;
            Ok(FolderInfo { directory: display_folder(&path), scope: "local-notebook".into() })
        },
        Err(_) => Err("Kunde inte läsa den valda rotmappen.".into()),
    }
}

fn folder(app: &tauri::AppHandle, label: &str) -> Result<PathBuf, String> {
    let info = window_folder_info(app, label)?;
    let path = PathBuf::from(info.directory);
    // Never recreate a missing selected folder (for example a disconnected drive).
    if info.scope == "local-notebook" { fs::create_dir_all(&path).map_err(|_| "Kunde inte skapa den lokala nand-mappen.")?; }
    path.canonicalize().map_err(|_| "Rotmappen är inte tillgänglig. Anslut enheten eller välj en annan mapp.".into())
}

fn check_directory(root: &Path, expected: Option<&str>) -> Result<(), String> {
    if expected.is_some_and(|value| !display_folder(root).eq_ignore_ascii_case(value)) {
        return Err("Rotmappen har ändrats. Öppna arbetsytan igen innan du sparar.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn local_folder_info(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<FolderInfo, String> { window_folder_info(&app, window.label()) }

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_path(app)?.with_file_name("local-folder-history.json"))
}

fn folder_history(app: &tauri::AppHandle) -> Result<Vec<FolderInfo>, String> {
    let mut items: Vec<FolderInfo> = match fs::read(history_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Mapphistoriken kunde inte läsas.")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(_) => return Err("Mapphistoriken kunde inte läsas.".into()),
    };
    if let Ok(current) = folder_info(app) {
        items.retain(|item| !item.directory.eq_ignore_ascii_case(&current.directory));
        items.insert(0, current);
    }
    items.truncate(30);
    Ok(items)
}

#[tauri::command]
pub fn local_folder_history(app: tauri::AppHandle) -> Result<Vec<FolderInfo>, String> {
    let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
    folder_history(&app)
}

fn select_folder(app: &tauri::AppHandle, label: &str, path: PathBuf) -> Result<FolderInfo, String> {
    let path = path.canonicalize().map_err(|_| "Mappen är inte tillgänglig. Anslut enheten eller välj en annan mapp.")?;
    if !path.is_dir() { return Err("Välj en mapp.".into()); }
    fs::read_dir(&path).map_err(|_| "Kunde inte läsa mappen.")?;
    let directory = display_folder(&path);
    let is_default = default_folder(app)?.canonicalize().is_ok_and(|value| value == path);
    let info = FolderInfo { scope: if is_default { "local-notebook".into() } else { format!("local-folder:{}", directory.to_lowercase()) }, directory };
    let mut history = folder_history(app)?;
    history.retain(|item| !item.directory.eq_ignore_ascii_case(&info.directory));
    history.insert(0, info.clone()); history.truncate(30);
    let config = config_path(app)?;
    fs::create_dir_all(config.parent().ok_or("Ogiltig inställningsmapp.")?).map_err(|_| "Kunde inte spara mappvalet.")?;
    for (target, bytes) in [(history_path(app)?, serde_json::to_vec(&history)), (config, serde_json::to_vec(&info))] {
        let temporary = target.with_extension("tmp");
        fs::write(&temporary, bytes.map_err(|_| "Kunde inte spara mappvalet.")?).map_err(|_| "Kunde inte spara mappvalet.")?;
        fs::rename(&temporary, &target).map_err(|_| "Kunde inte spara mappvalet.")?;
    }
    WINDOW_FOLDERS.lock().map_err(|_| "Kunde inte välja fönstrets mapp.")?.insert(label.to_owned(), info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn open_recent_local_folder(app: tauri::AppHandle, window: tauri::WebviewWindow, directory: String) -> Result<FolderInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        if !folder_history(&app)?.iter().any(|item| item.directory.eq_ignore_ascii_case(&directory)) {
            return Err("Mappen finns inte i historiken. Använd Öppna lokal mapp.".into());
        }
        select_folder(&app, window.label(), PathBuf::from(directory))
    }).await.map_err(|_| "Kunde inte öppna mappen.".to_owned())?
}

#[tauri::command]
pub async fn choose_local_folder(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<FolderInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().set_title("Välj rotmapp för lokala filer").blocking_pick_folder() else { return Ok(None); };
        let path = selected.into_path().map_err(|_| "Ogiltig mapp.")?;
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        select_folder(&app, window.label(), path).map(Some)
    }).await.map_err(|_| "Kunde inte välja rotmapp.".to_owned())?
}

fn supported(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("csv") || s.eq_ignore_ascii_case("txt") || is_image(path))
}

fn is_image(path: &Path) -> bool { path.extension().and_then(|s| s.to_str()).is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp")) }
fn mime(path: &Path) -> &'static str { match path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str() { "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", _ => "image/png" } }
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize; let b = chunk.get(1).copied().unwrap_or(0) as usize; let c = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[a >> 2] as char); out.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        out.push(if chunk.len() > 1 { TABLE[((b & 15) << 2) | (c >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[c & 63] as char } else { '=' });
    }
    out
}
fn image_data(path: &Path) -> Result<Option<String>, String> {
    let metadata = match fs::metadata(path) { Ok(value) => value, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(_) => return Err("Kunde inte läsa bildfilen.".into()) };
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES { return Err("Bildfiler måste vara högst 16 MiB.".into()); }
    let bytes = fs::read(path).map_err(|_| "Bildfilen kunde inte läsas.")?;
    Ok(Some(format!("data:{};base64,{}", mime(path), base64(&bytes))))
}
fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(value.len() * 3 / 4); let mut acc = 0u32; let mut bits = 0u8;
    for byte in value.bytes() { let digit = match byte { b'A'..=b'Z' => byte - b'A', b'a'..=b'z' => byte - b'a' + 26, b'0'..=b'9' => byte - b'0' + 52, b'+' => 62, b'/' => 63, b'=' => break, b'\r' | b'\n' | b' ' => continue, _ => return Err("Ogiltig bilddata.".into()) }; acc = (acc << 6) | digit as u32; bits += 6; if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; } }
    Ok(out)
}

fn display_folder(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", unc) }
    else { value.strip_prefix(r"\\?\").unwrap_or(&value).to_string() }
}

fn target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty() || relative.len() > 1000 || relative.contains(['\\', ':', '\0']) || path.is_absolute()
        || path.components().any(|c| !matches!(c, Component::Normal(_)))
        || relative.split('/').any(|c| c.is_empty() || c == "." || c == ".." || c.eq_ignore_ascii_case(".git") || c.eq_ignore_ascii_case(".obsidian") || c.starts_with(".nand-")) {
        return Err("Ogiltig lokal filsökväg.".into());
    }
    let mut current = root.to_path_buf();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !current.canonicalize().map_err(|_| "Kunde inte kontrollera filsökvägen.")?.starts_with(root) {
                    return Err("Länkar utanför den lokala samlingen stöds inte.".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("Kunde inte kontrollera filsökvägen.".into()),
        }
    }
    Ok(current)
}

fn read(path: &Path) -> Result<Option<String>, String> {
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Kunde inte läsa den lokala filen.".into()),
    };
    if !metadata.is_file() || metadata.len() > MAX_BYTES { return Err("Lokala filer måste vara högst 1 MiB.".into()); }
    let text = fs::read_to_string(path).map_err(|_| "Filen kunde inte läsas som UTF-8.")?;
    if text.contains('\0') { return Err("Filen innehåller binär data.".into()); }
    Ok(Some(text))
}

fn save_image(root: &Path, relative: &str, data_url: &str, expected: Option<&str>) -> Result<Saved, String> {
    let (header, encoded) = data_url.split_once(",").ok_or("Ogiltig bilddata.")?;
    let mime_ok = ["data:image/png;base64", "data:image/jpeg;base64", "data:image/gif;base64", "data:image/webp;base64", "data:image/bmp;base64"].iter().any(|prefix| header.eq_ignore_ascii_case(prefix));
    if !mime_ok { return Err("Bildformatet stöds inte.".into()); }
    let bytes = decode_base64(encoded)?; if bytes.len() as u64 > MAX_IMAGE_BYTES { return Err("Bildfiler måste vara högst 16 MiB.".into()); }
    let path = target(root, relative)?; if !is_image(&path) { return Err("Filsökvägen är inte en bild.".into()); }
    let current = image_data(&path)?;
    if current.as_deref() == Some(data_url) { return Ok(Saved { saved: true, text: current }); }
    if current.as_deref() != expected { return Ok(Saved { saved: false, text: current }); }
    fs::create_dir_all(path.parent().ok_or("Ogiltig mapp.")?).map_err(|_| "Kunde inte skapa undermappen.")?;
    let temporary = path.with_file_name(format!(".nand-image-{}-{}.tmp", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Klockfel.")?.as_nanos()));
    fs::write(&temporary, bytes).map_err(|_| "Kunde inte spara bildfilen. Utkastet finns kvar.")?;
    let current = image_data(&path)?;
    if current.as_deref() != expected { let _ = fs::remove_file(&temporary); return Ok(Saved { saved: false, text: current }); }
    fs::rename(&temporary, &path).map_err(|_| "Kunde inte ersätta bildfilen. Stäng den i andra program och försök igen.")?;
    Ok(Saved { saved: true, text: Some(data_url.to_owned()) })
}


fn save(root: &Path, relative: &str, text: &str, expected: Option<&str>) -> Result<Saved, String> {
    if text.len() as u64 > MAX_BYTES || text.contains('\0') { return Err("Filen måste vara UTF-8-text på högst 1 MiB.".into()); }
    if !supported(Path::new(relative)) { return Err("Endast Markdown, TXT och CSV stöds.".into()); }
    let path = target(root, relative)?;
    let current = read(&path)?;
    if current.as_deref() == Some(text) { return Ok(Saved { saved: true, text: current }); }
    if current.as_deref() != expected { return Ok(Saved { saved: false, text: current }); }
    fs::create_dir_all(path.parent().ok_or("Ogiltig mapp.")?).map_err(|_| "Kunde inte skapa undermappen.")?;
    let path = target(root, relative)?;
    let suffix = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Klockfel.")?.as_nanos();
    let temporary = path.with_file_name(format!(".nand-{}-{suffix}.tmp", std::process::id()));
    let outcome = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Kunde inte skapa en temporär fil.")?;
        file.write_all(text.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "Kunde inte spara filen. Utkastet finns kvar.")?;
        drop(file);
        let current = read(&target(root, relative)?)?;
        if current.as_deref() != expected { return Ok(Saved { saved: false, text: current }); }
        if expected.is_none() {
            // A hard link atomically creates a new name without replacing a file created by another app.
            fs::hard_link(&temporary, &path).map_err(|_| "Filen kunde inte skapas. Den kan ha skapats av ett annat program; försök igen.")?;
        } else {
            fs::rename(&temporary, &path).map_err(|_| "Kunde inte ersätta filen. Stäng den i andra program och försök igen.")?;
        }
        Ok(Saved { saved: true, text: Some(text.to_owned()) })
    })();
    let _ = fs::remove_file(&temporary);
    outcome
}

#[tauri::command]
pub async fn local_snapshot(app: tauri::AppHandle, window: tauri::WebviewWindow, directory: Option<String>, paths: Option<Vec<String>>) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let root = folder(&app, window.label())?;
        check_directory(&root, directory.as_deref())?;
        let mut files = Vec::new();
        let paths = paths.unwrap_or_default();
        if paths.len() > 500 { return Err("Välj högst 500 filer i samlingen.".into()); }
        let mut total = 0;
        for relative in paths {
            if !supported(Path::new(&relative)) { return Err("Endast Markdown, TXT, CSV och bilder stöds.".into()); }
            let checked = target(&root, &relative)?;
            let value = if is_image(&checked) { image_data(&checked)? } else { read(&checked)? };
            if let Some(text) = value {
                total += text.len();
                if total > 16 * 1024 * 1024 { return Err("De valda filerna är större än 16 MiB.".into()); }
                files.push(LocalFile { path: relative, text });
            }
        }
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Snapshot { directory: display_folder(&root), files })
    }).await.map_err(|_| "Kunde inte läsa den lokala lagringen.")?
}

#[tauri::command]
pub async fn local_save(app: tauri::AppHandle, window: tauri::WebviewWindow, path: String, text: String, expected: Option<String>, directory: Option<String>) -> Result<Saved, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let root = folder(&app, window.label())?;
        check_directory(&root, directory.as_deref())?;
        save(&root, &path, &text, expected.as_deref())
    }).await.map_err(|_| "Kunde inte spara den lokala filen.")?
}

#[tauri::command]
pub async fn local_save_image(app: tauri::AppHandle, window: tauri::WebviewWindow, path: String, data_url: String, expected: Option<String>, directory: Option<String>) -> Result<Saved, String> {
    tauri::async_runtime::spawn_blocking(move || { let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?; let root = folder(&app, window.label())?; check_directory(&root, directory.as_deref())?; save_image(&root, &path, &data_url, expected.as_deref()) }).await.map_err(|_| "Kunde inte spara bildfilen.".to_owned())?
}

#[tauri::command]
pub fn open_local_folder(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    app.opener().open_path(display_folder(&folder(&app, window.label())?), None::<&str>).map_err(|_| "Kunde inte öppna mappen i Utforskaren.".into())
}

#[derive(Serialize)]
pub struct DirectoryEntry { path: String, name: String, folder: bool }
#[derive(Serialize)]
pub struct DirectoryPage { entries: Vec<DirectoryEntry>, next: Option<usize> }

#[tauri::command]
pub async fn local_list_directory(app: tauri::AppHandle, window: tauri::WebviewWindow, directory: String, path: String, offset: Option<usize>) -> Result<DirectoryPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa mappen.")?;
        let root = folder(&app, window.label())?;
        check_directory(&root, Some(&directory))?;
        let dir = if path.is_empty() { root.clone() } else { target(&root, &path)? };
        let offset = offset.unwrap_or(0);
        let mut entries = Vec::new();
        let mut next = None;
        for (index, entry) in fs::read_dir(dir).map_err(|_| "Kunde inte läsa mappen.")?.enumerate().skip(offset) {
            if index - offset >= 200 { next = Some(index); break; }
            let Ok(entry) = entry else { continue; };
            let name = entry.file_name().to_string_lossy().to_string();
            let relative = if path.is_empty() { name.clone() } else { format!("{path}/{name}") };
            let Ok(checked) = target(&root, &relative) else { continue; };
            let Ok(kind) = entry.file_type() else { continue; };
            if kind.is_symlink() || (!kind.is_dir() && !(kind.is_file() && supported(&checked))) { continue; }
            entries.push(DirectoryEntry { path: relative, name, folder: kind.is_dir() });
        }
        entries.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(DirectoryPage { entries, next })
    }).await.map_err(|_| "Kunde inte läsa mappen.".to_owned())?
}
