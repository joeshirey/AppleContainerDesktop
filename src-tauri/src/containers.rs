use crate::cli::run_cmd;
use crate::recreate::{build_run_args, config_of, RecreatePlan};
use serde_json::{json, Value};

/// Docker Hub's search API. The older `/v2/search/repositories/` is deprecated;
/// v4 is what the Hub website itself calls. It returns Hardened Images and
/// Desktop extensions alongside ordinary images — the frontend filters those out.
const HUB_SEARCH_URL: &str = "https://hub.docker.com/api/search/v4";

#[tauri::command]
pub async fn search_hub(query: String) -> Result<Value, String> {
    let client = reqwest::Client::new();
    client
        .get(HUB_SEARCH_URL)
        .query(&[("query", query.as_str()), ("size", "20")])
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

/// The console output of a command that produces text rather than JSON.
///
/// `run_cmd` parses what it can, so the same output arrives as a string, as a
/// `{"raw_output": ...}` object, or as some other JSON value depending on what
/// the CLI printed.
fn text_output(v: Value) -> String {
    match &v {
        Value::Object(m) => m
            .get("raw_output")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}

/// Host paths this container bind-mounts that no longer exist.
///
/// A mount with no host path at all (a volume, a tmpfs) is not a bind mount
/// and is never reported.
fn missing_bind_mounts(container: &Value) -> Vec<String> {
    let mounts = container
        .get("configuration")
        .and_then(|c| c.get("mounts").or_else(|| c.get("bindMounts")))
        .and_then(|m| m.as_array());

    let Some(mounts) = mounts else {
        return Vec::new();
    };

    mounts
        .iter()
        .filter_map(|m| {
            m.get("source")
                .or_else(|| m.get("hostPath"))
                .or_else(|| m.get("src"))
                .and_then(|s| s.as_str())
        })
        .filter(|p| !std::path::Path::new(p).exists())
        .map(str::to_string)
        .collect()
}

/// Tag containers whose bind-mount sources have gone away, leaving them in the
/// list. They used to be filtered out, which made them invisible in the GUI —
/// and so impossible to inspect or delete — even though the CLI still had them.
fn annotate_bind_mounts(raw: Value) -> Value {
    let Some(arr) = raw.as_array() else {
        return raw;
    };
    Value::Array(
        arr.iter()
            .map(|c| {
                let missing = missing_bind_mounts(c);
                match (missing.is_empty(), c.as_object()) {
                    (false, Some(obj)) => {
                        let mut obj = obj.clone();
                        obj.insert("missingBindMounts".into(), json!(missing));
                        Value::Object(obj)
                    }
                    _ => c.clone(),
                }
            })
            .collect(),
    )
}

#[tauri::command]
pub fn list_containers() -> Result<Value, String> {
    let raw = run_cmd(&["ls", "-a"]).map_err(|e| e.message)?;
    Ok(annotate_bind_mounts(raw))
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
        .map(text_output)
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn exec_in_container(id: String, command: String) -> Result<String, String> {
    let args = vec!["exec", id.as_str(), "/bin/sh", "-c", command.as_str()];
    run_cmd(&args).map(text_output).map_err(|e| e.message)
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

/// `container machine run` joins its arguments and evaluates the result in a
/// shell inside the machine. So unlike `exec_in_container`, which has to spell
/// out `/bin/sh -c`, the command goes across as a single argument — and pipes,
/// globs, quotes, and `;` all work on the far side.
#[tauri::command]
pub fn machine_run(name: String, command: String) -> Result<String, String> {
    run_cmd(&["machine", "run", "--name", &name, &command])
        .map(text_output)
        .map_err(|e| e.message)
}

fn machine_logs_args<'a>(name: &'a str, lines: &'a str, boot: bool) -> Vec<&'a str> {
    let mut args = vec!["machine", "logs", "-n", lines];
    if boot {
        args.push("--boot");
    }
    args.push(name);
    args
}

#[tauri::command]
pub fn get_machine_logs(name: String, lines: u32, boot: bool) -> Result<String, String> {
    let n = lines.to_string();
    run_cmd(&machine_logs_args(&name, &n, boot))
        .map(text_output)
        .map_err(|e| e.message)
}

/// A `machine set` invocation, or an empty vec when nothing was edited.
///
/// Only the three settings the panel exposes are ever emitted, so a value from
/// the UI can never turn into a different CLI flag.
fn machine_set_args(
    name: &str,
    cpus: Option<u32>,
    memory: Option<&str>,
    home_mount: Option<&str>,
) -> Vec<String> {
    let settings: Vec<String> = [
        cpus.map(|c| format!("cpus={c}")),
        memory.map(|m| format!("memory={m}")),
        home_mount.map(|h| format!("home-mount={h}")),
    ]
    .into_iter()
    .flatten()
    .collect();

    if settings.is_empty() {
        return Vec::new();
    }
    let mut args = vec![
        "machine".to_string(),
        "set".to_string(),
        "--name".to_string(),
        name.to_string(),
    ];
    args.extend(settings);
    args
}

/// Apply configuration to a machine. The CLI only reads the new values when the
/// machine next boots, which the caller is expected to say out loud.
#[tauri::command]
pub fn set_machine_config(
    name: String,
    cpus: Option<u32>,
    memory: Option<String>,
    home_mount: Option<String>,
) -> Result<(), String> {
    let args = machine_set_args(&name, cpus, memory.as_deref(), home_mount.as_deref());
    if args.is_empty() {
        return Ok(());
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cmd(&refs).map(|_| ()).map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A path that is guaranteed to exist, and one that cannot.
    const REAL: &str = "/tmp";
    const GONE: &str = "/tmp/definitely-not-here-8f3a2c1d";

    fn with_mounts(mounts: Value) -> Value {
        json!({ "id": "c1", "configuration": { "mounts": mounts } })
    }

    #[test]
    fn no_mounts_means_nothing_missing() {
        assert!(missing_bind_mounts(&json!({ "id": "c1" })).is_empty());
        assert!(missing_bind_mounts(&with_mounts(json!([]))).is_empty());
    }

    #[test]
    fn a_mount_whose_source_exists_is_not_missing() {
        let c = with_mounts(json!([{ "source": REAL }]));
        assert!(missing_bind_mounts(&c).is_empty());
    }

    #[test]
    fn a_mount_whose_source_is_gone_is_reported() {
        let c = with_mounts(json!([{ "source": GONE }]));
        assert_eq!(missing_bind_mounts(&c), vec![GONE.to_string()]);
    }

    #[test]
    fn reports_only_the_missing_sources_of_a_mixed_set() {
        let c = with_mounts(json!([{ "source": REAL }, { "source": GONE }]));
        assert_eq!(missing_bind_mounts(&c), vec![GONE.to_string()]);
    }

    #[test]
    fn reads_the_alternate_source_spellings() {
        for key in ["source", "hostPath", "src"] {
            let c = with_mounts(json!([{ key: GONE }]));
            assert_eq!(missing_bind_mounts(&c), vec![GONE.to_string()], "key {key}");
        }
    }

    #[test]
    fn a_mount_with_no_source_at_all_is_not_missing() {
        // A volume or tmpfs mount has no host path to check.
        let c = with_mounts(json!([{ "destination": "/data" }]));
        assert!(missing_bind_mounts(&c).is_empty());
    }

    // The list used to drop these containers entirely, which left them
    // invisible in the GUI and therefore impossible to inspect or delete.
    #[test]
    fn annotate_keeps_a_broken_container_and_labels_it() {
        let raw = json!([with_mounts(json!([{ "source": GONE }]))]);
        let out = annotate_bind_mounts(raw);
        let arr = out.as_array().expect("array");
        assert_eq!(arr.len(), 1, "broken container must still be listed");
        assert_eq!(arr[0]["missingBindMounts"], json!([GONE]));
    }

    #[test]
    fn annotate_leaves_healthy_containers_unmarked() {
        let raw = json!([with_mounts(json!([{ "source": REAL }]))]);
        let out = annotate_bind_mounts(raw);
        assert!(out[0].get("missingBindMounts").is_none());
    }

    #[test]
    fn annotate_passes_through_a_non_array_payload() {
        let raw = json!({ "error": "nope" });
        assert_eq!(annotate_bind_mounts(raw.clone()), raw);
    }

    #[test]
    fn machine_set_args_names_the_machine_and_writes_each_setting() {
        let args = machine_set_args("m1", Some(4), Some("8G"), Some("ro"));
        assert_eq!(
            args,
            vec!["machine", "set", "--name", "m1", "cpus=4", "memory=8G", "home-mount=ro"]
        );
    }

    #[test]
    fn machine_set_args_omits_settings_that_were_not_edited() {
        assert_eq!(
            machine_set_args("m1", None, Some("2G"), None),
            vec!["machine", "set", "--name", "m1", "memory=2G"]
        );
    }

    #[test]
    fn machine_set_args_with_no_settings_has_nothing_to_apply() {
        assert!(machine_set_args("m1", None, None, None).is_empty());
    }

    #[test]
    fn machine_logs_args_default_to_the_stdio_log() {
        assert_eq!(machine_logs_args("m1", "100", false), vec!["machine", "logs", "-n", "100", "m1"]);
    }

    #[test]
    fn machine_logs_args_can_ask_for_the_boot_log() {
        assert_eq!(
            machine_logs_args("m1", "50", true),
            vec!["machine", "logs", "-n", "50", "--boot", "m1"]
        );
    }
}
