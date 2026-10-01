export type TokenKind = "keyword" | "string" | "comment" | "number" | "text";
export type Token = { kind: TokenKind; text: string };

const KEYWORDS: Record<string, string[]> = {
  javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "class", "extends", "new", "this", "super", "import", "export", "default", "from", "async", "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "yield", "static", "null", "undefined", "true", "false"],
  typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "class", "extends", "implements", "interface", "type", "enum", "new", "this", "super", "import", "export", "default", "from", "async", "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "yield", "static", "public", "private", "protected", "readonly", "namespace", "declare", "as", "null", "undefined", "true", "false"],
  python: ["def", "return", "if", "elif", "else", "for", "while", "class", "import", "from", "as", "try", "except", "finally", "raise", "with", "lambda", "yield", "async", "await", "pass", "break", "continue", "global", "nonlocal", "and", "or", "not", "in", "is", "None", "True", "False", "self"],
  java: ["public", "private", "protected", "static", "final", "class", "interface", "extends", "implements", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "throws", "import", "package", "void", "this", "super", "null", "true", "false"],
  csharp: ["public", "private", "protected", "static", "readonly", "class", "interface", "namespace", "using", "new", "return", "if", "else", "for", "foreach", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "void", "this", "base", "var", "null", "true", "false", "async", "await"],
  go: ["func", "package", "import", "return", "if", "else", "for", "range", "switch", "case", "break", "continue", "defer", "go", "chan", "select", "struct", "interface", "type", "var", "const", "map", "nil", "true", "false"],
  rust: ["fn", "let", "mut", "return", "if", "else", "for", "while", "loop", "match", "struct", "enum", "impl", "trait", "pub", "use", "mod", "self", "Self", "async", "await", "true", "false", "None", "Some"],
  c: ["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "struct", "union", "enum", "typedef", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "static", "const", "sizeof", "NULL"],
  cpp: ["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "struct", "union", "enum", "class", "typedef", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "static", "const", "sizeof", "namespace", "using", "new", "delete", "this", "public", "private", "protected", "template", "typename", "nullptr", "true", "false"],
  php: ["function", "return", "if", "elseif", "else", "for", "foreach", "while", "do", "switch", "case", "break", "continue", "class", "extends", "implements", "interface", "new", "this", "public", "private", "protected", "static", "namespace", "use", "try", "catch", "finally", "throw", "echo", "null", "true", "false"],
  ruby: ["def", "end", "return", "if", "elsif", "else", "unless", "for", "while", "until", "case", "when", "break", "next", "class", "module", "new", "self", "require", "require_relative", "begin", "rescue", "ensure", "raise", "yield", "nil", "true", "false", "do"],
  sql: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "join", "inner", "left", "right", "outer", "on", "group", "by", "order", "having", "and", "or", "not", "null", "as", "distinct", "limit"],
  bash: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "echo", "export", "local", "true", "false"],
};

const HASH_COMMENT_LANGS = new Set(["python", "ruby", "bash"]);
const DOUBLE_SLASH_LANGS = new Set(["javascript", "typescript", "java", "csharp", "go", "rust", "c", "cpp", "php"]);

function normalizeLanguage(language: string | null | undefined): string {
  const lower = (language ?? "").toLowerCase().trim();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    "c++": "cpp",
    cs: "csharp",
    sh: "bash",
    shell: "bash",
    rb: "ruby",
  };
  return aliases[lower] ?? lower;
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

export function tokenizeLine(line: string, language: string | null | undefined): Token[] {
  const lang = normalizeLanguage(language);
  const keywords = new Set(KEYWORDS[lang] ?? []);
  const useHashComment = HASH_COMMENT_LANGS.has(lang) || (lang !== "" && !DOUBLE_SLASH_LANGS.has(lang) && lang !== "sql");
  const tokens: Token[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      tokens.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < line.length) {
    const char = line[i];

    if (useHashComment && char === "#") {
      flush();
      tokens.push({ kind: "comment", text: line.slice(i) });
      break;
    }
    if (DOUBLE_SLASH_LANGS.has(lang) && char === "/" && line[i + 1] === "/") {
      flush();
      tokens.push({ kind: "comment", text: line.slice(i) });
      break;
    }
    if (lang === "sql" && char === "-" && line[i + 1] === "-") {
      flush();
      tokens.push({ kind: "comment", text: line.slice(i) });
      break;
    }

    if (char === '"' || char === "'" || char === "`") {
      flush();
      const quote = char;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j += 1;
        j += 1;
      }
      const end = Math.min(j + 1, line.length);
      tokens.push({ kind: "string", text: line.slice(i, end) });
      i = end;
      continue;
    }

    if (isDigit(char) && (buffer === "" || !isIdentifierPart(buffer[buffer.length - 1] ?? ""))) {
      flush();
      let j = i;
      while (j < line.length && /[0-9.xXa-fA-F]/.test(line[j])) j += 1;
      tokens.push({ kind: "number", text: line.slice(i, j) });
      i = j;
      continue;
    }

    if (isIdentifierStart(char)) {
      let j = i;
      while (j < line.length && isIdentifierPart(line[j])) j += 1;
      const word = line.slice(i, j);
      flush();
      tokens.push({ kind: keywords.has(word) ? "keyword" : "text", text: word });
      i = j;
      continue;
    }

    buffer += char;
    i += 1;
  }
  flush();
  return tokens;
}

export function tokenizeCode(lines: string[], language: string | null | undefined): Token[][] {
  return lines.map((line) => tokenizeLine(line, language));
}
