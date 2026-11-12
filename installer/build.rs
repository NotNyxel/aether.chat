fn main() {
    // The release script points this at the freshly built, signed NSIS installer.
    println!("cargo:rerun-if-env-changed=AETHER_INSTALLER");
    if std::env::var("AETHER_INSTALLER").is_err() {
        panic!("Set AETHER_INSTALLER to the path of aether.chat_<version>_x64-setup.exe");
    }
    tauri_build::build()
}
