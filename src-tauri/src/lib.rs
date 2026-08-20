pub mod build;
pub mod build_args;
pub mod builder;
pub mod cli;
pub mod containers;
pub mod recreate;

use build::BuildManager;
use containers::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(BuildManager::default())
        // Every command below is spelled `#[tauri::command(async)]` even where the
        // function itself is not async. Tauri runs a plain `#[tauri::command]` on the
        // main thread, which on macOS is also the window's event loop, so a slow call
        // freezes the UI outright rather than just delaying its own result. Every one
        // of these shells out to the `container` CLI: `stats` samples for ~2s and
        // `image pull` can run for minutes.
        .invoke_handler(tauri::generate_handler![
            list_containers,
            start_container,
            stop_container,
            remove_container,
            export_container,
            get_logs,
            exec_in_container,
            get_stats,
            inspect_container,
            run_container,
            plan_recreate,
            recreate_container,
            check_system_status,
            start_system,
            stop_system,
            list_images,
            remove_image,
            pull_image,
            list_machines,
            prune_images,
            inspect_machine,
            create_machine,
            stop_machine,
            delete_machine,
            set_default_machine,
            machine_run,
            get_machine_logs,
            set_machine_config,
            list_volumes,
            create_volume,
            delete_volume,
            prune_volumes,
            list_networks,
            create_network,
            delete_network,
            prune_networks,
            search_hub,
            get_hub_tags,
            build::start_build,
            build::cancel_build,
            build::get_build_state,
            builder::builder_status,
            builder::builder_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // Whether a command blocks the UI is decided by the attribute, not by
    // anything the function does, so no test of a function's behaviour can
    // catch a regression here. Reading the source is the only guard there is.
    #[test]
    fn every_command_runs_off_the_main_thread() {
        for (file, src) in [
            ("containers.rs", include_str!("containers.rs")),
            ("build.rs", include_str!("build.rs")),
            ("builder.rs", include_str!("builder.rs")),
        ] {
            let lines: Vec<&str> = src.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.trim() == "#[tauri::command]" {
                    assert!(
                        lines.get(i + 1).is_some_and(|n| n.contains("async fn")),
                        "{file}:{} is a sync command, so Tauri runs it on the main \
                         thread and a slow CLI call there freezes the window. \
                         Write it as #[tauri::command(async)].",
                        i + 1
                    );
                }
            }
        }
    }
}
