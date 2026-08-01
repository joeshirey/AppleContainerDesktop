//! The builder container: the VM `container build` runs inside.
//!
//! Kept out of `containers.rs`, which is already long enough that finding
//! anything in it is a chore.

use crate::cli::run_cmd;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuilderState {
    /// False when no builder container exists at all, which is what a machine
    /// that has never built anything reports. Distinct from existing but
    /// stopped, because Stop and Delete have nothing to act on.
    pub exists: bool,
    pub running: bool,
    /// The builder's allocation, read from the container's own configuration
    /// and still present while it is stopped. None when there is no builder.
    pub cpus: Option<u64>,
    pub memory_mb: Option<u64>,
    /// The state string the CLI reported, kept so a value this build does not
    /// recognise stays visible instead of being flattened into "stopped".
    pub raw: String,
}

/// Read `container builder status --format json`, which returns the builder as
/// an ordinary container object, or an empty array when none exists.
///
/// Every field is optional on purpose. A CLI upgrade that renames one should
/// cost the view a detail, not crash the command.
pub fn parse_state(value: &Value) -> BuilderState {
    let Some(builder) = value.as_array().and_then(|a| a.first()) else {
        return BuilderState {
            exists: false,
            running: false,
            cpus: None,
            memory_mb: None,
            raw: String::new(),
        };
    };

    let raw = builder
        .pointer("/status/state")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let resources = builder.pointer("/configuration/resources");

    BuilderState {
        exists: true,
        running: raw == "running",
        cpus: resources
            .and_then(|r| r.get("cpus"))
            .and_then(Value::as_u64),
        memory_mb: resources
            .and_then(|r| r.get("memoryInBytes"))
            .and_then(Value::as_u64)
            .map(|bytes| bytes / (1024 * 1024)),
        raw: raw.to_string(),
    }
}

#[tauri::command]
pub fn builder_status() -> Result<BuilderState, String> {
    let value = run_cmd(&["builder", "status"]).map_err(|e| e.message)?;
    Ok(parse_state(&value))
}

#[tauri::command]
pub fn builder_start(cpus: Option<u32>, memory: Option<String>) -> Result<(), String> {
    let cpus_value = cpus.map(|c| c.to_string());
    let mut args = vec!["builder", "start"];
    if let Some(value) = cpus_value.as_deref() {
        args.push("--cpus");
        args.push(value);
    }
    if let Some(value) = memory.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--memory");
        args.push(value);
    }
    run_cmd(&args).map(|_| ()).map_err(|e| e.message)
}

#[tauri::command]
pub fn builder_stop() -> Result<(), String> {
    run_cmd(&["builder", "stop"])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn builder_delete() -> Result<(), String> {
    run_cmd(&["builder", "delete"])
        .map(|_| ())
        .map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn builder(state: &str) -> Value {
        json!([{
            "id": "buildkit",
            "configuration": { "resources": { "cpus": 2, "memoryInBytes": 2147483648u64 } },
            "status": { "state": state }
        }])
    }

    // A machine that has never built anything has no builder container at
    // all. The CLI reports that as an empty array, not as an error.
    #[test]
    fn no_builder_at_all_does_not_exist() {
        let state = parse_state(&json!([]));
        assert!(!state.exists);
        assert!(!state.running);
        assert_eq!(state.cpus, None);
        assert_eq!(state.memory_mb, None);
    }

    #[test]
    fn a_running_builder_is_running() {
        let state = parse_state(&builder("running"));
        assert!(state.exists);
        assert!(state.running);
        assert_eq!(state.raw, "running");
    }

    // Stopped is not the same as absent: the container is still there, so
    // Stop and Delete have something to act on and the allocation is known.
    #[test]
    fn a_stopped_builder_still_exists_and_reports_its_allocation() {
        let state = parse_state(&builder("stopped"));
        assert!(state.exists);
        assert!(!state.running);
        assert_eq!(state.cpus, Some(2));
        assert_eq!(state.memory_mb, Some(2048));
    }

    // Only the exact string "running" counts. A state this build does not
    // know about must not be presented as running, or the view offers Stop
    // for something that is not up.
    #[test]
    fn an_unrecognised_state_is_not_running_but_is_still_shown() {
        let state = parse_state(&builder("restarting"));
        assert!(state.exists);
        assert!(!state.running);
        assert_eq!(state.raw, "restarting");
    }

    // A future CLI that drops or renames these fields must degrade to
    // "exists, not running" rather than panicking on a missing key.
    #[test]
    fn missing_fields_degrade_instead_of_panicking() {
        let state = parse_state(&json!([{ "id": "buildkit" }]));
        assert!(state.exists);
        assert!(!state.running);
        assert_eq!(state.cpus, None);
        assert_eq!(state.memory_mb, None);
        assert_eq!(state.raw, "");
    }

    // The CLI reports bytes; the view shows MB, the same unit the CLI's own
    // table prints.
    #[test]
    fn memory_is_reported_in_megabytes() {
        let state = parse_state(&json!([{
            "configuration": { "resources": { "memoryInBytes": 8589934592u64 } },
            "status": { "state": "running" }
        }]));
        assert_eq!(state.memory_mb, Some(8192));
    }
}
