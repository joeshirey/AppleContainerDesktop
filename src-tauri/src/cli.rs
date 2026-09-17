use serde_json::Value;
use std::process::{Child, Command, Output, Stdio};

#[derive(Debug)]
pub struct CmdError {
    pub message: String,
}

/// Resolve the `container` binary path.
/// macOS GUI apps launched from Finder/Dock only get a minimal PATH, so probe
/// the two Homebrew locations before falling back to a plain PATH lookup.
fn container_bin() -> std::path::PathBuf {
    for candidate in ["/opt/homebrew/bin/container", "/usr/local/bin/container"] {
        let p = std::path::Path::new(candidate);
        if p.exists() {
            return p.to_path_buf();
        }
    }
    std::path::PathBuf::from("container")
}

/// Whether this command should be asked for JSON rather than its default
/// human-readable table.
fn needs_json(args: &[&str]) -> bool {
    let json_prefixes: &[&[&str]] = &[
        &["ls"],
        &["image", "ls"],
        &["machine", "ls"],
        &["volume", "ls"],
        &["network", "ls"],
        &["stats"],
        &["system", "status"],
        &["builder", "status"],
    ];
    json_prefixes.iter().any(|p| args.starts_with(p))
}

/// Run `container <args>`, appending --format json for list commands.
/// Returns parsed JSON on success.
pub fn run_cmd(args: &[&str]) -> Result<Value, CmdError> {
    let needs_json = needs_json(args);
    let mut full: Vec<&str> = args.to_vec();
    if needs_json {
        full.extend_from_slice(&["--format", "json"]);
    }

    let out = Command::new(container_bin())
        .args(&full)
        .output()
        .map_err(|e| CmdError {
            message: format!("CLI not found: {e}"),
        })?;

    parse_output(args, &out)
}

/// Status uses exit code 1 for an unavailable service, with the reason in
/// stdout JSON. Other commands must still fail on every nonzero exit code.
fn parse_output(args: &[&str], out: &Output) -> Result<Value, CmdError> {
    let needs_json = needs_json(args);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    let system_status = args.starts_with(&["system", "status"]);
    let payload = if system_status {
        serde_json::from_str::<Value>(trimmed).ok()
    } else {
        None
    };

    if system_status && out.status.code() == Some(1) {
        if let Some(value) = &payload {
            if matches!(
                value.get("status").and_then(Value::as_str),
                Some("not running" | "unregistered")
            ) {
                return Ok(value.clone());
            }
        }
    }

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            format!("container command failed ({})", out.status)
        };
        return Err(CmdError { message: detail });
    }

    if system_status {
        return payload
            .filter(|value| {
                matches!(
                    value.get("status").and_then(Value::as_str),
                    Some("running" | "not running" | "unregistered")
                )
            })
            .ok_or_else(|| CmdError {
                message: "Invalid container system status response".to_string(),
            });
    }

    if trimmed.is_empty() {
        return if needs_json {
            Ok(Value::Array(vec![]))
        } else {
            Ok(Value::String(String::new()))
        };
    }

    if needs_json {
        serde_json::from_str(trimmed).map_err(|e| CmdError {
            message: format!("JSON parse error: {e}"),
        })
    } else {
        Ok(serde_json::from_str(trimmed).unwrap_or_else(|_| Value::String(trimmed.to_string())))
    }
}

/// Start `container <args>` with stdout and stderr piped and stdin closed,
/// returning the child without waiting for it.
///
/// `run_cmd` blocks until exit and parses the result, which is right for every
/// command that finishes in under a second. A build does not, and its output
/// matters while it runs, so it needs the process handle instead.
///
/// Both pipes must be drained continuously; if either reading thread stops
/// before the child exits, the child will block once the pipe buffer fills.
pub fn spawn_cmd(args: &[String]) -> Result<Child, CmdError> {
    Command::new(container_bin())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CmdError {
            message: format!("CLI not found: {e}"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    fn output(code: i32, stdout: &str, stderr: &str) -> Output {
        Output {
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[test]
    fn stopped_system_status_preserves_json_on_exit_one() {
        for status in ["unregistered", "not running"] {
            let payload = serde_json::json!({ "status": status });
            let result =
                parse_output(&["system", "status"], &output(1, &payload.to_string(), "")).unwrap();
            assert_eq!(result, payload);
        }
    }

    #[test]
    fn status_exception_does_not_hide_other_failures() {
        for (args, code, payload) in [
            (vec!["system", "status"], 2, r#"{"status":"unregistered"}"#),
            (vec!["system", "status"], 1, r#"{"status":"running"}"#),
            (vec!["system", "status"], 1, r#"{"status":"unknown"}"#),
            (vec!["ls"], 1, r#"{"status":"not running"}"#),
            (vec!["system", "start"], 1, r#"{"status":"unregistered"}"#),
        ] {
            assert!(parse_output(&args, &output(code, payload, "failed")).is_err());
        }
    }

    #[test]
    fn invalid_status_payloads_are_errors_even_on_success() {
        for payload in ["", "[]", "{}", "not json", r#"{"status":"unknown"}"#] {
            assert!(parse_output(&["system", "status"], &output(0, payload, "")).is_err());
        }
    }

    #[test]
    fn failed_commands_always_have_a_useful_message() {
        assert_eq!(
            parse_output(&["ls"], &output(1, "stdout detail", "stderr detail"))
                .unwrap_err()
                .message,
            "stderr detail"
        );
        assert_eq!(
            parse_output(&["ls"], &output(1, "stdout detail", ""))
                .unwrap_err()
                .message,
            "stdout detail"
        );
        assert!(parse_output(&["ls"], &output(1, "", ""))
            .unwrap_err()
            .message
            .contains("exit status: 1"));
    }

    #[test]
    fn legacy_running_status_is_still_supported() {
        let payload =
            r#"{"status":"running","appRoot":"/tmp/container","apiServerVersion":"1.2.2"}"#;
        let result = parse_output(&["system", "status"], &output(0, payload, "")).unwrap();
        assert_eq!(result["status"], "running");
    }

    #[test]
    fn expanded_running_status_is_supported() {
        let payload = include_str!("../../src/test/fixtures/container-1.4.1/system-running.json");
        let result = parse_output(&["system", "status"], &output(0, payload, "")).unwrap();
        assert_eq!(result["status"], "running");
        assert_eq!(result["client"]["version"], "1.4.1");
        assert_eq!(result["server"]["version"], "1.4.1");
    }

    #[test]
    fn json_paths_accept_both_slash_encodings() {
        for payload in [
            r#"[{"source":"/tmp/data"}]"#,
            r#"[{"source":"\/tmp\/data"}]"#,
        ] {
            let result = parse_output(&["ls"], &output(0, payload, "")).unwrap();
            assert_eq!(result[0]["source"], "/tmp/data");
        }
    }

    #[test]
    fn run_cmd_errors_on_unknown_subcommand() {
        let result = run_cmd(&["__no_such_cmd__"]);
        assert!(result.is_err());
    }

    // Every list command the app parses as JSON has to be named here. Miss one
    // and the CLI prints its human table instead, which parses as a bare string
    // and reaches the frontend as something it cannot map over.
    #[test]
    fn every_list_command_asks_for_json() {
        for args in [
            &["ls", "-a"][..],
            &["image", "ls"][..],
            &["machine", "ls"][..],
            &["volume", "ls"][..],
            &["network", "ls"][..],
            &["stats", "--no-stream", "c1"][..],
            &["system", "status"][..],
            &["builder", "status"][..],
        ] {
            assert!(needs_json(args), "{args:?} should be requested as JSON");
        }
    }

    #[test]
    fn commands_that_print_prose_are_left_alone() {
        for args in [
            &["volume", "prune"][..],
            &["network", "create", "web"][..],
            &["logs", "-n", "10", "c1"][..],
            &["machine", "run", "--name", "m", "nproc"][..],
        ] {
            assert!(
                !needs_json(args),
                "{args:?} should not be requested as JSON"
            );
        }
    }

    // CI deliberately has no `container` binary, so both outcomes are valid:
    // where it exists the child must have both pipes, and where it does not
    // the error must be the same one `run_cmd` reports.
    #[test]
    fn spawn_cmd_pipes_both_output_streams() {
        match spawn_cmd(&["--version".to_string()]) {
            Ok(mut child) => {
                assert!(child.stdout.is_some(), "stdout must be piped");
                assert!(child.stderr.is_some(), "stderr must be piped");
                let _ = child.wait();
            }
            Err(e) => assert!(e.message.contains("CLI not found"), "{}", e.message),
        }
    }
}
