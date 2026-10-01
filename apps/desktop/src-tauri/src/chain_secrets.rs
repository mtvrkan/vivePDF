use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::rpc::{remember_outputs, RpcError};
use crate::secret_injection::{certificate_binding, inject, SecretKind, Unlocked};
use crate::sidecar;
use crate::watch_tickets::WatchTickets;

pub const FORGET_FLAG: &str = "--forget-chain-secrets";
const SERVICE: &str = "com.vivepdf.desktop";
const INDEX_FILE: &str = "chain-secrets.json";
const MAX_SECRET_CHARS: usize = 1024;

pub trait SecretBackend: Send + Sync {
    fn write(&self, account: &str, value: &str) -> Result<(), RpcError>;
    fn read(&self, account: &str) -> Result<String, RpcError>;
    fn remove(&self, account: &str) -> Result<(), RpcError>;
    fn stray_accounts(&self) -> Vec<String>;
}

fn unavailable() -> RpcError {
    RpcError::new(
        "KEYCHAIN_UNAVAILABLE",
        "the system keychain is not available",
    )
}

fn not_found() -> RpcError {
    RpcError::new("SECRET_NOT_FOUND", "no stored secret for this chain")
}

pub struct KeyringBackend;

#[cfg(windows)]
const WINDOWS_TARGET_PREFIX: &str = "vivePDF/";

impl KeyringBackend {
    fn entry(account: &str) -> Result<keyring_core::Entry, RpcError> {
        if keyring::Entry::store_status().is_err() {
            return Err(unavailable());
        }
        #[cfg(windows)]
        {
            let target = format!("{WINDOWS_TARGET_PREFIX}{account}");
            let modifiers = std::collections::HashMap::from([
                ("target", target.as_str()),
                ("persistence", "Local"),
            ]);
            keyring_core::Entry::new_with_modifiers(SERVICE, account, &modifiers)
                .map_err(|_| unavailable())
        }
        #[cfg(not(windows))]
        {
            keyring_core::Entry::new(SERVICE, account).map_err(|_| unavailable())
        }
    }
}

fn backend_error(error: keyring_core::Error) -> RpcError {
    match error {
        keyring_core::Error::NoEntry => not_found(),
        _ => unavailable(),
    }
}

impl SecretBackend for KeyringBackend {
    fn write(&self, account: &str, value: &str) -> Result<(), RpcError> {
        Self::entry(account)?
            .set_password(value)
            .map_err(backend_error)
    }

    fn read(&self, account: &str) -> Result<String, RpcError> {
        Self::entry(account)?.get_password().map_err(backend_error)
    }

    fn remove(&self, account: &str) -> Result<(), RpcError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(backend_error(error)),
        }
    }

    #[cfg(windows)]
    fn stray_accounts(&self) -> Vec<String> {
        if keyring::Entry::store_status().is_err() {
            return Vec::new();
        }
        let pattern = format!("^{}chain/", regex_escape(WINDOWS_TARGET_PREFIX));
        let spec = std::collections::HashMap::from([("pattern", pattern.as_str())]);
        keyring_core::Entry::search(&spec)
            .unwrap_or_default()
            .iter()
            .filter_map(|entry| entry.get_attributes().ok())
            .filter_map(|attributes| {
                attributes
                    .get("target_name")?
                    .strip_prefix(WINDOWS_TARGET_PREFIX)
                    .map(str::to_string)
            })
            .filter(|account| parse_account(account).is_some())
            .collect()
    }

    #[cfg(not(windows))]
    fn stray_accounts(&self) -> Vec<String> {
        Vec::new()
    }
}

#[cfg(windows)]
fn regex_escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            let special = "\\.+*?()|[]{}^$".contains(character);
            special
                .then_some('\\')
                .into_iter()
                .chain(std::iter::once(character))
        })
        .collect()
}

pub fn valid_chain_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|parsed| parsed.hyphenated().to_string() == id)
}

fn account(chain_id: &str, kind: SecretKind) -> String {
    format!("chain/{chain_id}/{}", kind.as_str())
}

fn parse_account(account: &str) -> Option<(String, SecretKind)> {
    let rest = account.strip_prefix("chain/")?;
    let (chain_id, kind) = rest.split_once('/')?;
    let kind = match kind {
        "encrypt" => SecretKind::Encrypt,
        "sign" => SecretKind::Sign,
        _ => return None,
    };
    valid_chain_id(chain_id).then(|| (chain_id.to_string(), kind))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    v: u8,
    kind: SecretKind,
    chain_id: String,
    binding: String,
    secret: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    chains: BTreeMap<String, BTreeSet<SecretKind>>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainSecretStatus {
    pub chain_id: String,
    pub encrypt: bool,
    pub sign: bool,
}

struct Ledger {
    path: Option<PathBuf>,
    index: Index,
}

impl Ledger {
    fn save(&self) {
        let Some(path) = &self.path else {
            return;
        };
        let Ok(text) = serde_json::to_string(&self.index) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let temporary = path.with_extension("json.tmp");
        if std::fs::write(&temporary, text).is_ok() {
            let _ = std::fs::rename(&temporary, path);
        }
    }

    fn status(&self, chain_id: &str) -> ChainSecretStatus {
        let kinds = self.index.chains.get(chain_id);
        ChainSecretStatus {
            chain_id: chain_id.to_string(),
            encrypt: kinds.is_some_and(|set| set.contains(&SecretKind::Encrypt)),
            sign: kinds.is_some_and(|set| set.contains(&SecretKind::Sign)),
        }
    }

    fn forget(&mut self, chain_id: &str, kind: SecretKind) {
        if let Some(kinds) = self.index.chains.get_mut(chain_id) {
            kinds.remove(&kind);
            if kinds.is_empty() {
                self.index.chains.remove(chain_id);
            }
        }
    }
}

pub struct ChainSecrets {
    backend: Box<dyn SecretBackend>,
    ledger: Mutex<Ledger>,
}

impl Default for ChainSecrets {
    fn default() -> Self {
        Self::new(Box::new(KeyringBackend))
    }
}

fn busy() -> RpcError {
    RpcError::new("INTERNAL", "chain secrets are busy")
}

fn invalid_chain() -> RpcError {
    RpcError::new("INVALID_PARAMS", "not a chain id")
}

impl ChainSecrets {
    pub fn new(backend: Box<dyn SecretBackend>) -> Self {
        Self {
            backend,
            ledger: Mutex::new(Ledger {
                path: None,
                index: Index::default(),
            }),
        }
    }

    pub fn load(&self, directory: PathBuf) {
        let path = directory.join(INDEX_FILE);
        let index = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Index>(&text).ok())
            .unwrap_or_default();
        if let Ok(mut ledger) = self.ledger.lock() {
            ledger.index.chains = index
                .chains
                .into_iter()
                .filter(|(id, kinds)| valid_chain_id(id) && !kinds.is_empty())
                .collect();
            ledger.path = Some(path);
        }
    }

    pub fn store(
        &self,
        chain_id: &str,
        kind: SecretKind,
        secret: &str,
        certificate_path: Option<&str>,
    ) -> Result<ChainSecretStatus, RpcError> {
        if !valid_chain_id(chain_id) {
            return Err(invalid_chain());
        }
        if secret.is_empty() || secret.chars().count() > MAX_SECRET_CHARS || secret.contains('\0') {
            return Err(RpcError::new("INVALID_PARAMS", "unusable secret"));
        }
        let binding = match kind {
            SecretKind::Encrypt => String::new(),
            SecretKind::Sign => certificate_path
                .filter(|path| !path.is_empty())
                .map(certificate_binding)
                .ok_or_else(|| RpcError::new("INVALID_PARAMS", "certificatePath is required"))?,
        };
        let payload = Payload {
            v: 1,
            kind,
            chain_id: chain_id.to_string(),
            binding,
            secret: secret.to_string(),
        };
        let text = serde_json::to_string(&payload).map_err(|_| unavailable())?;
        let mut ledger = self.ledger.lock().map_err(|_| busy())?;
        self.backend.write(&account(chain_id, kind), &text)?;
        ledger
            .index
            .chains
            .entry(chain_id.to_string())
            .or_default()
            .insert(kind);
        ledger.save();
        Ok(ledger.status(chain_id))
    }

    pub fn status(&self, chain_ids: &[String]) -> Result<Vec<ChainSecretStatus>, RpcError> {
        let ledger = self.ledger.lock().map_err(|_| busy())?;
        Ok(chain_ids.iter().map(|id| ledger.status(id)).collect())
    }

    pub fn delete(&self, chain_id: &str, kind: Option<SecretKind>) -> Result<(), RpcError> {
        if !valid_chain_id(chain_id) {
            return Err(invalid_chain());
        }
        let mut ledger = self.ledger.lock().map_err(|_| busy())?;
        let kinds = kind.map_or_else(
            || vec![SecretKind::Encrypt, SecretKind::Sign],
            |kind| vec![kind],
        );
        for kind in kinds {
            self.backend.remove(&account(chain_id, kind))?;
            ledger.forget(chain_id, kind);
        }
        ledger.save();
        Ok(())
    }

    pub fn prune(&self, live: &[String]) -> Result<Vec<ChainSecretStatus>, RpcError> {
        let live: BTreeSet<&str> = live.iter().map(String::as_str).collect();
        let mut ledger = self.ledger.lock().map_err(|_| busy())?;
        let mut orphans: Vec<(String, SecretKind)> = ledger
            .index
            .chains
            .iter()
            .filter(|(id, _)| !live.contains(id.as_str()))
            .flat_map(|(id, kinds)| kinds.iter().map(|kind| (id.clone(), *kind)))
            .collect();
        for stray in self.backend.stray_accounts() {
            if let Some((id, kind)) = parse_account(&stray) {
                if !live.contains(id.as_str()) && !orphans.contains(&(id.clone(), kind)) {
                    orphans.push((id, kind));
                }
            }
        }
        for (id, kind) in orphans {
            if self.backend.remove(&account(&id, kind)).is_ok() {
                ledger.forget(&id, kind);
            }
        }
        ledger.save();
        Ok(ledger
            .index
            .chains
            .keys()
            .map(|id| ledger.status(id))
            .collect())
    }

    pub fn purge_all(&self) -> Result<usize, RpcError> {
        let mut ledger = self.ledger.lock().map_err(|_| busy())?;
        let mut accounts: BTreeSet<String> = ledger
            .index
            .chains
            .iter()
            .flat_map(|(id, kinds)| kinds.iter().map(|kind| account(id, *kind)))
            .collect();
        accounts.extend(
            self.backend
                .stray_accounts()
                .into_iter()
                .filter(|name| parse_account(name).is_some()),
        );
        let mut removed = 0;
        let mut failure = None;
        for name in &accounts {
            match self.backend.remove(name) {
                Ok(()) => {
                    removed += 1;
                    if let Some((id, kind)) = parse_account(name) {
                        ledger.forget(&id, kind);
                    }
                }
                Err(error) => failure = Some(error),
            }
        }
        ledger.save();
        match failure {
            Some(error) => Err(error),
            None => Ok(removed),
        }
    }

    pub fn unlock(&self, chain_id: &str, kinds: &[SecretKind]) -> Result<Vec<Unlocked>, RpcError> {
        if !valid_chain_id(chain_id) {
            return Err(invalid_chain());
        }
        let mut ledger = self.ledger.lock().map_err(|_| busy())?;
        let mut unlocked = Vec::with_capacity(kinds.len());
        for kind in kinds {
            if !ledger.status(chain_id).has(*kind) {
                return Err(not_found());
            }
            let text = match self.backend.read(&account(chain_id, *kind)) {
                Ok(text) => text,
                Err(error) => {
                    if error.code == "SECRET_NOT_FOUND" {
                        ledger.forget(chain_id, *kind);
                        ledger.save();
                    }
                    return Err(error);
                }
            };
            let payload: Payload = serde_json::from_str(&text).map_err(|_| not_found())?;
            if payload.v != 1 || payload.chain_id != chain_id || payload.kind != *kind {
                return Err(not_found());
            }
            unlocked.push(Unlocked {
                kind: *kind,
                secret: payload.secret,
                binding: payload.binding,
            });
        }
        Ok(unlocked)
    }
}

impl ChainSecretStatus {
    fn has(&self, kind: SecretKind) -> bool {
        match kind {
            SecretKind::Encrypt => self.encrypt,
            SecretKind::Sign => self.sign,
        }
    }
}

pub fn forget_everything() {
    let secrets = ChainSecrets::default();
    let _ = secrets.purge_all();
}

pub fn load_index<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Ok(directory) = app.path().app_data_dir() {
        app.state::<ChainSecrets>().load(directory);
    }
}

fn distinct(kinds: &[SecretKind]) -> Result<Vec<SecretKind>, RpcError> {
    let set: BTreeSet<SecretKind> = kinds.iter().copied().collect();
    if set.is_empty() || set.len() != kinds.len() {
        return Err(RpcError::new("INVALID_PARAMS", "kinds must be distinct"));
    }
    Ok(set.into_iter().collect())
}

#[tauri::command]
pub fn chain_secret_store(
    secrets: State<'_, ChainSecrets>,
    chain_id: String,
    kind: SecretKind,
    secret: String,
    certificate_path: Option<String>,
) -> Result<ChainSecretStatus, RpcError> {
    secrets.store(&chain_id, kind, &secret, certificate_path.as_deref())
}

#[tauri::command]
pub fn chain_secret_status(
    secrets: State<'_, ChainSecrets>,
    chain_ids: Vec<String>,
) -> Result<Vec<ChainSecretStatus>, RpcError> {
    secrets.status(&chain_ids)
}

#[tauri::command]
pub fn chain_secret_delete(
    secrets: State<'_, ChainSecrets>,
    chain_id: String,
    kind: Option<SecretKind>,
) -> Result<(), RpcError> {
    secrets.delete(&chain_id, kind)
}

#[tauri::command]
pub fn chain_secret_prune(
    secrets: State<'_, ChainSecrets>,
    live_chain_ids: Vec<String>,
) -> Result<Vec<ChainSecretStatus>, RpcError> {
    secrets.prune(&live_chain_ids)
}

#[tauri::command]
pub fn chain_secret_purge_all(secrets: State<'_, ChainSecrets>) -> Result<usize, RpcError> {
    secrets.purge_all()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn rpc_with_chain_secret(
    app: AppHandle,
    secrets: State<'_, ChainSecrets>,
    tickets: State<'_, WatchTickets>,
    id: String,
    method: String,
    mut params: Value,
    chain_id: String,
    kinds: Vec<SecretKind>,
    ticket: String,
) -> Result<Value, RpcError> {
    let kinds = distinct(&kinds)?;
    tickets.check(&ticket, &chain_id, std::time::Instant::now())?;
    let unlocked = secrets.unlock(&chain_id, &kinds)?;
    inject(&method, &mut params, &unlocked)?;
    drop(unlocked);
    let result = sidecar::call(&app, id, method, params).await?;
    remember_outputs(&result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemoryBackend {
        entries: Mutex<HashMap<String, String>>,
        stray: Vec<String>,
    }

    impl SecretBackend for MemoryBackend {
        fn write(&self, account: &str, value: &str) -> Result<(), RpcError> {
            self.entries
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_string());
            Ok(())
        }

        fn read(&self, account: &str) -> Result<String, RpcError> {
            self.entries
                .lock()
                .unwrap()
                .get(account)
                .cloned()
                .ok_or_else(not_found)
        }

        fn remove(&self, account: &str) -> Result<(), RpcError> {
            self.entries.lock().unwrap().remove(account);
            Ok(())
        }

        fn stray_accounts(&self) -> Vec<String> {
            self.stray.clone()
        }
    }

    struct LockedBackend;

    impl SecretBackend for LockedBackend {
        fn write(&self, _: &str, _: &str) -> Result<(), RpcError> {
            Err(unavailable())
        }

        fn read(&self, _: &str) -> Result<String, RpcError> {
            Err(unavailable())
        }

        fn remove(&self, _: &str) -> Result<(), RpcError> {
            Err(unavailable())
        }

        fn stray_accounts(&self) -> Vec<String> {
            Vec::new()
        }
    }

    const CHAIN: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const OTHER: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

    fn temporary_directory() -> PathBuf {
        std::env::temp_dir().join(format!("vivepdf-secrets-{}", uuid::Uuid::new_v4()))
    }

    fn memory() -> ChainSecrets {
        ChainSecrets::new(Box::<MemoryBackend>::default())
    }

    #[test]
    fn stores_and_reports_without_returning_the_secret() {
        let directory = temporary_directory();
        let secrets = memory();
        secrets.load(directory.clone());
        let status = secrets
            .store(CHAIN, SecretKind::Encrypt, "sentinel-7731", None)
            .unwrap();
        assert!(status.encrypt && !status.sign);
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("sentinel-7731"));
        let index = std::fs::read_to_string(directory.join(INDEX_FILE)).unwrap();
        assert!(index.contains(CHAIN));
        assert!(!index.contains("sentinel-7731"));

        let reloaded = memory();
        reloaded.load(directory.clone());
        assert!(reloaded.status(&[CHAIN.to_string()]).unwrap()[0].encrypt);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn refuses_ids_that_are_not_chain_ids() {
        let secrets = memory();
        for id in ["", "../x", "chain", "0F8FAD5B-D9CB-469F-A165-70867728950E"] {
            let error = secrets
                .store(id, SecretKind::Encrypt, "x", None)
                .unwrap_err();
            assert_eq!(error.code, "INVALID_PARAMS");
        }
        assert_eq!(
            secrets
                .store(CHAIN, SecretKind::Encrypt, "", None)
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
        assert_eq!(
            secrets
                .store(CHAIN, SecretKind::Sign, "pin", None)
                .unwrap_err()
                .code,
            "INVALID_PARAMS"
        );
    }

    #[test]
    fn unlocks_only_what_was_stored_for_that_chain() {
        let secrets = memory();
        secrets
            .store(CHAIN, SecretKind::Sign, "pin", Some("C:/certs/me.p12"))
            .unwrap();
        let unlocked = secrets.unlock(CHAIN, &[SecretKind::Sign]).unwrap();
        assert_eq!(unlocked[0].secret, "pin");
        assert_eq!(unlocked[0].binding, certificate_binding("C:/certs/me.p12"));
        assert_eq!(
            secrets
                .unlock(CHAIN, &[SecretKind::Encrypt])
                .err()
                .unwrap()
                .code,
            "SECRET_NOT_FOUND"
        );
        assert_eq!(
            secrets
                .unlock(OTHER, &[SecretKind::Sign])
                .err()
                .unwrap()
                .code,
            "SECRET_NOT_FOUND"
        );
    }

    #[test]
    fn a_payload_filed_under_another_chain_is_refused() {
        let backend = MemoryBackend::default();
        backend
            .write(
                &account(CHAIN, SecretKind::Encrypt),
                &serde_json::to_string(&Payload {
                    v: 1,
                    kind: SecretKind::Encrypt,
                    chain_id: OTHER.to_string(),
                    binding: String::new(),
                    secret: "x".to_string(),
                })
                .unwrap(),
            )
            .unwrap();
        let secrets = ChainSecrets::new(Box::new(backend));
        secrets
            .ledger
            .lock()
            .unwrap()
            .index
            .chains
            .insert(CHAIN.to_string(), BTreeSet::from([SecretKind::Encrypt]));
        assert_eq!(
            secrets
                .unlock(CHAIN, &[SecretKind::Encrypt])
                .err()
                .unwrap()
                .code,
            "SECRET_NOT_FOUND"
        );
    }

    #[test]
    fn prune_and_purge_clear_leftovers() {
        let backend = MemoryBackend {
            stray: vec![
                account(OTHER, SecretKind::Sign),
                "chain/../x/sign".to_string(),
            ],
            ..MemoryBackend::default()
        };
        let secrets = ChainSecrets::new(Box::new(backend));
        secrets
            .store(CHAIN, SecretKind::Encrypt, "a", None)
            .unwrap();
        secrets
            .store(OTHER, SecretKind::Encrypt, "b", None)
            .unwrap();
        let left = secrets.prune(&[CHAIN.to_string()]).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].chain_id, CHAIN);
        assert!(!secrets.status(&[OTHER.to_string()]).unwrap()[0].encrypt);
        assert_eq!(secrets.purge_all().unwrap(), 2);
        assert!(!secrets.status(&[CHAIN.to_string()]).unwrap()[0].encrypt);
    }

    #[test]
    fn a_locked_keychain_is_reported_and_nothing_is_written() {
        let directory = temporary_directory();
        let secrets = ChainSecrets::new(Box::new(LockedBackend));
        secrets.load(directory.clone());
        let error = secrets
            .store(CHAIN, SecretKind::Encrypt, "sentinel-7731", None)
            .unwrap_err();
        assert_eq!(error.code, "KEYCHAIN_UNAVAILABLE");
        assert!(!error.message.contains("sentinel-7731"));
        assert!(!directory.join(INDEX_FILE).exists());
        assert!(!secrets.status(&[CHAIN.to_string()]).unwrap()[0].encrypt);
    }

    #[test]
    fn kinds_must_be_distinct_and_present() {
        assert!(distinct(&[]).is_err());
        assert!(distinct(&[SecretKind::Sign, SecretKind::Sign]).is_err());
        assert_eq!(
            distinct(&[SecretKind::Sign, SecretKind::Encrypt]).unwrap(),
            vec![SecretKind::Encrypt, SecretKind::Sign]
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore]
    fn windows_credential_manager_round_trip() {
        let secrets = ChainSecrets::default();
        let chain = uuid::Uuid::new_v4().to_string();
        secrets
            .store(&chain, SecretKind::Encrypt, "sentinel-7731", None)
            .unwrap();
        let unlocked = secrets.unlock(&chain, &[SecretKind::Encrypt]).unwrap();
        assert_eq!(unlocked[0].secret, "sentinel-7731");
        assert!(KeyringBackend
            .stray_accounts()
            .contains(&account(&chain, SecretKind::Encrypt)));
        secrets.ledger.lock().unwrap().index.chains.clear();
        assert!(secrets.purge_all().unwrap() >= 1);
        assert!(!KeyringBackend
            .stray_accounts()
            .contains(&account(&chain, SecretKind::Encrypt)));
    }

    #[test]
    fn accounts_round_trip() {
        assert_eq!(
            parse_account(&account(CHAIN, SecretKind::Sign)),
            Some((CHAIN.to_string(), SecretKind::Sign))
        );
        assert_eq!(parse_account("chain/x/sign"), None);
        assert_eq!(parse_account(&format!("chain/{CHAIN}/other")), None);
    }
}
