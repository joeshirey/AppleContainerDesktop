pub mod build;
pub mod build_args;
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
        .manage(BuildManager::default())
        .invoke_handler(tauri::generate_handler![
            list_containers,
            start_container,
            stop_container,
            remove_container,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
