use serde_json::Value;
use std::process::{Child, Command, Stdio};

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

    if !out.status.success() {
        return Err(CmdError {
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
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
