pub mod cli;
pub mod containers;

use containers::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
            check_system_status,
            start_system,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
