use crate::cli::run_cmd;
use serde_json::Value;

#[tauri::command]
pub fn list_containers() -> Result<Value, String> {
    run_cmd(&["ls", "-a"]).map_err(|e| e.message)
}

#[tauri::command]
pub fn start_container(id: String) -> Result<(), String> {
    run_cmd(&["start", &id]).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn stop_container(id: String) -> Result<(), String> {
    run_cmd(&["stop", &id]).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn remove_container(id: String) -> Result<(), String> {
    run_cmd(&["rm", &id]).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn get_logs(id: String, lines: u32) -> Result<String, String> {
    let n = lines.to_string();
    run_cmd(&["logs", "-n", &n, &id])
        .map(|v| match &v {
            Value::Object(m) => m
                .get("raw_output")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        })
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn exec_in_container(id: String, command: String) -> Result<String, String> {
    // Splits on whitespace — arguments with spaces are not supported in v1
    let parts: Vec<&str> = command.split_whitespace().collect();
    let mut args = vec!["exec", id.as_str()];
    args.extend_from_slice(&parts);
    run_cmd(&args)
        .map(|v| match &v {
            Value::Object(m) => m
                .get("raw_output")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        })
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn get_stats(id: String) -> Result<Value, String> {
    run_cmd(&["stats", "--no-stream", &id]).map_err(|e| e.message)
}

#[tauri::command]
pub fn inspect_container(id: String) -> Result<Value, String> {
    run_cmd(&["inspect", &id]).map_err(|e| e.message)
}

#[tauri::command]
pub fn run_container(opts: Value) -> Result<(), String> {
    let mut args = vec!["run".to_string()];
    if opts
        .get("detach")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
    {
        args.push("-d".to_string());
    }
    if let Some(n) = opts.get("name").and_then(|v| v.as_str()) {
        args.extend_from_slice(&["--name".to_string(), n.to_string()]);
    }
    if let Some(c) = opts.get("cpus").and_then(|v| v.as_u64()) {
        args.extend_from_slice(&["--cpus".to_string(), c.to_string()]);
    }
    if let Some(m) = opts.get("memory").and_then(|v| v.as_str()) {
        args.extend_from_slice(&["--memory".to_string(), m.to_string()]);
    }
    if let Some(ports) = opts.get("ports").and_then(|v| v.as_array()) {
        for p in ports {
            if let Some(s) = p.as_str() {
                args.extend_from_slice(&["-p".to_string(), s.to_string()]);
            }
        }
    }
    if let Some(envs) = opts.get("env").and_then(|v| v.as_array()) {
        for e in envs {
            if let Some(s) = e.as_str() {
                args.extend_from_slice(&["-e".to_string(), s.to_string()]);
            }
        }
    }
    let img = opts
        .get("image")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing required field: image".to_string())?;
    args.push(img.to_string());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cmd(&refs).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn check_system_status() -> Result<Value, String> {
    run_cmd(&["system", "status"]).map_err(|e| e.message)
}

#[tauri::command]
pub fn start_system() -> Result<(), String> {
    run_cmd(&["system", "start"])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn list_images() -> Result<Value, String> {
    run_cmd(&["image", "ls"]).map_err(|e| e.message)
}

#[tauri::command]
pub fn remove_image(id: String) -> Result<(), String> {
    run_cmd(&["image", "rm", &id])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn pull_image(name: String) -> Result<(), String> {
    run_cmd(&["pull", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn list_machines() -> Result<Value, String> {
    run_cmd(&["machine", "ls"]).map_err(|e| e.message)
}
