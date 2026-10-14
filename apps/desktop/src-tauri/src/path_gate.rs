use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

use crate::rpc::RpcError;

const MANIFEST: &str = include_str!("../resources/op-paths.json");
const MANIFEST_VERSION: u32 = 1;
const ANY_ITEM: &str = "*";
const ANY_DEPTH: &str = "**";
const IN_PLACE_KEY: &str = "inPlace";

#[derive(Deserialize)]
struct Manifest {
    version: u32,
    operations: HashMap<String, Vec<Vec<String>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Read,
    Write,
    Modify,
    InPlace,
    ReadDir,
    WriteDir,
}

impl Kind {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "read" => Some(Self::Read),
            "write" => Some(Self::Write),
            "modify" => Some(Self::Modify),
            "inPlace" => Some(Self::InPlace),
            "readDir" => Some(Self::ReadDir),
            "writeDir" => Some(Self::WriteDir),
            _ => None,
        }
    }
}

struct Rule {
    pattern: Vec<String>,
    kind: Kind,
}

type Operations = HashMap<String, Vec<Rule>>;

fn parse(text: &str) -> Result<Operations, String> {
    let manifest: Manifest = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if manifest.version != MANIFEST_VERSION {
        return Err(format!("unsupported version {}", manifest.version));
    }
    let mut operations = Operations::new();
    for (method, entries) in manifest.operations {
        let mut rules = Vec::with_capacity(entries.len());
        for mut entry in entries {
            let name = entry.pop().unwrap_or_default();
            let kind =
                Kind::parse(&name).ok_or_else(|| format!("{method}: unknown kind {name}"))?;
            if entry.is_empty() {
                return Err(format!("{method}: empty pattern"));
            }
            rules.push(Rule {
                pattern: entry,
                kind,
            });
        }
        operations.insert(method, rules);
    }
    Ok(operations)
}

fn operations() -> Result<&'static Operations, RpcError> {
    static OPERATIONS: OnceLock<Result<Operations, String>> = OnceLock::new();
    OPERATIONS
        .get_or_init(|| parse(MANIFEST))
        .as_ref()
        .map_err(|error| RpcError::new("INTERNAL", format!("path manifest unreadable: {error}")))
}

fn children(value: &Value) -> Box<dyn Iterator<Item = &Value> + '_> {
    match value {
        Value::Array(items) => Box::new(items.iter()),
        Value::Object(map) => Box::new(map.values()),
        _ => Box::new(std::iter::empty()),
    }
}

fn collect<'a>(value: &'a Value, pattern: &[String], found: &mut Vec<&'a str>) {
    let Some((head, rest)) = pattern.split_first() else {
        if let Value::String(text) = value {
            if !text.is_empty() {
                found.push(text);
            }
        }
        return;
    };
    match head.as_str() {
        ANY_DEPTH => {
            collect(value, rest, found);
            for child in children(value) {
                collect(child, pattern, found);
            }
        }
        ANY_ITEM => {
            for child in children(value) {
                collect(child, rest, found);
            }
        }
        key => {
            if let Some(child) = value.as_object().and_then(|map| map.get(key)) {
                collect(child, rest, found);
            }
        }
    }
}

trait Access {
    fn read(&self, path: &Path) -> Result<(), RpcError>;
    fn write(&self, path: &Path, directory: bool) -> Result<(), RpcError>;
}

struct Granted;

impl Access for Granted {
    fn read(&self, path: &Path) -> Result<(), RpcError> {
        crate::grants::check_read(path)
    }

    fn write(&self, path: &Path, directory: bool) -> Result<(), RpcError> {
        if directory {
            crate::write_guard::check_folder(path)?;
            crate::grants::check_write_folder(path)
        } else {
            crate::write_guard::check_file(path)?;
            crate::grants::check_write(path)
        }
    }
}

fn unknown_method(method: &str) -> RpcError {
    RpcError::new("UNKNOWN_METHOD", format!("unknown method: {method}"))
}

fn check_with(
    operations: &Operations,
    access: &dyn Access,
    method: &str,
    params: &Value,
) -> Result<(), RpcError> {
    let rules = operations
        .get(method)
        .ok_or_else(|| unknown_method(method))?;
    let in_place = params.get(IN_PLACE_KEY).and_then(Value::as_bool) == Some(true);
    for rule in rules {
        let mut found = Vec::new();
        collect(params, &rule.pattern, &mut found);
        for text in found {
            let path = Path::new(text);
            match rule.kind {
                Kind::Read | Kind::ReadDir => access.read(path)?,
                Kind::Write => access.write(path, false)?,
                Kind::WriteDir => access.write(path, true)?,
                Kind::Modify => {
                    access.read(path)?;
                    access.write(path, false)?;
                }
                Kind::InPlace => {
                    access.read(path)?;
                    if in_place {
                        access.write(path, false)?;
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn check_op(method: &str, params: &Value) -> Result<(), RpcError> {
    check_with(operations()?, &Granted, method, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Recorded {
        allowed: Vec<&'static str>,
        calls: RefCell<Vec<String>>,
    }

    impl Recorded {
        fn verdict(&self, label: String, path: &Path) -> Result<(), RpcError> {
            let text = path.to_string_lossy().into_owned();
            self.calls.borrow_mut().push(format!("{label} {text}"));
            if self.allowed.contains(&text.as_str()) {
                Ok(())
            } else {
                Err(RpcError::new("PERMISSION_DENIED", text))
            }
        }

        fn calls(&self) -> Vec<String> {
            let mut calls = self.calls.borrow().clone();
            calls.sort();
            calls
        }
    }

    impl Access for Recorded {
        fn read(&self, path: &Path) -> Result<(), RpcError> {
            self.verdict("read".into(), path)
        }

        fn write(&self, path: &Path, directory: bool) -> Result<(), RpcError> {
            let label = if directory { "writeDir" } else { "write" };
            self.verdict(label.into(), path)
        }
    }

    fn sample() -> Operations {
        parse(
            &json!({
                "version": 1,
                "operations": {
                    "doc.merge": [["sources", "*", "path", "read"], ["output", "write"]],
                    "doc.tree": [["nodes", "*", "**", "image", "read"]],
                    "doc.apply": [["path", "inPlace"], ["output", "write"]],
                    "doc.move": [["path", "modify"], ["folder", "writeDir"]],
                    "doc.scan": [["folder", "readDir"], ["names", "*", "read"]],
                    "system.ping": []
                }
            })
            .to_string(),
        )
        .unwrap()
    }

    fn run(allowed: Vec<&'static str>, method: &str, params: Value) -> (bool, Vec<String>) {
        let access = Recorded {
            allowed,
            ..Recorded::default()
        };
        let outcome = check_with(&sample(), &access, method, &params).is_ok();
        (outcome, access.calls())
    }

    #[test]
    fn the_shipped_manifest_lists_every_operation_with_known_kinds() {
        let operations = parse(MANIFEST).unwrap();

        assert!(operations.len() > 200);
        assert!(operations["system.ping"].is_empty());
        assert!(operations["viewer.restore"]
            .iter()
            .any(|rule| rule.kind == Kind::Modify));
    }

    #[test]
    fn every_listed_path_is_checked_including_list_items_and_outputs() {
        let params =
            json!({ "sources": [{ "path": "a.pdf" }, { "path": "b.pdf" }], "output": "m.pdf" });

        let (ok, calls) = run(vec!["a.pdf", "b.pdf", "m.pdf"], "doc.merge", params.clone());
        let (refused, _) = run(vec!["a.pdf", "m.pdf"], "doc.merge", params);

        assert!(ok);
        assert_eq!(calls, vec!["read a.pdf", "read b.pdf", "write m.pdf"]);
        assert!(!refused);
    }

    #[test]
    fn recursive_shapes_are_checked_at_every_depth() {
        let params =
            json!({ "nodes": [{ "children": [{ "children": [{ "image": "deep.png" }] }] }] });

        let (ok, calls) = run(vec![], "doc.tree", params);

        assert!(!ok);
        assert_eq!(calls, vec!["read deep.png"]);
    }

    #[test]
    fn an_in_place_path_is_written_only_when_the_call_asks_for_it() {
        let (_, copy) = run(
            vec!["a.pdf", "o.pdf"],
            "doc.apply",
            json!({ "path": "a.pdf", "output": "o.pdf" }),
        );
        let (_, in_place) = run(
            vec!["a.pdf"],
            "doc.apply",
            json!({ "path": "a.pdf", "inPlace": true }),
        );

        assert_eq!(copy, vec!["read a.pdf", "write o.pdf"]);
        assert_eq!(in_place, vec!["read a.pdf", "write a.pdf"]);
    }

    #[test]
    fn a_moved_file_must_be_readable_and_writable_and_folders_are_checked_as_folders() {
        let (_, moved) = run(
            vec![],
            "doc.move",
            json!({ "path": "a.pdf", "folder": "Done" }),
        );
        let (_, scanned) = run(
            vec!["In", "x.pdf"],
            "doc.scan",
            json!({ "folder": "In", "names": ["x.pdf"] }),
        );

        assert_eq!(moved, vec!["read a.pdf"]);
        assert_eq!(scanned, vec!["read In", "read x.pdf"]);
    }

    #[test]
    fn empty_and_missing_paths_and_other_values_are_left_to_the_engine() {
        let params =
            json!({ "sources": [{ "path": "" }, { "path": null }, { "path": 4 }], "output": null });

        let (ok, calls) = run(vec![], "doc.merge", params);

        assert!(ok);
        assert!(calls.is_empty());
    }

    #[test]
    fn an_unlisted_method_is_refused_and_a_pathless_one_passes() {
        let access = Recorded::default();

        let error = check_with(&sample(), &access, "doc.unknown", &json!({})).unwrap_err();

        assert_eq!(error.code, "UNKNOWN_METHOD");
        assert!(check_with(&sample(), &access, "system.ping", &json!({ "path": "x" })).is_ok());
    }

    #[test]
    fn a_broken_or_future_manifest_is_refused() {
        assert!(parse("{").is_err());
        assert!(parse(r#"{"version":2,"operations":{}}"#).is_err());
        assert!(parse(r#"{"version":1,"operations":{"a.b":[["path","delete"]]}}"#).is_err());
        assert!(parse(r#"{"version":1,"operations":{"a.b":[["read"]]}}"#).is_err());
    }
}
