use serde::Serialize;
use std::{collections::HashSet, fs, io::Write, path::{Component, Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: u64 = 1024 * 1024;
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct LocalFile { path: String, text: String }
#[derive(Serialize)]
pub struct Snapshot { directory: String, files: Vec<LocalFile> }
#[derive(Serialize)]
pub struct Saved { saved: bool, text: Option<String> }

fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Alternate bundle identities must never migrate or write the user's real collection.
    let path = if app.config().identifier == "se.gitbsidian.desktop" {
        app.path().document_dir().map_err(|_| "Kunde inte hitta Dokument-mappen.")?.join("nand")
    } else {
        app.path().app_local_data_dir().map_err(|_| "Kunde inte hitta appens datamapp.")?.join("files")
    };
    fs::create_dir_all(&path).map_err(|_| "Kunde inte skapa den lokala nand-mappen.")?;
    path.canonicalize().map_err(|_| "Kunde inte öppna den lokala nand-mappen.".into())
}

fn supported(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("csv"))
}

fn display_folder(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", unc) }
    else { value.strip_prefix(r"\\?\").unwrap_or(&value).to_string() }
}

fn target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty() || relative.len() > 1000 || relative.contains(['\\', ':', '\0']) || path.is_absolute()
        || !supported(path) || path.components().any(|c| !matches!(c, Component::Normal(_)))
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

fn scan(root: &Path, dir: &Path, files: &mut Vec<LocalFile>, total: &mut usize, visited: &mut HashSet<PathBuf>) -> Result<(), String> {
    let canonical = dir.canonicalize().map_err(|_| "Kunde inte kontrollera den lokala mappen.")?;
    if !canonical.starts_with(root) || !visited.insert(canonical) { return Ok(()); }
    if visited.len() > 1000 { return Err("Den lokala samlingen innehåller för många mappar.".into()); }
    for entry in fs::read_dir(dir).map_err(|_| "Kunde inte läsa den lokala mappen.")? {
        let entry = entry.map_err(|_| "Kunde inte läsa en lokal fil.")?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.eq_ignore_ascii_case(".git") || name.eq_ignore_ascii_case(".obsidian") || name.starts_with(".nand-") { continue; }
        let kind = entry.file_type().map_err(|_| "Kunde inte läsa filtypen.")?;
        if kind.is_symlink() { continue; }
        let path = entry.path();
        if !path.canonicalize().map_err(|_| "Kunde inte kontrollera mappen.")?.starts_with(root) { continue; }
        if kind.is_dir() { scan(root, &path, files, total, visited)?; }
        else if kind.is_file() && supported(&path) {
            let relative = path.strip_prefix(root).map_err(|_| "Ogiltig lokal sökväg.")?.to_string_lossy().replace('\\', "/");
            let text = read(&target(root, &relative)?)?.ok_or("En fil försvann under läsningen. Försök igen.")?;
            *total += text.len();
            if files.len() >= 500 || *total > 16 * 1024 * 1024 { return Err("Den lokala samlingen får innehålla högst 500 filer och 16 MiB text.".into()); }
            files.push(LocalFile { path: relative, text });
        }
    }
    Ok(())
}

fn save(root: &Path, relative: &str, text: &str, expected: Option<&str>) -> Result<Saved, String> {
    if text.len() as u64 > MAX_BYTES || text.contains('\0') { return Err("Filen måste vara UTF-8-text på högst 1 MiB.".into()); }
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
pub async fn local_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        let root = folder(&app)?;
        let mut files = Vec::new();
        scan(&root, &root, &mut files, &mut 0, &mut HashSet::new())?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(Snapshot { directory: display_folder(&root), files })
    }).await.map_err(|_| "Kunde inte läsa den lokala lagringen.")?
}

#[tauri::command]
pub async fn local_save(app: tauri::AppHandle, path: String, text: String, expected: Option<String>) -> Result<Saved, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = FILE_LOCK.lock().map_err(|_| "Kunde inte låsa den lokala lagringen.")?;
        save(&folder(&app)?, &path, &text, expected.as_deref())
    }).await.map_err(|_| "Kunde inte spara den lokala filen.")?
}

#[tauri::command]
pub fn open_local_folder(app: tauri::AppHandle) -> Result<(), String> {
    app.opener().open_path(display_folder(&folder(&app)?), None::<&str>).map_err(|_| "Kunde inte öppna mappen i Utforskaren.".into())
}
