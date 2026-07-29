//! Rebuild a `container run` invocation from the JSON `container inspect`
//! reports for an existing container, so that recreating a container to change
//! one setting does not silently drop every other setting.

use serde_json::Value;

/// The command line that will recreate a container, plus any settings that the
/// `container run` CLI has no flag for and that recreating will therefore lose.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct RecreatePlan {
    pub args: Vec<String>,
    pub unsupported: Vec<String>,
}

/// Build `container run` arguments from a container's `configuration` object.
///
/// `edits` overrides individual settings; a key that is absent or null is taken
/// from `config` unchanged.
pub fn build_run_args(config: &Value, edits: &Value) -> RecreatePlan {
    let mut args: Vec<String> = vec!["run".into(), "-d".into()];
    let mut unsupported: Vec<String> = vec![];

    // A macro rather than a closure so that bare `args.push` for valueless
    // flags does not collide with an outstanding mutable borrow.
    macro_rules! push {
        ($flag:expr, $value:expr) => {{
            args.push($flag.to_string());
            args.push($value);
        }};
    }

    if let Some(id) = config.get("id").and_then(Value::as_str) {
        push!("--name", id.into());
    }
    let cpus = match edit(edits, "cpus") {
        Some(v) => scalar(v),
        None => config
            .pointer("/resources/cpus")
            .and_then(Value::as_u64)
            .map(|c| c.to_string())
            .unwrap_or_default(),
    };
    if !cpus.is_empty() {
        push!("--cpus", cpus);
    }
    let memory = match edit(edits, "memory") {
        Some(v) => scalar(v),
        None => config
            .pointer("/resources/memoryInBytes")
            .and_then(Value::as_u64)
            .map(|m| m.to_string())
            .unwrap_or_default(),
    };
    if !memory.is_empty() {
        push!("--memory", memory);
    }

    let env = match edit(edits, "env") {
        Some(v) => strings(Some(v)),
        None => strings(config.pointer("/initProcess/environment")),
    };
    for e in env.into_iter().filter(|e| !e.trim().is_empty()) {
        push!("-e", e);
    }

    let ports = match edit(edits, "ports") {
        Some(v) => strings(Some(v)),
        None => config
            .get("publishedPorts")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(published_port).collect())
            .unwrap_or_default(),
    };
    for p in ports.into_iter().filter(|p| !p.trim().is_empty()) {
        push!("-p", p);
    }

    for s in config
        .get("publishedSockets")
        .and_then(Value::as_array)
        .unwrap_or(&vec![])
    {
        let host = s.get("hostPath").and_then(Value::as_str).unwrap_or("");
        let guest = s.get("containerPath").and_then(Value::as_str).unwrap_or("");
        push!("--publish-socket", format!("{host}:{guest}"));
    }
    for m in config
        .get("mounts")
        .and_then(Value::as_array)
        .unwrap_or(&vec![])
    {
        let dest = m.get("destination").and_then(Value::as_str).unwrap_or("");
        let kind = m.get("type");
        if kind.map(|t| t.get("tmpfs").is_some()).unwrap_or(false) {
            push!("--tmpfs", dest.into());
            continue;
        }
        // A named volume reports its backing disk image as `source`; `container
        // run -v` wants the volume name instead.
        let source = kind
            .and_then(|t| t.pointer("/volume/name"))
            .and_then(Value::as_str)
            .or_else(|| m.get("source").and_then(Value::as_str))
            .unwrap_or("");
        let readonly = strings(m.get("options")).iter().any(|o| o == "ro");
        let suffix = if readonly { ":ro" } else { "" };
        push!("-v", format!("{source}:{dest}{suffix}"));
    }

    let init = config.get("initProcess");
    if let Some(exe) = init
        .and_then(|p| p.get("executable"))
        .and_then(Value::as_str)
    {
        push!("--entrypoint", exe.into());
    }
    if let Some(wd) = init
        .and_then(|p| p.get("workingDirectory"))
        .and_then(Value::as_str)
    {
        push!("-w", wd.into());
    }
    // A user is reported either as the raw `user[:group]` string it was given
    // as, or as resolved numeric ids.
    if let Some(raw) = init
        .and_then(|p| p.pointer("/user/raw/userString"))
        .and_then(Value::as_str)
    {
        push!("-u", raw.into());
    } else if let Some(id) = init.and_then(|p| p.pointer("/user/id")) {
        if let Some(uid) = id.get("uid").and_then(Value::as_u64) {
            push!("--uid", uid.to_string());
        }
        if let Some(gid) = id.get("gid").and_then(Value::as_u64) {
            push!("--gid", gid.to_string());
        }
    }
    if init
        .and_then(|p| p.get("terminal"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        args.push("-t".into());
    }

    if let Some(labels) = config.get("labels").and_then(Value::as_object) {
        for (k, v) in labels {
            push!("-l", format!("{k}={}", v.as_str().unwrap_or("")));
        }
    }

    for (key, flag) in [
        ("readOnly", "--read-only"),
        ("rosetta", "--rosetta"),
        ("ssh", "--ssh"),
        ("virtualization", "--virtualization"),
        ("useInit", "--init"),
    ] {
        if config.get(key).and_then(Value::as_bool).unwrap_or(false) {
            args.push(flag.into());
        }
    }

    for c in strings(config.get("capAdd")) {
        push!("--cap-add", c);
    }
    for c in strings(config.get("capDrop")) {
        push!("--cap-drop", c);
    }

    for (ptr, flag) in [
        ("/dns/nameservers", "--dns"),
        ("/dns/options", "--dns-option"),
        ("/dns/searchDomains", "--dns-search"),
    ] {
        for v in strings(config.pointer(ptr)) {
            push!(flag, v);
        }
    }
    if let Some(d) = config.pointer("/dns/domain").and_then(Value::as_str) {
        push!("--dns-domain", d.into());
    }

    for n in config
        .get("networks")
        .and_then(Value::as_array)
        .unwrap_or(&vec![])
    {
        let Some(name) = n.get("network").and_then(Value::as_str) else {
            continue;
        };
        // `--network` accepts only mac and mtu options; the reported hostname
        // has no `run` flag and is handled as an unsupported setting.
        let mut spec = name.to_string();
        if let Some(mac) = n.pointer("/options/mac").and_then(Value::as_str) {
            spec.push_str(&format!(",mac={mac}"));
        }
        if let Some(mtu) = n.pointer("/options/mtu").and_then(Value::as_u64) {
            spec.push_str(&format!(",mtu={mtu}"));
        }
        push!("--network", spec);
    }

    if let Some(a) = config.pointer("/platform/architecture").and_then(Value::as_str) {
        push!("--arch", a.into());
    }
    if let Some(o) = config.pointer("/platform/os").and_then(Value::as_str) {
        push!("--os", o.into());
    }
    if let Some(r) = config.get("runtimeHandler").and_then(Value::as_str) {
        push!("--runtime", r.into());
    }

    if let Some(img) = config.pointer("/image/reference").and_then(Value::as_str) {
        args.push(img.into());
    }
    // Init process arguments are positional and must follow the image.
    args.extend(strings(config.pointer("/initProcess/arguments")));

    // Settings `container run` has no flag for. Recreating drops them, so the
    // caller can warn instead of losing them silently.
    if let Some(s) = config.get("sysctls").and_then(Value::as_object) {
        if !s.is_empty() {
            let keys: Vec<&str> = s.keys().map(String::as_str).collect();
            unsupported.push(format!("sysctls ({})", keys.join(", ")));
        }
    }
    if let Some(g) = config
        .pointer("/initProcess/supplementalGroups")
        .and_then(Value::as_array)
    {
        if !g.is_empty() {
            unsupported.push(format!("{} supplemental group(s)", g.len()));
        }
    }
    if let Some(r) = config
        .pointer("/initProcess/rlimits")
        .and_then(Value::as_array)
    {
        if !r.is_empty() {
            unsupported.push(format!("{} resource limit(s)", r.len()));
        }
    }
    let id = config.get("id").and_then(Value::as_str).unwrap_or("");
    for n in config
        .get("networks")
        .and_then(Value::as_array)
        .unwrap_or(&vec![])
    {
        match n.pointer("/options/hostname").and_then(Value::as_str) {
            // The default hostname is the container id, so only a hostname that
            // differs from it represents something the rebuild cannot restore.
            Some(h) if h != id => {
                unsupported.push(format!("hostname \"{h}\" (defaults to the container name)"))
            }
            _ => {}
        }
    }

    RecreatePlan { args, unsupported }
}

/// Pull the `configuration` object out of `container inspect` output, which is
/// an array of containers but may be a bare object.
pub fn config_of(inspect: &Value) -> Option<&Value> {
    let entry = match inspect {
        Value::Array(a) => a.first()?,
        other => other,
    };
    entry.get("configuration")
}

/// Read an override from the edits object, treating null as "not supplied".
fn edit<'a>(edits: &'a Value, key: &str) -> Option<&'a Value> {
    match edits.get(key) {
        Some(Value::Null) | None => None,
        Some(v) => Some(v),
    }
}

/// Render a scalar edit value (the UI sends numbers as strings) trimmed.
fn scalar(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Render one entry of `publishedPorts` as a `-p` spec:
/// `[host-ip:]host-port:container-port[/protocol]`.
fn published_port(p: &Value) -> String {
    let host_port = p.get("hostPort").and_then(Value::as_u64).unwrap_or(0);
    let container_port = p.get("containerPort").and_then(Value::as_u64).unwrap_or(0);
    let addr = match p.get("hostAddress").and_then(Value::as_str) {
        Some(a) if !a.is_empty() && a != "0.0.0.0" => format!("{a}:"),
        _ => String::new(),
    };
    let proto = match p.get("proto").and_then(Value::as_str) {
        Some(pr) if !pr.eq_ignore_ascii_case("tcp") => format!("/{pr}"),
        _ => String::new(),
    };
    format!("{addr}{host_port}:{container_port}{proto}")
}

/// Collect a JSON array of strings, tolerating a missing or non-array value.
fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plan(config: Value) -> RecreatePlan {
        build_run_args(&config, &json!({}))
    }

    /// Assert that `needle` appears as a consecutive run inside `args`.
    fn assert_has(args: &[String], needle: &[&str]) {
        let owned: Vec<String> = needle.iter().map(|s| s.to_string()).collect();
        assert!(
            args.windows(owned.len()).any(|w| w == owned.as_slice()),
            "expected {needle:?} within {args:?}"
        );
    }

    #[test]
    fn detached_run_named_after_the_container_with_the_image_last() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
        }));
        assert_eq!(p.args[0], "run");
        assert_has(&p.args, &["-d"]);
        assert_has(&p.args, &["--name", "my-app"]);
        assert_eq!(p.args.last().unwrap(), "nginx:latest");
    }

    #[test]
    fn cpus_and_memory_come_from_the_resources_object() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "resources": { "cpus": 2, "memoryInBytes": 2147483648u64, "cpuOverhead": 1 },
        }));
        assert_has(&p.args, &["--cpus", "2"]);
        assert_has(&p.args, &["--memory", "2147483648"]);
    }

    #[test]
    fn environment_comes_from_the_init_process() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "environment": ["FOO=bar", "PATH=/usr/bin"] },
        }));
        assert_has(&p.args, &["-e", "FOO=bar"]);
        assert_has(&p.args, &["-e", "PATH=/usr/bin"]);
    }

    #[test]
    fn a_published_port_keeps_its_host_address_and_protocol() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "publishedPorts": [
                { "containerPort": 80, "count": 1, "hostAddress": "127.0.0.1", "hostPort": 8080, "proto": "tcp" },
            ],
        }));
        assert_has(&p.args, &["-p", "127.0.0.1:8080:80"]);
    }

    #[test]
    fn a_udp_port_bound_on_all_interfaces_omits_the_address_and_keeps_the_protocol() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "publishedPorts": [
                { "containerPort": 53, "count": 1, "hostAddress": "0.0.0.0", "hostPort": 5353, "proto": "udp" },
            ],
        }));
        assert_has(&p.args, &["-p", "5353:53/udp"]);
    }

    #[test]
    fn a_virtiofs_mount_becomes_a_bind_volume_and_readonly_is_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "mounts": [
                { "destination": "/hosttmp", "options": ["ro"], "source": "/tmp", "type": { "virtiofs": {} } },
                { "destination": "/data", "options": [], "source": "/srv", "type": { "virtiofs": {} } },
            ],
        }));
        assert_has(&p.args, &["-v", "/tmp:/hosttmp:ro"]);
        assert_has(&p.args, &["-v", "/srv:/data"]);
    }

    #[test]
    fn a_named_volume_mount_uses_the_volume_name_not_its_backing_image_path() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "mounts": [{
                "destination": "/data",
                "options": [],
                "source": "/Users/me/Library/Application Support/com.apple.container/volumes/pgdata/volume.img",
                "type": { "volume": { "format": "ext4", "name": "pgdata" } },
            }],
        }));
        assert_has(&p.args, &["-v", "pgdata:/data"]);
    }

    #[test]
    fn a_tmpfs_mount_becomes_a_tmpfs_flag() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "mounts": [
                { "destination": "/scratch", "options": [], "source": "tmpfs", "type": { "tmpfs": {} } },
            ],
        }));
        assert_has(&p.args, &["--tmpfs", "/scratch"]);
        assert!(!p.args.iter().any(|a| a == "-v"), "{:?}", p.args);
    }

    #[test]
    fn the_entrypoint_is_a_flag_but_its_arguments_trail_the_image() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "executable": "/bin/sh", "arguments": ["-c", "sleep 60"] },
        }));
        assert_has(&p.args, &["--entrypoint", "/bin/sh"]);
        let tail = &p.args[p.args.len() - 3..];
        assert_eq!(tail, ["nginx:latest", "-c", "sleep 60"]);
    }

    #[test]
    fn the_working_directory_is_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "workingDirectory": "/srv" },
        }));
        assert_has(&p.args, &["-w", "/srv"]);
    }

    #[test]
    fn a_user_recorded_as_a_raw_string_is_passed_through_as_one() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "user": { "raw": { "userString": "0:0" } } },
        }));
        assert_has(&p.args, &["-u", "0:0"]);
    }

    #[test]
    fn a_user_recorded_as_numeric_ids_becomes_uid_and_gid_flags() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "user": { "id": { "uid": 1000, "gid": 20 } } },
        }));
        assert_has(&p.args, &["--uid", "1000"]);
        assert_has(&p.args, &["--gid", "20"]);
        assert!(!p.args.iter().any(|a| a == "-u"), "{:?}", p.args);
    }

    #[test]
    fn a_tty_is_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "initProcess": { "terminal": true },
        }));
        assert_has(&p.args, &["-t"]);
    }

    #[test]
    fn labels_are_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "labels": { "foo": "bar" },
        }));
        assert_has(&p.args, &["-l", "foo=bar"]);
    }

    #[test]
    fn boolean_settings_only_emit_a_flag_when_they_are_on() {
        let cfg = json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "readOnly": true, "rosetta": true, "ssh": true,
            "virtualization": true, "useInit": true,
        });
        let p = plan(cfg);
        for flag in ["--read-only", "--rosetta", "--ssh", "--virtualization", "--init"] {
            assert_has(&p.args, &[flag]);
        }

        let off = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "readOnly": false, "rosetta": false, "ssh": false,
            "virtualization": false, "useInit": false,
        }));
        for flag in ["--read-only", "--rosetta", "--ssh", "--virtualization", "--init"] {
            assert!(!off.args.iter().any(|a| a == flag), "{flag} in {:?}", off.args);
        }
    }

    #[test]
    fn capabilities_are_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "capAdd": ["ALL"],
            "capDrop": ["CAP_NET_RAW"],
        }));
        assert_has(&p.args, &["--cap-add", "ALL"]);
        assert_has(&p.args, &["--cap-drop", "CAP_NET_RAW"]);
    }

    #[test]
    fn dns_configuration_is_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "dns": {
                "nameservers": ["1.1.1.1"],
                "options": ["ndots:2"],
                "searchDomains": ["example.com"],
                "domain": "corp",
            },
        }));
        assert_has(&p.args, &["--dns", "1.1.1.1"]);
        assert_has(&p.args, &["--dns-option", "ndots:2"]);
        assert_has(&p.args, &["--dns-search", "example.com"]);
        assert_has(&p.args, &["--dns-domain", "corp"]);
    }

    #[test]
    fn an_empty_dns_block_emits_nothing() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "dns": { "nameservers": [], "options": [], "searchDomains": [] },
        }));
        assert!(!p.args.iter().any(|a| a.starts_with("--dns")), "{:?}", p.args);
    }

    #[test]
    fn a_network_keeps_its_mtu_but_drops_the_unsettable_hostname() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "networks": [{ "network": "default", "options": { "hostname": "my-app", "mtu": 1280 } }],
        }));
        assert_has(&p.args, &["--network", "default,mtu=1280"]);
    }

    #[test]
    fn the_platform_and_runtime_are_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "platform": { "architecture": "arm64", "os": "linux" },
            "runtimeHandler": "container-runtime-linux",
        }));
        assert_has(&p.args, &["--arch", "arm64"]);
        assert_has(&p.args, &["--os", "linux"]);
        assert_has(&p.args, &["--runtime", "container-runtime-linux"]);
    }

    #[test]
    fn the_configuration_is_read_out_of_the_array_inspect_returns() {
        let out = json!([{ "id": "my-app", "configuration": { "id": "my-app" } }]);
        assert_eq!(config_of(&out), Some(&json!({ "id": "my-app" })));
    }

    #[test]
    fn a_bare_inspect_object_is_also_accepted() {
        let out = json!({ "id": "my-app", "configuration": { "id": "my-app" } });
        assert_eq!(config_of(&out), Some(&json!({ "id": "my-app" })));
    }

    #[test]
    fn an_empty_inspect_result_has_no_configuration() {
        assert_eq!(config_of(&json!([])), None);
    }

    #[test]
    fn a_published_socket_is_preserved() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "publishedSockets": [{ "containerPath": "/tmp/in.sock", "hostPath": "/tmp/out.sock" }],
        }));
        assert_has(&p.args, &["--publish-socket", "/tmp/out.sock:/tmp/in.sock"]);
    }

    #[test]
    fn edited_cpus_and_memory_replace_the_recorded_values() {
        let p = build_run_args(
            &json!({
                "id": "my-app",
                "image": { "reference": "nginx:latest" },
                "resources": { "cpus": 2, "memoryInBytes": 2147483648u64 },
            }),
            &json!({ "cpus": "4", "memory": "8g" }),
        );
        assert_has(&p.args, &["--cpus", "4"]);
        assert_has(&p.args, &["--memory", "8g"]);
        assert!(!p.args.iter().any(|a| a == "2147483648"), "{:?}", p.args);
        assert!(!p.args.windows(2).any(|w| w == ["--cpus", "2"]), "{:?}", p.args);
    }

    #[test]
    fn edited_ports_and_env_replace_the_recorded_lists_entirely() {
        let p = build_run_args(
            &json!({
                "id": "my-app",
                "image": { "reference": "nginx:latest" },
                "publishedPorts": [{ "containerPort": 80, "hostPort": 8080, "proto": "tcp" }],
                "initProcess": { "environment": ["OLD=1"] },
            }),
            &json!({ "ports": ["9090:90"], "env": ["NEW=2"] }),
        );
        assert_has(&p.args, &["-p", "9090:90"]);
        assert_has(&p.args, &["-e", "NEW=2"]);
        assert!(!p.args.iter().any(|a| a == "8080:80"), "{:?}", p.args);
        assert!(!p.args.iter().any(|a| a == "OLD=1"), "{:?}", p.args);
    }

    #[test]
    fn blank_entries_in_edited_lists_are_dropped() {
        let p = build_run_args(
            &json!({ "id": "my-app", "image": { "reference": "nginx:latest" } }),
            &json!({ "ports": ["", "9090:90"], "env": ["  ", "NEW=2"], "cpus": "", "memory": "" }),
        );
        assert_eq!(p.args.iter().filter(|a| *a == "-p").count(), 1);
        assert_eq!(p.args.iter().filter(|a| *a == "-e").count(), 1);
        assert!(!p.args.iter().any(|a| a == "--cpus"), "{:?}", p.args);
        assert!(!p.args.iter().any(|a| a == "--memory"), "{:?}", p.args);
    }

    #[test]
    fn edits_that_are_absent_leave_the_recorded_values_alone() {
        let p = build_run_args(
            &json!({
                "id": "my-app",
                "image": { "reference": "nginx:latest" },
                "resources": { "cpus": 2 },
                "initProcess": { "environment": ["OLD=1"] },
            }),
            &json!({ "cpus": null }),
        );
        assert_has(&p.args, &["--cpus", "2"]);
        assert_has(&p.args, &["-e", "OLD=1"]);
    }

    #[test]
    fn settings_the_run_cli_cannot_express_are_reported_as_unsupported() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "sysctls": { "net.ipv4.ip_forward": "1" },
            "initProcess": {
                "supplementalGroups": [44],
                "rlimits": [{ "limit": "nofile", "soft": 1024, "hard": 2048 }],
            },
            "networks": [{ "network": "default", "options": { "hostname": "custom-host" } }],
        }));
        let joined = p.unsupported.join("\n");
        assert!(joined.contains("sysctl"), "{joined}");
        assert!(joined.contains("supplemental group"), "{joined}");
        assert!(joined.contains("resource limit"), "{joined}");
        assert!(joined.contains("custom-host"), "{joined}");
    }

    #[test]
    fn a_hostname_matching_the_container_id_is_not_reported_as_a_loss() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
            "sysctls": {},
            "initProcess": { "supplementalGroups": [], "rlimits": [] },
            "networks": [{ "network": "default", "options": { "hostname": "my-app", "mtu": 1280 } }],
        }));
        assert_eq!(p.unsupported, Vec::<String>::new());
    }

    #[test]
    fn a_container_with_no_resources_object_gets_no_resource_flags() {
        let p = plan(json!({
            "id": "my-app",
            "image": { "reference": "nginx:latest" },
        }));
        assert!(!p.args.iter().any(|a| a == "--cpus"), "{:?}", p.args);
        assert!(!p.args.iter().any(|a| a == "--memory"), "{:?}", p.args);
    }
}
