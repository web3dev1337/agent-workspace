fn main() {
    // Use custom config to prevent tracking node_modules for rebuilds
    let _context = tauri_build::try_build(tauri_build::Attributes::new())
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
