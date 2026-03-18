fn main() {
    // Use custom config to prevent tracking node_modules for rebuilds
    let windows_attributes = tauri_build::WindowsAttributes::new()
        .window_icon_path("icons/icon.ico");
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(windows_attributes);
    let _context = tauri_build::try_build(attributes)
        .expect("failed to run tauri build");

    // Explicitly tell cargo to NOT track node_modules changes
    // This prevents stack overflow from tracking thousands of files
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=resources/backend/server");
    println!("cargo:rerun-if-changed=resources/backend/client");
    println!("cargo:rerun-if-changed=resources/backend/package.json");
    // Explicitly IGNORE node_modules
}
