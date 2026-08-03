//! Turning build options into a `container build` argv, and checking the
//! paths before anything spawns.
//!
//! Nothing here runs a process or emits an event. Keeping it that way is what
//! makes the option handling testable, the same reason `recreate.rs` is pure.

use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOptions {
    pub context: String,
    pub tag: String,
    #[serde(default)]
    pub dockerfile: Option<String>,
    #[serde(default)]
    pub no_cache: bool,
    #[serde(default)]
    pub build_args: Vec<KeyValue>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub labels: Vec<KeyValue>,
    #[serde(default)]
    pub pull: bool,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory: Option<String>,
}

/// `container build` accepts either name and picks for you. The app resolves
/// it up front so a missing file is reported as a missing file rather than as
/// whatever the builder says when handed nothing.
const DOCKERFILE_NAMES: [&str; 2] = ["Dockerfile", "Containerfile"];

/// A trimmed value, or `None` when it is absent or blank.
fn present(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// Check the options and return the Dockerfile the build will use.
pub fn validate(opts: &BuildOptions) -> Result<PathBuf, String> {
    if opts.tag.trim().is_empty() {
        return Err("A tag is required.".to_string());
    }
    if opts.context.trim().is_empty() {
        return Err("A build context directory is required.".to_string());
    }
    let context = Path::new(opts.context.trim());
    if !context.exists() {
        return Err(format!("Build context not found: {}", opts.context));
    }
    if !context.is_dir() {
        return Err(format!(
            "Build context is not a directory: {}",
            opts.context
        ));
    }
    if let Some(explicit) = present(&opts.dockerfile) {
        let path = PathBuf::from(explicit);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("Dockerfile not found: {explicit}"))
        };
    }
    for name in DOCKERFILE_NAMES {
        let candidate = context.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "No Dockerfile or Containerfile in {}",
        opts.context
    ))
}

/// Every value goes in as its own argv entry, so there is no shell involved
/// and nothing to quote.
pub fn build_argv(opts: &BuildOptions, dockerfile: &Path) -> Vec<String> {
    let mut argv = vec![
        "build".to_string(),
        // The log pane renders whole lines; `auto` would emit cursor movement.
        "--progress".to_string(),
        "plain".to_string(),
        "-t".to_string(),
        opts.tag.trim().to_string(),
        "-f".to_string(),
        dockerfile.to_string_lossy().into_owned(),
    ];
    if opts.no_cache {
        argv.push("--no-cache".to_string());
    }
    if opts.pull {
        argv.push("--pull".to_string());
    }
    for pair in opts.build_args.iter().filter(|p| !p.key.trim().is_empty()) {
        argv.push("--build-arg".to_string());
        argv.push(format!("{}={}", pair.key.trim(), pair.value.trim()));
    }
    for pair in opts.labels.iter().filter(|p| !p.key.trim().is_empty()) {
        argv.push("--label".to_string());
        argv.push(format!("{}={}", pair.key.trim(), pair.value.trim()));
    }
    if let Some(target) = present(&opts.target) {
        argv.push("--target".to_string());
        argv.push(target.to_string());
    }
    if let Some(platform) = present(&opts.platform) {
        argv.push("--platform".to_string());
        argv.push(platform.to_string());
    }
    if let Some(cpus) = opts.cpus {
        argv.push("--cpus".to_string());
        argv.push(cpus.to_string());
    }
    if let Some(memory) = present(&opts.memory) {
        argv.push("--memory".to_string());
        argv.push(memory.to_string());
    }
    argv.push(opts.context.trim().to_string());
    argv
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn ctx_with(name: &str) -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(name), "FROM scratch\n").unwrap();
        dir
    }

    fn opts(context: &str) -> BuildOptions {
        BuildOptions {
            context: context.to_string(),
            tag: "app:latest".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn resolves_a_dockerfile_in_the_context() {
        let dir = ctx_with("Dockerfile");
        let got = validate(&opts(dir.path().to_str().unwrap())).unwrap();
        assert_eq!(got, dir.path().join("Dockerfile"));
    }

    // The CLI builds from either name, so refusing a Containerfile would be
    // the app inventing a restriction the tool does not have.
    #[test]
    fn falls_back_to_containerfile() {
        let dir = ctx_with("Containerfile");
        let got = validate(&opts(dir.path().to_str().unwrap())).unwrap();
        assert_eq!(got, dir.path().join("Containerfile"));
    }

    #[test]
    fn rejects_a_context_with_no_dockerfile() {
        let dir = tempdir().unwrap();
        let err = validate(&opts(dir.path().to_str().unwrap())).unwrap_err();
        assert!(err.contains("No Dockerfile"), "{err}");
    }

    #[test]
    fn rejects_a_missing_context() {
        let err = validate(&opts("/no/such/directory")).unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    #[test]
    fn rejects_a_context_that_is_a_file() {
        let dir = ctx_with("Dockerfile");
        let path = dir.path().join("Dockerfile");
        let err = validate(&opts(path.to_str().unwrap())).unwrap_err();
        assert!(err.contains("not a directory"), "{err}");
    }

    #[test]
    fn rejects_an_empty_tag() {
        let dir = ctx_with("Dockerfile");
        let mut o = opts(dir.path().to_str().unwrap());
        o.tag = "   ".to_string();
        assert!(validate(&o).unwrap_err().contains("tag"));
    }

    #[test]
    fn rejects_an_explicit_dockerfile_that_does_not_exist() {
        let dir = ctx_with("Dockerfile");
        let mut o = opts(dir.path().to_str().unwrap());
        o.dockerfile = Some("/no/such/Dockerfile".to_string());
        assert!(validate(&o).unwrap_err().contains("not found"));
    }

    // The pane renders whole lines, so `auto` (which emits cursor movement)
    // would arrive as unreadable escape sequences.
    #[test]
    fn always_asks_for_plain_progress() {
        let argv = build_argv(&opts("/ctx"), Path::new("/ctx/Dockerfile"));
        let i = argv
            .iter()
            .position(|a| a == "--progress")
            .expect("--progress");
        assert_eq!(argv[i + 1], "plain");
    }

    #[test]
    fn emits_tag_dockerfile_and_context() {
        let argv = build_argv(&opts("/ctx"), Path::new("/ctx/Dockerfile"));
        assert_eq!(argv[0], "build");
        assert_eq!(argv.last().unwrap(), "/ctx");
        let t = argv.iter().position(|a| a == "-t").unwrap();
        assert_eq!(argv[t + 1], "app:latest");
        let f = argv.iter().position(|a| a == "-f").unwrap();
        assert_eq!(argv[f + 1], "/ctx/Dockerfile");
    }

    #[test]
    fn unset_options_emit_no_flags() {
        let argv = build_argv(&opts("/ctx"), Path::new("/ctx/Dockerfile"));
        for flag in [
            "--no-cache",
            "--pull",
            "--build-arg",
            "--label",
            "--target",
            "--platform",
            "--cpus",
            "--memory",
        ] {
            assert!(!argv.iter().any(|a| a == flag), "{flag} should be absent");
        }
    }

    #[test]
    fn each_pair_emits_its_own_flag() {
        let mut o = opts("/ctx");
        // " B " and " 2 " must be trimmed to "B" and "2"; "  " key must be dropped.
        o.build_args = vec![kv("A", "1"), kv(" B ", " 2 "), kv("  ", "orphan")];
        // " x.y " key must be trimmed; "  " key must be dropped.
        o.labels = vec![kv(" x.y ", "val"), kv("  ", "ghost")];
        let argv = build_argv(&o, Path::new("/ctx/Dockerfile"));
        // blank-key pair is filtered out, so count is 2 not 3
        assert_eq!(argv.iter().filter(|a| *a == "--build-arg").count(), 2);
        assert!(argv.contains(&"A=1".to_string()));
        assert!(argv.contains(&"B=2".to_string()), "expected trimmed B=2");
        // no trace of the orphan pair
        assert!(
            !argv.iter().any(|a| a.contains("orphan")),
            "blank-key build-arg leaked"
        );
        // label loop: one clean pair after filtering
        assert_eq!(argv.iter().filter(|a| *a == "--label").count(), 1);
        assert!(
            argv.contains(&"x.y=val".to_string()),
            "expected trimmed x.y=val"
        );
        assert!(
            !argv.iter().any(|a| a.contains("ghost")),
            "blank-key label leaked"
        );
    }

    #[test]
    fn advanced_options_are_passed_through() {
        let mut o = opts("/ctx");
        o.no_cache = true;
        o.pull = true;
        o.target = Some("builder".to_string());
        o.platform = Some("linux/amd64".to_string());
        o.cpus = Some(4);
        o.memory = Some("8G".to_string());
        let argv = build_argv(&o, Path::new("/ctx/Dockerfile"));
        assert!(argv.contains(&"--no-cache".to_string()));
        assert!(argv.contains(&"--pull".to_string()));
        assert!(argv.contains(&"linux/amd64".to_string()));
        assert!(argv.contains(&"builder".to_string()));
        assert!(argv.contains(&"4".to_string()));
        assert!(argv.contains(&"8G".to_string()));
        assert_eq!(argv.last().unwrap(), "/ctx");
    }

    // Docker and BuildKit both accept a Dockerfile outside the context directory;
    // inventing a restriction the CLI does not have would be wrong, as the
    // falls_back_to_containerfile comment already notes.
    #[test]
    fn accepts_an_explicit_dockerfile_outside_the_context() {
        let ctx = tempdir().unwrap(); // no Dockerfile inside
        let df_dir = ctx_with("Dockerfile"); // Dockerfile in a separate dir
        let mut o = opts(ctx.path().to_str().unwrap());
        o.dockerfile = Some(
            df_dir
                .path()
                .join("Dockerfile")
                .to_str()
                .unwrap()
                .to_string(),
        );
        assert_eq!(validate(&o).unwrap(), df_dir.path().join("Dockerfile"));
    }

    #[test]
    fn blank_option_strings_emit_no_flags() {
        let mut o = opts("/ctx");
        o.target = Some("   ".to_string());
        o.platform = Some("   ".to_string());
        o.memory = Some("   ".to_string());
        let argv = build_argv(&o, Path::new("/ctx/Dockerfile"));
        assert!(
            !argv.iter().any(|a| a == "--target"),
            "--target should be absent"
        );
        assert!(
            !argv.iter().any(|a| a == "--platform"),
            "--platform should be absent"
        );
        assert!(
            !argv.iter().any(|a| a == "--memory"),
            "--memory should be absent"
        );
    }

    fn kv(k: &str, v: &str) -> KeyValue {
        KeyValue {
            key: k.to_string(),
            value: v.to_string(),
        }
    }
}
