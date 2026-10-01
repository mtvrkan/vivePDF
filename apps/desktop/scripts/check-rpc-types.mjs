import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidecarDir = path.resolve(desktopDir, "..", "..", "sidecar");
const maxDepth = 8;

function loadProgram(files) {
  const configPath = path.join(desktopDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile).config;
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, desktopDir);
  return ts.createProgram(files, parsed.options);
}

function withoutNullish(checker, type) {
  if (!type.isUnion()) return type;
  const kept = type.types.filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
  if (kept.length === type.types.length) return type;
  if (kept.length === 1) return kept[0];
  return checker.getUnionType(kept);
}

function isPlainObject(type) {
  if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return false;
  return type.getCallSignatures().length === 0;
}

function describeTsType(checker, type, depth, seen) {
  if (!type || depth > maxDepth) return null;
  const bare = withoutNullish(checker, type);
  if (checker.isArrayType(bare)) {
    return describeTsType(checker, checker.getTypeArguments(bare)[0], depth + 1, seen);
  }
  if (bare.isUnion()) return null;
  if (!isPlainObject(bare)) return null;
  const indexType = bare.getStringIndexType();
  if (indexType && bare.getProperties().length === 0) {
    return describeTsType(checker, indexType, depth + 1, seen);
  }
  if (seen.has(bare)) return null;
  const nextSeen = new Set(seen).add(bare);
  const fields = {};
  for (const symbol of checker.getPropertiesOfType(bare)) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const propertyType = declaration
      ? checker.getTypeOfSymbolAtLocation(symbol, declaration)
      : checker.getTypeOfSymbol(symbol);
    fields[symbol.getName()] = {
      optional: Boolean(symbol.flags & ts.SymbolFlags.Optional),
      nested: describeTsType(checker, propertyType, depth + 1, nextSeen),
    };
  }
  return { fields };
}

export function collectTsContracts() {
  const rpcDir = path.join(desktopDir, "src", "shared", "rpc");
  const files = readdirSync(rpcDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(rpcDir, name));
  const program = loadProgram(files);
  const checker = program.getTypeChecker();
  const contracts = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "rpc" &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const resultNode = node.typeArguments?.[0];
        const paramsNode = node.arguments[1];
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        contracts.push({
          method: node.arguments[0].text,
          location: `${path.relative(desktopDir, file).replaceAll("\\", "/")}:${line + 1}`,
          params: paramsNode ? describeTsType(checker, checker.getTypeAtLocation(paramsNode), 0, new Set()) : { fields: {} },
          result: resultNode ? describeTsType(checker, checker.getTypeFromTypeNode(resultNode), 0, new Set()) : null,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return contracts;
}

function resolveRef(schema, root) {
  let current = schema;
  const visited = new Set();
  while (current && current.$ref && !visited.has(current.$ref)) {
    visited.add(current.$ref);
    const name = current.$ref.split("/").pop();
    current = root.$defs?.[name];
  }
  return current;
}

function describeSchema(schema, root, depth, seen) {
  if (!schema || depth > maxDepth) return null;
  const ref = schema.$ref;
  const node = resolveRef(schema, root);
  if (!node) return null;
  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    const meaningful = variants.filter((variant) => variant.type !== "null");
    if (meaningful.length !== 1) return null;
    return describeSchema(meaningful[0], root, depth + 1, seen);
  }
  if (node.type === "array" && node.items) return describeSchema(node.items, root, depth + 1, seen);
  if (node.type !== "object") return null;
  if (!node.properties) {
    return node.additionalProperties && typeof node.additionalProperties === "object"
      ? describeSchema(node.additionalProperties, root, depth + 1, seen)
      : null;
  }
  if (ref && seen.has(ref)) return null;
  const nextSeen = ref ? new Set(seen).add(ref) : seen;
  const required = new Set(node.required ?? []);
  const fields = {};
  for (const [name, property] of Object.entries(node.properties)) {
    fields[name] = { required: required.has(name), nested: describeSchema(property, root, depth + 1, nextSeen) };
  }
  return { fields, closed: node.additionalProperties === false };
}

export function loadPythonSchemas() {
  const output = execFileSync("uv", ["run", "--quiet", "python", "-m", "vivepdf.rpc.schema"], {
    cwd: sidecarDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output);
}

function compareParams(tsShape, pyShape, trail, problems) {
  for (const [name, field] of Object.entries(tsShape.fields)) {
    const pyField = pyShape.fields[name];
    if (!pyField) {
      problems.push(`${trail}.${name}: sent by the UI but not a sidecar parameter`);
      continue;
    }
    if (pyField.required && field.optional) {
      problems.push(`${trail}.${name}: required by the sidecar but optional in TypeScript`);
    }
    if (field.nested && pyField.nested) compareParams(field.nested, pyField.nested, `${trail}.${name}`, problems);
  }
  for (const [name, pyField] of Object.entries(pyShape.fields)) {
    if (pyField.required && !(name in tsShape.fields)) {
      problems.push(`${trail}.${name}: required by the sidecar but missing in TypeScript`);
    }
  }
}

function compareResult(tsShape, pyShape, trail, problems) {
  for (const [name, field] of Object.entries(tsShape.fields)) {
    const pyField = pyShape.fields[name];
    if (!pyField) {
      problems.push(`${trail}.${name}: read by the UI but never returned by the sidecar`);
      continue;
    }
    if (field.nested && pyField.nested) compareResult(field.nested, pyField.nested, `${trail}.${name}`, problems);
  }
  for (const name of Object.keys(pyShape.fields)) {
    if (!(name in tsShape.fields)) {
      problems.push(`${trail}.${name}: returned by the sidecar but missing in TypeScript`);
    }
  }
}

export function compareContracts(contracts, schemas) {
  const problems = [];
  for (const contract of contracts) {
    const entry = schemas[contract.method];
    const trail = `${contract.method} (${contract.location})`;
    if (!entry) {
      problems.push(`${trail}: no sidecar operation with this name`);
      continue;
    }
    const pyParams = describeSchema(entry.params, entry.params, 0, new Set());
    if (contract.params && pyParams) compareParams(contract.params, pyParams, `${trail} params`, problems);
    const pyResult = entry.result ? describeSchema(entry.result, entry.result, 0, new Set()) : null;
    if (contract.result && pyResult) compareResult(contract.result, pyResult, `${trail} result`, problems);
  }
  return problems;
}

function main() {
  const contracts = collectTsContracts();
  const problems = compareContracts(contracts, loadPythonSchemas());
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} RPC type mismatch(es) across ${contracts.length} calls`);
    process.exit(1);
  }
  console.log(`RPC types match for ${contracts.length} calls`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
