use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Component, Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: u64 = 1024 * 1024;
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct LocalFile { path: String, text: String }
#[derive(Serialize)]
pub struct Snapshot { directory: String, files: Vec<LocalFile> }
#[derive(Serialize)]
pub struct Saved { saved: bool, text: Option<String> }
#[derive(Serialize, Deserialize)]
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

fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let info = folder_info(app)?;
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
pub fn local_folder_info(app: tauri::AppHandle) -> Result<FolderInfo, String> { folder_info(&app) }

#[tauri::command]
pub async fn choose_local_folder(app: tauri::AppHandle) -> Result<Option<FolderInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app.dialog().file().set_title("Välj rotmapp för lokala filer").blocking_pick_folder() else { return Ok(None); };
        let path = selected.into_path().map_err(|_| "Ogiltig mapp.")?.canonicalize().map_err(|_| "Kunde inte öppna mappen.")?;
        if !path.is_dir() { return Err("Välj en mapp.".into()); }
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        fs::read_dir(&path).map_err(|_| "Kunde inte läsa mappen.")?;
        let directory = display_folder(&path);
        let default = default_folder(&app)?;
        let is_default = default.canonicalize().is_ok_and(|value| value == path);
        let info = FolderInfo { scope: if is_default { "local-notebook".into() } else { format!("local-folder:{}", directory.to_lowercase()) }, directory };
        let config = config_path(&app)?;
        fs::create_dir_all(config.parent().ok_or("Ogiltig inställningsmapp.")?).map_err(|_| "Kunde inte spara mappvalet.")?;
        let temporary = config.with_extension("tmp");
        fs::write(&temporary, serde_json::to_vec(&info).map_err(|_| "Kunde inte spara mappvalet.")?).map_err(|_| "Kunde inte spara mappvalet.")?;
        fs::rename(&temporary, &config).map_err(|_| "Kunde inte spara mappvalet.")?;
        Ok(Some(info))
    }).await.map_err(|_| "Kunde inte välja rotmapp.".to_owned())?
}

fn supported(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("csv") || s.eq_ignore_ascii_case("txt"))
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
pub async fn local_snapshot(app: tauri::AppHandle, directory: Option<String>, paths: Option<Vec<String>>) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let root = folder(&app)?;
        check_directory(&root, directory.as_deref())?;
        let mut files = Vec::new();
        let paths = paths.unwrap_or_default();
        if paths.len() > 500 { return Err("Välj högst 500 filer i samlingen.".into()); }
        let mut total = 0;
        for relative in paths {
            if !supported(Path::new(&relative)) { return Err("Endast Markdown, TXT och CSV stöds.".into()); }
            if let Some(text) = read(&target(&root, &relative)?)? {
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
pub async fn local_save(app: tauri::AppHandle, path: String, text: String, expected: Option<String>, directory: Option<String>) -> Result<Saved, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let root = folder(&app)?;
        check_directory(&root, directory.as_deref())?;
        save(&root, &path, &text, expected.as_deref())
    }).await.map_err(|_| "Kunde inte spara den lokala filen.")?
}

#[tauri::command]
pub fn open_local_folder(app: tauri::AppHandle) -> Result<(), String> {
    app.opener().open_path(display_folder(&folder(&app)?), None::<&str>).map_err(|_| "Kunde inte öppna mappen i Utforskaren.".into())
}

#[derive(Serialize)]
pub struct DirectoryEntry { path: String, name: String, folder: bool }
#[derive(Serialize)]
pub struct DirectoryPage { entries: Vec<DirectoryEntry>, next: Option<usize> }

#[tauri::command]
pub async fn local_list_directory(app: tauri::AppHandle, directory: String, path: String, offset: Option<usize>) -> Result<DirectoryPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa mappen.")?;
        let root = folder(&app)?;
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
