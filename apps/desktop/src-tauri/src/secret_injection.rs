use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::rpc::RpcError;
use crate::watch_paths::canonical_form;

pub const OPENING_METHODS: [&str; 21] = [
    "repair.run",
    "security.watermark",
    "pages.header_footer",
    "info.set_metadata",
    "pdfa.convert",
    "compress.run",
    "ocr.run",
    "security.remove_watermark",
    "security.encrypt",
    "sign.run",
    "pages.number",
    "pages.rotate",
    "pages.delete",
    "pages.extract",
    "convert.to_docx",
    "convert.to_xlsx",
    "convert.to_pptx",
    "convert.to_text",
    "convert.to_markdown",
    "convert.to_html",
    "convert.to_images",
];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SecretKind {
    Encrypt,
    Sign,
}

impl SecretKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SecretKind::Encrypt => "encrypt",
            SecretKind::Sign => "sign",
        }
    }
}

pub struct Unlocked {
    pub kind: SecretKind,
    pub secret: String,
    pub binding: String,
}

pub fn certificate_binding(path: &str) -> String {
    let canonical = canonical_form(std::path::Path::new(path));
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn refused(message: &str) -> RpcError {
    RpcError::new("INVALID_PARAMS", message)
}

fn fill(params: &mut Map<String, Value>, field: &str, secret: &str) -> Result<(), RpcError> {
    match params.get(field) {
        None | Some(Value::Null) => {}
        Some(Value::String(value)) if value.is_empty() => {}
        _ => return Err(refused("secret fields must be left empty")),
    }
    params.insert(field.to_string(), Value::String(secret.to_string()));
    Ok(())
}

pub fn inject(method: &str, params: &mut Value, unlocked: &[Unlocked]) -> Result<(), RpcError> {
    if !OPENING_METHODS.contains(&method) {
        return Err(refused("this method cannot use a stored secret"));
    }
    let map = params
        .as_object_mut()
        .ok_or_else(|| refused("params must be an object"))?;
    for item in unlocked {
        match item.kind {
            SecretKind::Encrypt => {
                fill(map, "password", &item.secret)?;
                if method == "security.encrypt" {
                    fill(map, "userPassword", &item.secret)?;
                    fill(map, "ownerPassword", &item.secret)?;
                }
            }
            SecretKind::Sign => {
                if method != "sign.run" {
                    return Err(refused("the signing secret is only for signing"));
                }
                let path = map
                    .get("certificatePath")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| refused("certificatePath is required"))?;
                if certificate_binding(path) != item.binding {
                    return Err(RpcError::new(
                        "SECRET_BINDING_CHANGED",
                        "the certificate changed since its password was stored",
                    ));
                }
                fill(map, "certificatePassword", &item.secret)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn encrypt(secret: &str) -> Unlocked {
        Unlocked {
            kind: SecretKind::Encrypt,
            secret: secret.to_string(),
            binding: String::new(),
        }
    }

    fn sign(secret: &str, path: &str) -> Unlocked {
        Unlocked {
            kind: SecretKind::Sign,
            secret: secret.to_string(),
            binding: certificate_binding(path),
        }
    }

    #[test]
    fn encrypt_fills_the_new_and_opening_passwords() {
        let mut params = json!({ "path": "a.pdf", "userPassword": "", "ownerPassword": "" });
        inject("security.encrypt", &mut params, &[encrypt("s3cret")]).unwrap();
        assert_eq!(params["userPassword"], "s3cret");
        assert_eq!(params["ownerPassword"], "s3cret");
        assert_eq!(params["password"], "s3cret");
    }

    #[test]
    fn later_steps_only_get_the_opening_password() {
        let mut params = json!({ "path": "a.pdf", "text": "{password}", "headerLeft": "" });
        inject("security.watermark", &mut params, &[encrypt("s3cret")]).unwrap();
        assert_eq!(params["password"], "s3cret");
        assert_eq!(params["text"], "{password}");
        assert_eq!(params["headerLeft"], "");
        assert!(params.get("userPassword").is_none());
    }

    #[test]
    fn unknown_or_password_methods_are_refused() {
        for method in [
            "security.decrypt",
            "password.check",
            "files.write",
            "cancel",
        ] {
            let mut params = json!({ "path": "a.pdf" });
            let error = inject(method, &mut params, &[encrypt("s3cret")]).unwrap_err();
            assert_eq!(error.code, "INVALID_PARAMS");
            assert!(params.get("password").is_none());
        }
    }

    #[test]
    fn a_secret_supplied_by_the_page_is_refused() {
        let mut params = json!({ "path": "a.pdf", "password": "guess" });
        let error = inject("compress.run", &mut params, &[encrypt("s3cret")]).unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
        assert_eq!(params["password"], "guess");
    }

    #[test]
    fn signing_needs_the_bound_certificate() {
        let mut params = json!({ "path": "a.pdf", "certificatePath": "C:/certs/me.p12", "certificatePassword": "" });
        inject("sign.run", &mut params, &[sign("pin", "C:/certs/me.p12")]).unwrap();
        assert_eq!(params["certificatePassword"], "pin");

        let mut moved = json!({ "path": "a.pdf", "certificatePath": "C:/certs/other.p12" });
        let error = inject("sign.run", &mut moved, &[sign("pin", "C:/certs/me.p12")]).unwrap_err();
        assert_eq!(error.code, "SECRET_BINDING_CHANGED");
        assert!(moved.get("certificatePassword").is_none());

        let mut elsewhere = json!({ "path": "a.pdf", "certificatePath": "C:/certs/me.p12" });
        let error = inject(
            "compress.run",
            &mut elsewhere,
            &[sign("pin", "C:/certs/me.p12")],
        )
        .unwrap_err();
        assert_eq!(error.code, "INVALID_PARAMS");
    }

    #[test]
    fn params_must_be_an_object() {
        let mut params = json!(["a.pdf"]);
        assert!(inject("compress.run", &mut params, &[encrypt("s3cret")]).is_err());
    }
}
