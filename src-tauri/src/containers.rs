use crate::cli::run_cmd;
use crate::recreate::{build_run_args, config_of, RecreatePlan};
use serde_json::Value;

#[tauri::command]
pub async fn search_hub(query: String) -> Result<Value, String> {
    let client = reqwest::Client::new();
    client
        .get("https://hub.docker.com/v2/search/repositories/")
        .query(&[("query", query.as_str()), ("page_size", "20")])
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_hub_tags(name: String) -> Result<Value, String> {
    let repo_path = if name.contains('/') {
        name.clone()
    } else {
        format!("library/{}", name)
    };
    let client = reqwest::Client::new();
    client
        .get(format!("https://hub.docker.com/v2/repositories/{}/tags/", repo_path))
        .query(&[("page_size", "5")])
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

fn bind_mounts_exist(container: &Value) -> bool {
    let mounts = container
        .get("configuration")
        .and_then(|c| c.get("mounts").or_else(|| c.get("bindMounts")))
        .and_then(|m| m.as_array());

    let Some(mounts) = mounts else { return true };

    mounts.iter().all(|m| {
        let source = m
            .get("source")
            .or_else(|| m.get("hostPath"))
            .or_else(|| m.get("src"))
            .and_then(|s| s.as_str());
        source.map_or(true, |p| std::path::Path::new(p).exists())
    })
}

#[tauri::command]
pub fn list_containers() -> Result<Value, String> {
    let raw = run_cmd(&["ls", "-a"]).map_err(|e| e.message)?;
    if let Some(arr) = raw.as_array() {
        let filtered: Vec<Value> = arr
            .iter()
            .filter(|c| bind_mounts_exist(c))
            .cloned()
            .collect();
        return Ok(Value::Array(filtered));
    }
    Ok(raw)
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
    let args = vec!["exec", id.as_str(), "/bin/sh", "-c", command.as_str()];
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
    let raw = run_cmd(&["stats", "--no-stream", &id]).map_err(|e| e.message)?;
    // The CLI returns a JSON array; find the entry matching the requested id
    // or fall back to the first element.
    if let Some(arr) = raw.as_array() {
        let entry = arr
            .iter()
            .find(|v| v.get("id").and_then(|s| s.as_str()) == Some(id.as_str()))
            .or_else(|| arr.first());
        return Ok(entry.cloned().unwrap_or(Value::Null));
    }
    Ok(raw)
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

/// Work out how `id` would be recreated with `edits` applied, without changing
/// anything. Lets the UI show the exact command and what it cannot carry over.
#[tauri::command]
pub fn plan_recreate(id: String, edits: Value) -> Result<RecreatePlan, String> {
    let inspect = run_cmd(&["inspect", &id]).map_err(|e| e.message)?;
    let config = config_of(&inspect)
        .ok_or_else(|| format!("could not read the configuration of container {id}"))?;
    Ok(build_run_args(config, &edits))
}

/// Delete `id` and run it again with `edits` applied and every other setting
/// carried over from its current configuration.
///
/// The container has to be removed before the replacement can claim its name,
/// so a failure after that point is reported with the full command line to let
/// the user recover by hand.
#[tauri::command]
pub fn recreate_container(id: String, edits: Value) -> Result<(), String> {
    let plan = plan_recreate(id.clone(), edits)?;
    let args: Vec<&str> = plan.args.iter().map(String::as_str).collect();

    run_cmd(&["rm", &id]).map_err(|e| e.message)?;
    run_cmd(&args).map(|_| ()).map_err(|e| {
        format!(
            "{}\n\nThe old container was already removed. Recreate it with:\ncontainer {}",
            e.message,
            plan.args.join(" ")
        )
    })
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
pub fn stop_system() -> Result<(), String> {
    run_cmd(&["system", "stop"])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn list_images() -> Result<Value, String> {
    run_cmd(&["image", "ls"]).map_err(|e| e.message)
}

#[tauri::command]
/// `reference` must be a name like `docker.io/library/debian:latest`. The CLI
/// rejects a descriptor digest here with "failed to delete one or more images".
pub fn remove_image(reference: String) -> Result<(), String> {
    run_cmd(&["image", "rm", &reference])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn pull_image(name: String) -> Result<(), String> {
    run_cmd(&["image", "pull", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn list_machines() -> Result<Value, String> {
    run_cmd(&["machine", "ls"]).map_err(|e| e.message)
}

#[tauri::command]
pub fn prune_images() -> Result<(), String> {
    run_cmd(&["image", "prune"])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn inspect_machine(name: String) -> Result<Value, String> {
    run_cmd(&["machine", "inspect", &name]).map_err(|e| e.message)
}

#[tauri::command]
pub fn create_machine(
    image: String,
    name: Option<String>,
    cpus: Option<u32>,
    memory: Option<String>,
) -> Result<(), String> {
    let mut args = vec!["machine".to_string(), "create".to_string()];
    if let Some(n) = name {
        args.extend_from_slice(&["--name".to_string(), n]);
    }
    if let Some(c) = cpus {
        args.extend_from_slice(&["--cpus".to_string(), c.to_string()]);
    }
    if let Some(m) = memory {
        args.extend_from_slice(&["--memory".to_string(), m]);
    }
    args.push(image);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cmd(&refs).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn stop_machine(name: String) -> Result<(), String> {
    run_cmd(&["machine", "stop", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn delete_machine(name: String) -> Result<(), String> {
    run_cmd(&["machine", "delete", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn set_default_machine(name: String) -> Result<(), String> {
    run_cmd(&["machine", "set-default", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}
