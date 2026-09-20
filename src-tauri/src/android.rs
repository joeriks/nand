use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{plugin::PluginHandle, Manager, Wry};

struct MobileBackend(PluginHandle<Wry>);
#[derive(Deserialize, Serialize)]
struct ApiRequest { url: String, method: String, body: Option<Value> }

#[tauri::command]
async fn backend_request(app: tauri::AppHandle, request: ApiRequest) -> Result<Value, String> {
    if !request.url.starts_with("/api/") || request.url.len() > 4096 || !["GET", "POST", "PUT"].contains(&request.method.as_str()) || request.body.as_ref().is_some_and(|b| b.to_string().len() > 2 * 1024 * 1024) {
        return Err("Ogiltigt appanrop.".into());
    }
    app.state::<MobileBackend>().0.run_mobile_plugin_async("request", json!({"request": request})).await
        .map_err(|_| "Android-anropet misslyckades. Dina lokala utkast finns kvar.".into())
}

#[tauri::command]
async fn export_markdown(app: tauri::AppHandle, name: String, text: String) -> Result<bool, String> {
    if text.len() > 1024 * 1024 || name.len() > 240 || name.contains(['/', '\\', '\0']) {
        return Err("Ogiltigt filnamn eller för stor anteckning.".into());
    }
    let result: Value = app.state::<MobileBackend>().0.run_mobile_plugin_async("exportMarkdown", json!({"name": name, "text": text})).await
        .map_err(|_| "Kunde inte exportera. Utkastet finns kvar.".to_string())?;
    Ok(result["saved"].as_bool().unwrap_or(false))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri::plugin::Builder::<Wry>::new("mobile-backend").setup(|app, api| {
            app.manage(MobileBackend(api.register_android_plugin("se.gitbsidian.mobile", "GitHubPlugin")?));
            Ok(())
        }).build())
        .invoke_handler(tauri::generate_handler![backend_request, export_markdown])
        .run(tauri::generate_context!())
        .expect("Appen kunde inte startas");
}
