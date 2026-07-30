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

/// Bytes actually allocated on disk, or `None` if the path cannot be read.
///
/// A volume is an ext4 image created sparse, so `sizeInBytes` in the CLI's
/// output is the ceiling it was provisioned with and not what it occupies —
/// a 512 GB volume holding a small database takes up a few hundred MB. Only
/// the block count says how much disk is really gone.
fn allocated_bytes(path: &str) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    // `blocks()` is in 512-byte units regardless of the filesystem's own
    // block size — that is the unit stat(2) defines, not a filesystem detail.
    std::fs::metadata(path).ok().map(|m| m.blocks() * 512)
}

fn volume_create_args(name: &str, size: Option<&str>) -> Vec<String> {
    let mut args = vec!["volume".to_string(), "create".to_string()];
    if let Some(s) = size {
        args.extend_from_slice(&["-s".to_string(), s.to_string()]);
    }
    args.push(name.to_string());
    args
}

fn network_create_args(name: &str, subnet: Option<&str>, internal: bool) -> Vec<String> {
    let mut args = vec!["network".to_string(), "create".to_string()];
    if internal {
        args.push("--internal".to_string());
    }
    if let Some(s) = subnet {
        args.extend_from_slice(&["--subnet".to_string(), s.to_string()]);
    }
    args.push(name.to_string());
    args
}

/// Every container in `containers` for which `pick` yields a name equal to `want`.
fn users_of<F>(containers: &Value, want: &str, pick: F) -> Vec<String>
where
    F: Fn(&Value) -> Vec<String>,
{
    let Some(arr) = containers.as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter(|c| pick(c).iter().any(|n| n == want))
        .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(str::to_string))
        .collect()
}

/// Containers mounting the named volume.
///
/// A named volume is distinguished from a bind mount by `type.volume`: both
/// carry a host `source`, so the mount type is the only thing that separates
/// a volume called "data" from a bind mount of a host directory `/data`.
fn volume_users(containers: &Value, volume: &str) -> Vec<String> {
    users_of(containers, volume, |c| {
        c.get("configuration")
            .and_then(|c| c.get("mounts"))
            .and_then(|m| m.as_array())
            .map(|mounts| {
                mounts
                    .iter()
                    .filter_map(|m| {
                        m.get("type")?
                            .get("volume")?
                            .get("name")?
                            .as_str()
                            .map(str::to_string)
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// Containers attached to the named network.
fn network_users(containers: &Value, network: &str) -> Vec<String> {
    users_of(containers, network, |c| {
        c.get("configuration")
            .and_then(|c| c.get("networks"))
            .and_then(|n| n.as_array())
            .map(|nets| {
                nets.iter()
                    .filter_map(|n| n.get("network").and_then(|v| v.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// The label the CLI puts on the networks it manages itself.
const BUILTIN_ROLE_LABEL: &str = "com.apple.container.resource.role";

/// `container network delete default` fails outright with "cannot delete a
/// builtin network", so the UI needs to know not to offer it.
fn is_builtin_network(network: &Value) -> bool {
    network
        .get("configuration")
        .and_then(|c| c.get("labels"))
        .and_then(|l| l.get(BUILTIN_ROLE_LABEL))
        .and_then(|v| v.as_str())
        == Some("builtin")
}

/// Add to each element the fields computed by `extra`, leaving a non-array
/// payload (an error object, say) untouched.
fn annotate_each<F>(raw: Value, extra: F) -> Value
where
    F: Fn(&Value) -> Vec<(String, Value)>,
{
    let Some(arr) = raw.as_array() else {
        return raw;
    };
    Value::Array(
        arr.iter()
            .map(|item| match item.as_object() {
                Some(obj) => {
                    let mut obj = obj.clone();
                    obj.extend(extra(item));
                    Value::Object(obj)
                }
                None => item.clone(),
            })
            .collect(),
    )
}

/// Tag each volume with the containers holding it and its real disk footprint.
///
/// `diskUsageBytes` is left off entirely when the image cannot be read, so the
/// UI can tell "nothing allocated" apart from "we could not find out".
fn annotate_volumes(volumes: Value, containers: &Value) -> Value {
    annotate_each(volumes, |v| {
        let name = v
            .get("configuration")
            .and_then(|c| c.get("name"))
            .or_else(|| v.get("id"))
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let used = allocated_bytes(
            v.get("configuration")
                .and_then(|c| c.get("source"))
                .and_then(|s| s.as_str())
                .unwrap_or_default(),
        );
        let mut fields = vec![("inUseBy".to_string(), json!(volume_users(containers, name)))];
        if let Some(bytes) = used {
            fields.push(("diskUsageBytes".to_string(), json!(bytes)));
        }
        fields
    })
}

/// Tag each network with the containers attached to it and whether it is one
/// the CLI owns.
fn annotate_networks(networks: Value, containers: &Value) -> Value {
    annotate_each(networks, |n| {
        let name = n
            .get("configuration")
            .and_then(|c| c.get("name"))
            .or_else(|| n.get("id"))
            .and_then(|s| s.as_str())
            .unwrap_or_default();
        vec![
            ("inUseBy".to_string(), json!(network_users(containers, name))),
            ("isBuiltin".to_string(), json!(is_builtin_network(n))),
        ]
    })
}

/// The containers to check volume and network references against.
///
/// A failure here is not fatal: it only means nothing can be reported as in
/// use, which is better than refusing to list volumes at all.
fn containers_or_empty() -> Value {
    run_cmd(&["ls", "-a"]).unwrap_or_else(|_| json!([]))
}

#[tauri::command]
pub fn list_volumes() -> Result<Value, String> {
    let raw = run_cmd(&["volume", "ls"]).map_err(|e| e.message)?;
    Ok(annotate_volumes(raw, &containers_or_empty()))
}

#[tauri::command]
pub fn create_volume(name: String, size: Option<String>) -> Result<(), String> {
    let args = volume_create_args(&name, size.as_deref());
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cmd(&refs).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn delete_volume(name: String) -> Result<(), String> {
    run_cmd(&["volume", "delete", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

/// Delete every volume no container references. Destroys their contents.
#[tauri::command]
pub fn prune_volumes() -> Result<String, String> {
    run_cmd(&["volume", "prune"])
        .map(text_output)
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn list_networks() -> Result<Value, String> {
    let raw = run_cmd(&["network", "ls"]).map_err(|e| e.message)?;
    Ok(annotate_networks(raw, &containers_or_empty()))
}

#[tauri::command]
pub fn create_network(
    name: String,
    subnet: Option<String>,
    internal: bool,
) -> Result<(), String> {
    let args = network_create_args(&name, subnet.as_deref(), internal);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_cmd(&refs).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn delete_network(name: String) -> Result<(), String> {
    run_cmd(&["network", "delete", &name])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn prune_networks() -> Result<String, String> {
    run_cmd(&["network", "prune"])
        .map(text_output)
        .map_err(|e| e.message)
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

    #[test]
    fn volume_create_args_names_the_volume() {
        assert_eq!(volume_create_args("data", None), vec!["volume", "create", "data"]);
    }

    #[test]
    fn volume_create_args_passes_a_size_when_one_was_asked_for() {
        assert_eq!(
            volume_create_args("data", Some("10G")),
            vec!["volume", "create", "-s", "10G", "data"]
        );
    }

    #[test]
    fn network_create_args_names_the_network() {
        assert_eq!(network_create_args("web", None, false), vec!["network", "create", "web"]);
    }

    #[test]
    fn network_create_args_carries_subnet_and_internal() {
        assert_eq!(
            network_create_args("web", Some("10.1.0.0/24"), true),
            vec!["network", "create", "--internal", "--subnet", "10.1.0.0/24", "web"]
        );
    }

    /// A container mounting a named volume, as `container ls -a` reports it.
    fn container_using(id: &str, volume: &str, network: &str) -> Value {
        json!({
            "id": id,
            "configuration": {
                "mounts": [{
                    "destination": "/data",
                    "source": "/some/path/volume.img",
                    "type": { "volume": { "name": volume, "format": "ext4" } }
                }],
                "networks": [{ "network": network }]
            }
        })
    }

    #[test]
    fn a_volume_no_container_mounts_has_no_users() {
        let cs = json!([container_using("c1", "other", "default")]);
        assert!(volume_users(&cs, "data").is_empty());
    }

    #[test]
    fn volume_users_names_every_container_mounting_it() {
        let cs = json!([
            container_using("c1", "data", "default"),
            container_using("c2", "other", "default"),
            container_using("c3", "data", "default"),
        ]);
        assert_eq!(volume_users(&cs, "data"), vec!["c1".to_string(), "c3".to_string()]);
    }

    // A bind mount has a host path but no `type.volume`, and must never be
    // mistaken for a named volume of the same name.
    #[test]
    fn a_bind_mount_is_not_a_volume_user() {
        let cs = json!([{
            "id": "c1",
            "configuration": { "mounts": [{ "source": "/data", "type": { "virtiofs": {} } }] }
        }]);
        assert!(volume_users(&cs, "data").is_empty());
    }

    #[test]
    fn network_users_names_every_container_attached() {
        let cs = json!([
            container_using("c1", "v", "default"),
            container_using("c2", "v", "web"),
        ]);
        assert_eq!(network_users(&cs, "default"), vec!["c1".to_string()]);
        assert_eq!(network_users(&cs, "web"), vec!["c2".to_string()]);
    }

    // `container network delete default` fails with "cannot delete a builtin
    // network", so the UI needs to know before offering the button.
    #[test]
    fn the_role_label_marks_a_builtin_network() {
        let net = json!({
            "id": "default",
            "configuration": { "labels": { "com.apple.container.resource.role": "builtin" } }
        });
        assert!(is_builtin_network(&net));
    }

    #[test]
    fn a_user_created_network_is_not_builtin() {
        let net = json!({ "id": "web", "configuration": { "labels": {} } });
        assert!(!is_builtin_network(&net));
        assert!(!is_builtin_network(&json!({ "id": "web" })));
    }

    #[test]
    fn a_path_that_does_not_exist_has_no_allocation() {
        assert_eq!(allocated_bytes(GONE), None);
    }

    // The whole reason this function exists: a volume image is sparse, so its
    // apparent length is the provisioned ceiling and says nothing about disk use.
    #[test]
    fn allocation_of_a_sparse_file_is_far_below_its_length() {
        let path = std::env::temp_dir().join("acd-sparse-test.img");
        let f = std::fs::File::create(&path).expect("create");
        let provisioned = 1024 * 1024 * 1024;
        f.set_len(provisioned).expect("set_len");
        drop(f);

        let allocated = allocated_bytes(path.to_str().unwrap()).expect("allocated");
        assert!(
            allocated < provisioned / 100,
            "a freshly sized sparse file allocated {allocated} of {provisioned}"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn annotate_volumes_records_disk_use_and_users() {
        let volumes = json!([{
            "id": "data",
            "configuration": { "name": "data", "source": REAL }
        }]);
        let containers = json!([container_using("c1", "data", "default")]);
        let out = annotate_volumes(volumes, &containers);
        assert_eq!(out[0]["inUseBy"], json!(["c1"]));
        assert!(out[0]["diskUsageBytes"].is_number());
    }

    #[test]
    fn annotate_volumes_leaves_disk_use_absent_when_the_image_is_gone() {
        let volumes = json!([{ "id": "data", "configuration": { "name": "data", "source": GONE } }]);
        let out = annotate_volumes(volumes, &json!([]));
        assert_eq!(out[0]["inUseBy"], json!([]));
        assert!(out[0].get("diskUsageBytes").is_none());
    }

    #[test]
    fn annotate_networks_records_users_and_builtin_status() {
        let networks = json!([
            { "id": "default", "configuration": { "labels": { "com.apple.container.resource.role": "builtin" } } },
            { "id": "web", "configuration": { "labels": {} } },
        ]);
        let containers = json!([container_using("c1", "v", "web")]);
        let out = annotate_networks(networks, &containers);
        assert_eq!(out[0]["isBuiltin"], json!(true));
        assert_eq!(out[0]["inUseBy"], json!([]));
        assert_eq!(out[1]["isBuiltin"], json!(false));
        assert_eq!(out[1]["inUseBy"], json!(["c1"]));
    }
}
