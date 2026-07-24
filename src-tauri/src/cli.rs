use serde_json::Value;
use std::process::Command;

#[derive(Debug)]
pub struct CmdError {
    pub message: String,
}

/// Run `container <args>`, appending --format json for list commands.
/// Returns parsed JSON on success.
pub fn run_cmd(args: &[&str]) -> Result<Value, CmdError> {
    let json_prefixes: &[&[&str]] = &[
        &["ls"],
        &["image", "ls"],
        &["machine", "ls"],
        &["stats"],
        &["system", "status"],
    ];
    let needs_json = json_prefixes.iter().any(|p| args.starts_with(p));
    let mut full: Vec<&str> = args.to_vec();
    if needs_json {
        full.extend_from_slice(&["--format", "json"]);
    }

    let out = Command::new("container")
        .args(&full)
        .output()
        .map_err(|e| CmdError { message: format!("CLI not found: {e}") })?;

    if !out.status.success() {
        return Err(CmdError {
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Value::Array(vec![]));
    }

    if needs_json {
        serde_json::from_str(trimmed).map_err(|e| CmdError {
            message: format!("JSON parse error: {e}"),
        })
    } else {
        Ok(serde_json::from_str(trimmed)
            .unwrap_or_else(|_| Value::String(trimmed.to_string())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_cmd_errors_on_unknown_subcommand() {
        let result = run_cmd(&["__no_such_cmd__"]);
        assert!(result.is_err());
    }
}
