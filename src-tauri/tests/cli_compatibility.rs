use applecontainerdesktop_lib::{builder, cli::run_cmd, containers::*, recreate};
use serde_json::{json, Value};

#[test]
fn recreation_preserves_captured_1_4_1_configuration() {
    let raw: Value = serde_json::from_str(include_str!(
        "../../src/test/fixtures/container-1.4.1/containers.json"
    ))
    .unwrap();
    let plan = recreate::build_run_args(recreate::config_of(&raw).unwrap(), &json!({"cpus": "2"}));
    for pair in [
        ["--cpus", "2"],
        ["--memory", "536870912"],
        ["--tmpfs", "/scratch"],
        ["-v", "/tmp/acd-compat/bind:/bind:ro"],
        ["-v", "compat-test:/data"],
        ["-p", "127.0.0.1:18741:8080"],
        ["-e", "COMPAT_TEST=preserved"],
        ["-l", "compat.version=1.4.1"],
        ["--network", "compat-test,mtu=1280"],
        ["--entrypoint", "/bin/sh"],
        ["-w", "/tmp"],
    ] {
        assert!(plan.args.windows(2).any(|w| w == pair), "missing {pair:?}");
    }
    assert!(plan.unsupported.is_empty());
}

/// Opt-in: needs a running container 1.4.1 service and Apple silicon. Creates
/// only uniquely named disposable resources; never prunes existing resources.
#[test]
#[ignore = "requires a live container service; see docs/container-1.4.1.md"]
fn live_1_4_1_smoke() {
    let version = run_cmd(&["--version"]).unwrap();
    assert!(version.as_str().unwrap().contains("version 1.4.1 "));
    assert_eq!(check_system_status().unwrap()["status"], "running");
    let name = format!(
        "acd-smoke-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let machine = format!("{name}-vm");
    let tag = format!("{name}:latest");
    let mut cleanup = Cleanup {
        name: name.clone(),
        machine: machine.clone(),
        tag: tag.clone(),
        stop_builder: false,
    };
    let dir = tempfile::tempdir().unwrap();
    let bind = dir.path().join("bind");
    std::fs::create_dir(&bind).unwrap();
    std::fs::write(bind.join("marker"), "bind-preserved").unwrap();
    create_volume(name.clone(), Some("1G".into())).unwrap();
    create_network(name.clone(), None, false).unwrap();
    // The base image remains cached, just as with a normal pull in the UI.
    pull_image("alpine:3.24.1".into()).unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    run_cmd(&[
        "run",
        "-d",
        "--name",
        &name,
        "--cpus",
        "1",
        "--memory",
        "512M",
        "--mount",
        "type=tmpfs,target=/scratch",
        "-v",
        &format!("{}:/bind:ro", bind.display()),
        "-v",
        &format!("{name}:/data"),
        "--network",
        &name,
        "-p",
        &format!("127.0.0.1:{port}:8080"),
        "-e",
        "COMPAT_TEST=preserved",
        "-l",
        "compat.version=1.4.1",
        "-w",
        "/tmp",
        "--entrypoint",
        "/bin/sh",
        "alpine:3.24.1",
        "-c",
        "echo ready; sleep 3600",
    ])
    .unwrap();
    let listed = list_containers().unwrap();
    let entry = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == name)
        .unwrap();
    assert!(entry.get("missingBindMounts").is_none());
    assert!(get_logs(name.clone(), 10).unwrap().contains("ready"));
    assert_eq!(
        exec_in_container(
            name.clone(),
            "echo volume-preserved > /data/marker; cat /bind/marker".into()
        )
        .unwrap(),
        "bind-preserved"
    );
    let stats = get_stats(name.clone()).unwrap();
    assert_eq!(stats["id"], name);
    assert!(stats["memoryUsageBytes"].is_number());
    assert!(stats["cpuUsageUsec"].is_number());
    let volumes = list_volumes().unwrap();
    let volume = volumes
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == name)
        .unwrap();
    assert_eq!(volume["inUseBy"], json!([name]));
    let networks = list_networks().unwrap();
    let network = networks
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == name)
        .unwrap();
    assert_eq!(network["inUseBy"], json!([name]));

    stop_container(name.clone()).unwrap();
    let before = inspect_container(name.clone()).unwrap();
    let plan = plan_recreate(name.clone(), json!({"cpus": "2"})).unwrap();
    assert!(plan.unsupported.is_empty(), "{:?}", plan.unsupported);
    recreate_container(name.clone(), json!({"cpus": "2"})).unwrap();
    let after = inspect_container(name.clone()).unwrap();
    let before = recreate::config_of(&before).unwrap();
    let after = recreate::config_of(&after).unwrap();
    assert_eq!(after["resources"]["cpus"], 2);
    for key in ["publishedPorts", "networks", "labels", "dns", "image"] {
        assert_eq!(before[key], after[key], "recreation changed {key}");
    }
    // --tmpfs and --mount type=tmpfs are collected in a different order by
    // the CLI. These destinations are distinct; compare their full records.
    let sorted_mounts = |config: &Value| {
        let mut mounts = config["mounts"].as_array().unwrap().clone();
        mounts.sort_by_key(|m| m["destination"].as_str().unwrap().to_string());
        mounts
    };
    assert_eq!(sorted_mounts(before), sorted_mounts(after));
    let process = |config: &Value| {
        let mut process = config["initProcess"].clone();
        process["environment"]
            .as_array_mut()
            .unwrap()
            .sort_by_key(|v| v.as_str().unwrap().to_string());
        process
    };
    assert_eq!(process(before), process(after));
    assert_eq!(
        exec_in_container(name.clone(), "cat /data/marker; echo $COMPAT_TEST".into()).unwrap(),
        "volume-preserved\npreserved"
    );
    stop_container(name.clone()).unwrap();
    let archive = dir.path().join("export.tar");
    export_container(name.clone(), archive.to_string_lossy().into_owned()).unwrap();
    assert!(archive.metadata().unwrap().len() > 0);
    start_container(name.clone()).unwrap();
    stop_container(name.clone()).unwrap();
    remove_container(name.clone()).unwrap();
    delete_volume(name.clone()).unwrap();
    delete_network(name.clone()).unwrap();
    eprintln!("Container lifecycle, stats, recreation, export, volumes and networks passed");

    run_cmd(&[
        "machine",
        "create",
        "--name",
        &machine,
        "--cpus",
        "2",
        "--memory",
        "2G",
        "--home-mount",
        "none",
        "alpine:3.24.1",
    ])
    .unwrap();
    let machines = list_machines().unwrap();
    let vm = machines
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == machine)
        .unwrap();
    assert_eq!(vm["cpus"], 2);
    assert_eq!(vm["memory"], 2147483648_u64);
    // 1.4.1 can retain an uninitialized snapshot after first-time user setup.
    // A fresh boot loads the persisted setup state. Without this, machine run
    // may try to initialize with a TTY despite a noninteractive command.
    // Keep this upstream limitation explicit; never replay user commands.
    stop_machine(machine.clone()).unwrap();
    assert_eq!(
        machine_run(machine.clone(), "printf machine-ok".into()).unwrap(),
        "machine-ok"
    );
    get_machine_logs(machine.clone(), 10, false).unwrap();
    get_machine_logs(machine.clone(), 10, true).unwrap();
    set_machine_config(
        machine.clone(),
        Some(3),
        Some("3G".into()),
        Some("none".into()),
    )
    .unwrap();
    stop_machine(machine.clone()).unwrap();
    assert_eq!(
        machine_run(machine.clone(), "printf restarted".into()).unwrap(),
        "restarted"
    );
    let vm = inspect_machine(machine.clone()).unwrap();
    assert_eq!(vm[0]["cpus"], 3);
    stop_machine(machine.clone()).unwrap();
    delete_machine(machine.clone()).unwrap();
    eprintln!("Machine lifecycle, shell, logs and settings passed");

    if !builder::builder_status().unwrap().running {
        cleanup.stop_builder = true;
        builder::builder_start(None, None).unwrap();
    }
    std::fs::write(
        dir.path().join("Dockerfile"),
        "FROM scratch\nCOPY bind/marker /marker\n",
    )
    .unwrap();
    run_cmd(&[
        "build",
        "--progress",
        "plain",
        "-t",
        &tag,
        "-f",
        dir.path().join("Dockerfile").to_str().unwrap(),
        dir.path().to_str().unwrap(),
    ])
    .unwrap();
    assert!(list_images()
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["configuration"]["name"] == tag));
    remove_image(tag.clone()).unwrap();
    eprintln!("Image pull, build, list and removal passed");
}

struct Cleanup {
    name: String,
    machine: String,
    tag: String,
    stop_builder: bool,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = stop_container(self.name.clone());
        let _ = remove_container(self.name.clone());
        let _ = delete_volume(self.name.clone());
        let _ = delete_network(self.name.clone());
        let _ = stop_machine(self.machine.clone());
        let _ = delete_machine(self.machine.clone());
        let _ = remove_image(self.tag.clone());
        if self.stop_builder {
            let _ = run_cmd(&["builder", "stop"]);
        }
    }
}
