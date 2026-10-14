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
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    operations: HashMap<String, Vec<Vec<String>>>,
    #[serde(default)]
    in_place_by_default: Vec<String>,
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

struct Operation {
    rules: Vec<Rule>,
    in_place_by_default: bool,
}

type Operations = HashMap<String, Operation>;

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
        let in_place_by_default = manifest.in_place_by_default.contains(&method);
        operations.insert(
            method,
            Operation {
                rules,
                in_place_by_default,
            },
        );
    }
    if let Some(stray) = manifest
        .in_place_by_default
        .iter()
        .find(|method| !operations.contains_key(*method))
    {
        return Err(format!("{stray}: in place by default but not listed"));
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

#[derive(Debug, Default)]
pub struct WriteScope {
    files: Vec<String>,
    folders: Vec<String>,
}

impl WriteScope {
    pub(crate) fn add(&mut self, path: &Path, directory: bool) {
        let key = crate::grants::key_of(path);
        if key.is_empty() {
            return;
        }
        if directory {
            self.folders.push(key);
        } else {
            self.files.push(key);
        }
    }

    fn holds(&self, key: &str) -> bool {
        let parent = crate::grants::parent_key(key);
        self.files.iter().any(|file| {
            file == key || (parent.is_some() && crate::grants::parent_key(file) == parent)
        }) || self
            .folders
            .iter()
            .any(|folder| crate::grants::inside(key, folder))
    }

    pub fn covers(&self, path: &Path) -> bool {
        self.holds(&crate::grants::key_of(path))
    }
}

fn unknown_method(method: &str) -> RpcError {
    RpcError::new("UNKNOWN_METHOD", format!("unknown method: {method}"))
}

fn names_an_output(operation: &Operation, params: &Value) -> bool {
    operation
        .rules
        .iter()
        .filter(|rule| matches!(rule.kind, Kind::Write | Kind::WriteDir))
        .any(|rule| {
            let mut found = Vec::new();
            collect(params, &rule.pattern, &mut found);
            !found.is_empty()
        })
}

fn writes_in_place(operation: &Operation, params: &Value) -> bool {
    let asked = params
        .get(IN_PLACE_KEY)
        .and_then(Value::as_bool)
        .unwrap_or(operation.in_place_by_default);
    asked || !names_an_output(operation, params)
}

fn check_with(
    operations: &Operations,
    access: &dyn Access,
    method: &str,
    params: &Value,
) -> Result<WriteScope, RpcError> {
    let operation = operations
        .get(method)
        .ok_or_else(|| unknown_method(method))?;
    let in_place = writes_in_place(operation, params);
    let mut scope = WriteScope::default();
    for rule in &operation.rules {
        let mut found = Vec::new();
        collect(params, &rule.pattern, &mut found);
        for text in found {
            let path = Path::new(text);
            match rule.kind {
                Kind::Read | Kind::ReadDir => access.read(path)?,
                Kind::Write => {
                    access.write(path, false)?;
                    scope.add(path, false);
                }
                Kind::WriteDir => {
                    access.write(path, true)?;
                    scope.add(path, true);
                }
                Kind::Modify => {
                    access.read(path)?;
                    access.write(path, false)?;
                    scope.add(path, false);
                }
                Kind::InPlace => {
                    access.read(path)?;
                    if in_place {
                        access.write(path, false)?;
                        scope.add(path, false);
                    }
                }
            }
        }
    }
    Ok(scope)
}

pub fn check_op(method: &str, params: &Value) -> Result<WriteScope, RpcError> {
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
                    "doc.stamp": [["path", "inPlace"], ["output", "write"]],
                    "doc.parts": [["sources", "*", "path", "inPlace"], ["outputDir", "writeDir"]],
                    "system.ping": []
                },
                "inPlaceByDefault": ["doc.stamp"]
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

    fn scope_of(method: &str, params: Value) -> WriteScope {
        let access = Recorded {
            allowed: vec!["a.pdf", "o.pdf", "Out"],
            ..Recorded::default()
        };
        check_with(&sample(), &access, method, &params).unwrap()
    }

    #[test]
    fn the_shipped_manifest_lists_every_operation_with_known_kinds() {
        let operations = parse(MANIFEST).unwrap();

        assert!(operations.len() > 200);
        assert!(operations["system.ping"].rules.is_empty());
        assert!(operations["links.add"].in_place_by_default);
        assert!(!operations["forms.fill"].in_place_by_default);
        assert!(operations["viewer.restore"]
            .rules
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
    fn an_in_place_path_is_written_unless_the_call_names_an_output_instead() {
        let allowed = vec!["a.pdf", "o.pdf"];
        let (_, copy) = run(
            allowed.clone(),
            "doc.apply",
            json!({ "path": "a.pdf", "output": "o.pdf" }),
        );
        let (_, asked) = run(
            allowed.clone(),
            "doc.apply",
            json!({ "path": "a.pdf", "inPlace": true }),
        );
        let (_, no_output) = run(allowed.clone(), "doc.apply", json!({ "path": "a.pdf" }));
        let (_, empty_output) = run(
            allowed,
            "doc.apply",
            json!({ "path": "a.pdf", "output": "", "inPlace": false }),
        );

        assert_eq!(copy, vec!["read a.pdf", "write o.pdf"]);
        assert_eq!(asked, vec!["read a.pdf", "write a.pdf"]);
        assert_eq!(no_output, vec!["read a.pdf", "write a.pdf"]);
        assert_eq!(empty_output, vec!["read a.pdf", "write a.pdf"]);
    }

    #[test]
    fn an_operation_that_works_in_place_by_default_needs_an_explicit_no() {
        let allowed = vec!["a.pdf", "o.pdf"];
        let (_, silent) = run(
            allowed.clone(),
            "doc.stamp",
            json!({ "path": "a.pdf", "output": "o.pdf" }),
        );
        let (_, declined) = run(
            allowed,
            "doc.stamp",
            json!({ "path": "a.pdf", "output": "o.pdf", "inPlace": false }),
        );

        assert_eq!(silent, vec!["read a.pdf", "write a.pdf", "write o.pdf"]);
        assert_eq!(declined, vec!["read a.pdf", "write o.pdf"]);
    }

    #[test]
    fn an_output_folder_counts_as_an_output_for_in_place_sources() {
        let (_, calls) = run(
            vec!["a.pdf", "Out"],
            "doc.parts",
            json!({ "sources": [{ "path": "a.pdf" }], "outputDir": "Out" }),
        );

        assert_eq!(calls, vec!["read a.pdf", "writeDir Out"]);
    }

    #[test]
    fn the_write_scope_holds_written_files_their_siblings_and_folders_below_outputs() {
        let base = std::env::temp_dir().join("vivepdf-scope");
        let output = base.join("o.pdf");
        let folder = base.join("Out");
        let mut scope = WriteScope::default();
        scope.add(&output, false);
        scope.add(&folder, true);

        assert!(scope.covers(&output));
        assert!(scope.covers(&base.join("o-2.png")));
        assert!(scope.covers(&folder.join("deep").join("p.pdf")));
        assert!(!scope.covers(&std::env::temp_dir().join("elsewhere.pdf")));
        assert!(!scope.covers(&base.join("Other").join("x.pdf")));
    }

    #[test]
    fn a_path_only_read_never_enters_the_write_scope() {
        let scope = scope_of("doc.apply", json!({ "path": "a.pdf", "output": "o.pdf" }));
        let in_place = scope_of("doc.apply", json!({ "path": "a.pdf", "inPlace": true }));
        let parts = scope_of(
            "doc.parts",
            json!({ "sources": [{ "path": "a.pdf" }], "outputDir": "Out" }),
        );

        assert_eq!(scope.files.len(), 1);
        assert!(scope.files[0].ends_with("o.pdf"));
        assert!(in_place.files[0].ends_with("a.pdf"));
        assert!(parts.files.is_empty());
        assert_eq!(parts.folders.len(), 1);
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
        assert!(parse(r#"{"version":1,"operations":{},"inPlaceByDefault":["a.b"]}"#).is_err());
    }
}
