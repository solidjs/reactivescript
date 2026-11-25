//! Starts the ReactiveScript language server (`@reactivescript/language-server`) for Zed: the package installed
//! from npm into the extension's folder, run with Zed's Node over stdio.
//!
//! Zed does not ask this extension for a command when `lsp.rx-language-server.binary.path` is set; it runs that
//! path itself with `binary.arguments` and `binary.env`. Without a path it lays `binary.arguments` (in place of
//! the arguments here) and `binary.env` over the command below.
//!
//! Settings, under `lsp.rx-language-server`:
//! - `settings.rxc.path`: an `rxc` binary the server runs instead of its bundled WebAssembly build (`RXC`).
//! - `settings.typescript.tsdk`: TypeScript's `lib` folder. Default: the worktree's
//!   `node_modules/typescript/lib`, else the server's own TypeScript.
//! - `initialization_options`: merged over what this extension sends.

use zed_extension_api::{
    self as zed,
    serde_json::{json, Value},
    settings::LspSettings,
    LanguageServerId, Result,
};

const SERVER_ID: &str = "rx-language-server";
const PACKAGE: &str = "@reactivescript/language-server";
/// The server's entry file, from the extension's folder (where npm installs, and the extension's working directory).
const SERVER: &str = "node_modules/@reactivescript/language-server/bin/server.js";

struct RxExtension {
    /// The installed server's path, once checked this session.
    installed: Option<String>,
}

impl RxExtension {
    /// Whether the installed copy's entry file is on disk.
    fn server_exists() -> bool {
        std::fs::metadata(SERVER).is_ok_and(|stat| stat.is_file())
    }

    /// The server from npm, updated when a newer release exists. The copy on disk if the check or the update
    /// fails; a copy whose entry file is missing is installed again.
    fn npm_server(&mut self, id: &LanguageServerId) -> Result<String> {
        if let Some(path) = &self.installed {
            if Self::server_exists() {
                return Ok(path.clone());
            }
        }
        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let exists = Self::server_exists();
        let installed = if exists {
            zed::npm_package_installed_version(PACKAGE).ok().flatten()
        } else {
            None
        };
        let updated = match zed::npm_package_latest_version(PACKAGE) {
            Ok(latest) if installed.as_deref() != Some(latest.as_str()) => {
                zed::set_language_server_installation_status(
                    id,
                    &zed::LanguageServerInstallationStatus::Downloading,
                );
                zed::npm_install_package(PACKAGE, &latest)
            }
            Ok(_) => Ok(()),
            Err(error) => Err(error),
        };
        let failure = match updated {
            // Offline, or the update failed: keep the copy on disk.
            Err(_) if exists => None,
            Err(error) => Some(format!("couldn't install {PACKAGE}: {error}")),
            Ok(()) if !Self::server_exists() => {
                Some(format!("{PACKAGE} is installed without {SERVER}"))
            }
            Ok(()) => None,
        };
        if let Some(message) = failure {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Failed(message.clone()),
            );
            return Err(message);
        }
        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::None,
        );
        let path = std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(SERVER)
            .to_string_lossy()
            .into_owned();
        self.installed = Some(path.clone());
        Ok(path)
    }
}

/// `settings.rxc.path` and `settings.typescript.tsdk`, from the user's `lsp.rx-language-server.settings`.
fn setting(settings: &LspSettings, section: &str, key: &str) -> Option<String> {
    settings
        .settings
        .as_ref()?
        .get(section)?
        .get(key)?
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Overlays `over` onto `base`, objects key by key.
fn merge(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(base), Value::Object(over)) => {
            for (key, value) in over {
                merge(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (base, over) => *base = over,
    }
}

impl zed::Extension for RxExtension {
    fn new() -> Self {
        RxExtension { installed: None }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(SERVER_ID, worktree).unwrap_or_default();
        let env = setting(&settings, "rxc", "path")
            .map(|rxc| vec![("RXC".to_string(), rxc)])
            .unwrap_or_default();
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![self.npm_server(id)?, "--stdio".to_string()],
            env,
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        let settings = LspSettings::for_worktree(SERVER_ID, worktree).unwrap_or_default();
        let tsdk = setting(&settings, "typescript", "tsdk").or_else(|| {
            worktree
                .read_text_file("node_modules/typescript/package.json")
                .ok()
                .map(|_| format!("{}/node_modules/typescript/lib", worktree.root_path()))
        });
        let mut options = match tsdk {
            Some(tsdk) => json!({ "typescript": { "tsdk": tsdk } }),
            None => json!({}),
        };
        if let Some(user) = settings.initialization_options {
            merge(&mut options, user);
        }
        let empty = options.as_object().is_some_and(|o| o.is_empty());
        Ok((!empty).then_some(options))
    }

    fn language_server_workspace_configuration(
        &mut self,
        _id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        Ok(LspSettings::for_worktree(SERVER_ID, worktree)
            .ok()
            .and_then(|settings| settings.settings))
    }
}

zed::register_extension!(RxExtension);
