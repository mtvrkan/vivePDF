export const FUNCTION_NAMES = ["asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "cbrt", "floor", "ceil", "round", "sign", "sin", "cos", "tan", "cot", "sec", "csc", "abs", "exp", "log", "ln"] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];
export type ConstantName = "pi" | "e";

export type Expression =
  | { kind: "number"; value: number; text: string }
  | { kind: "variable" }
  | { kind: "constant"; name: ConstantName }
  | { kind: "negate"; argument: Expression }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: Expression; right: Expression; implicit?: boolean }
  | { kind: "call"; name: FunctionName; argument: Expression };

export type ParseErrorCode = "empty" | "tooLong" | "unexpected" | "unknownName" | "unclosed" | "tooDeep";
export type ParseResult = { expression: Expression } | { error: ParseErrorCode; position: number; detail: string };

export const MAX_EXPRESSION_LENGTH = 200;
const MAX_DEPTH = 40;
const NAMES = [...FUNCTION_NAMES, "pi", "x", "e"].sort((first, second) => second.length - first.length);

type Token =
  | { type: "number"; value: number; text: string; position: number }
  | { type: "name"; value: string; position: number }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^"; position: number }
  | { type: "open" | "close" | "bar"; position: number }
  | { type: "end"; position: number };

class ParseError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    readonly position: number,
    readonly detail = "",
  ) {
    super(code);
  }
}

function normalize(source: string): string {
  return source
    .replace(/[−–]/g, "-")
    .replace(/[×·⋅∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt ")
    .replace(/\*\*/g, "^")
    .replace(/(\d),(\d)/g, "$1.$2");
}

function stripDefinition(source: string): string {
  return source.replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/i, "");
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)/.exec(source.slice(index));
    if (number) {
      const text = number[0];
      tokens.push({ type: "number", value: Number(text), text, position: index });
      index += text.length;
      continue;
    }
    if (/[a-z]/i.test(char)) {
      const word = /^[a-z]+/i.exec(source.slice(index))?.[0].toLowerCase() ?? "";
      let offset = 0;
      while (offset < word.length) {
        const name = NAMES.find((candidate) => word.startsWith(candidate, offset));
        if (!name) throw new ParseError("unknownName", index + offset, word.slice(offset));
        tokens.push({ type: "name", value: name, position: index + offset });
        offset += name.length;
      }
      index += word.length;
      continue;
    }
    if ("+-*/^".includes(char)) tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/" | "^", position: index });
    else if (char === "(" || char === "[") tokens.push({ type: "open", position: index });
    else if (char === ")" || char === "]") tokens.push({ type: "close", position: index });
    else if (char === "|") tokens.push({ type: "bar", position: index });
    else throw new ParseError("unexpected", index, char);
    index += 1;
  }
  tokens.push({ type: "end", position: source.length });
  return tokens;
}

function isFunctionName(value: string): value is FunctionName {
  return (FUNCTION_NAMES as readonly string[]).includes(value);
}

class Parser {
  private index = 0;
  private depth = 0;
  private bars = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    const expression = this.sum();
    const next = this.peek();
    if (next.type !== "end") throw new ParseError("unexpected", next.position, next.type === "close" ? ")" : next.type === "bar" ? "|" : "");
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private take(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private nest<T>(position: number, inner: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new ParseError("tooDeep", position);
    try {
      return inner();
    } finally {
      this.depth -= 1;
    }
  }

  private sum(): Expression {
    let left = this.product();
    for (;;) {
      const next = this.peek();
      if (next.type !== "operator" || (next.value !== "+" && next.value !== "-")) return left;
      this.take();
      left = { kind: "binary", operator: next.value, left, right: this.product() };
    }
  }

  private startsFactor(token: Token): boolean {
    return token.type === "number" || token.type === "name" || token.type === "open" || (token.type === "bar" && this.bars === 0);
  }

  private product(): Expression {
    let left = this.unary();
    for (;;) {
      const next = this.peek();
      if (next.type === "operator" && (next.value === "*" || next.value === "/")) {
        this.take();
        left = { kind: "binary", operator: next.value, left, right: this.unary() };
      } else if (this.startsFactor(next)) {
        left = { kind: "binary", operator: "*", left, right: this.power(), implicit: true };
      } else {
        return left;
      }
    }
  }

  private unary(): Expression {
    const next = this.peek();
    if (next.type === "operator" && (next.value === "-" || next.value === "+")) {
      this.take();
      return this.nest(next.position, () => {
        const argument = this.unary();
        return next.value === "-" ? { kind: "negate", argument } : argument;
      });
    }
    return this.power();
  }

  private power(): Expression {
    const base = this.primary();
    const next = this.peek();
    if (next.type === "operator" && next.value === "^") {
      this.take();
      return this.nest(next.position, () => ({ kind: "binary", operator: "^", left: base, right: this.unary() }));
    }
    return base;
  }

  private primary(): Expression {
    const token = this.take();
    if (token.type === "number") return { kind: "number", value: token.value, text: token.text };
    if (token.type === "name") {
      if (token.value === "x") return { kind: "variable" };
      if (token.value === "pi" || token.value === "e") return { kind: "constant", name: token.value };
      const name = token.value;
      if (!isFunctionName(name)) throw new ParseError("unknownName", token.position, token.value);
      return this.nest(token.position, () => {
        const next = this.peek();
        if (next.type === "operator" && next.value === "^") {
          this.take();
          const exponent = this.unary();
          return { kind: "binary", operator: "^", left: { kind: "call", name, argument: this.power() }, right: exponent };
        }
        return { kind: "call", name, argument: this.power() };
      });
    }
    if (token.type === "open") {
      return this.nest(token.position, () => {
        const saved = this.bars;
        this.bars = 0;
        const inner = this.sum();
        this.bars = saved;
        if (this.peek().type !== "close") throw new ParseError("unclosed", token.position, "(");
        this.take();
        return inner;
      });
    }
    if (token.type === "bar") {
      return this.nest(token.position, () => {
        this.bars += 1;
        const inner = this.sum();
        this.bars -= 1;
        if (this.peek().type !== "bar") throw new ParseError("unclosed", token.position, "|");
        this.take();
        return { kind: "call", name: "abs", argument: inner };
      });
    }
    if (token.type === "end") throw new ParseError(this.index === 1 ? "empty" : "unexpected", token.position, "");
    throw new ParseError("unexpected", token.position, token.type === "operator" ? token.value : token.type === "close" ? ")" : "|");
  }
}

export function parseExpression(source: string): ParseResult {
  if (source.length > MAX_EXPRESSION_LENGTH) return { error: "tooLong", position: MAX_EXPRESSION_LENGTH, detail: "" };
  const text = normalize(stripDefinition(source));
  if (text.trim() === "") return { error: "empty", position: 0, detail: "" };
  try {
    return { expression: new Parser(tokenize(text)).parse() };
  } catch (error) {
    if (error instanceof ParseError) return { error: error.code, position: error.position, detail: error.detail };
    throw error;
  }
}

const FUNCTIONS: Record<FunctionName, (value: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (value) => 1 / Math.tan(value),
  sec: (value) => 1 / Math.cos(value),
  csc: (value) => 1 / Math.sin(value),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};

export function compile(expression: Expression): (x: number) => number {
  switch (expression.kind) {
    case "number": {
      const value = expression.value;
      return () => value;
    }
    case "variable":
      return (x) => x;
    case "constant": {
      const value = expression.name === "pi" ? Math.PI : Math.E;
      return () => value;
    }
    case "negate": {
      const argument = compile(expression.argument);
      return (x) => -argument(x);
    }
    case "call": {
      const fn = FUNCTIONS[expression.name];
      const argument = compile(expression.argument);
      return (x) => fn(argument(x));
    }
    case "binary": {
      const left = compile(expression.left);
      const right = compile(expression.right);
      switch (expression.operator) {
        case "+":
          return (x) => left(x) + right(x);
        case "-":
          return (x) => left(x) - right(x);
        case "*":
          return (x) => left(x) * right(x);
        case "/":
          return (x) => left(x) / right(x);
        case "^":
          return (x) => power(left(x), right(x));
      }
    }
  }
}

function power(base: number, exponent: number): number {
  if (base >= 0 || Number.isInteger(exponent)) return base ** exponent;
  const inverse = 1 / exponent;
  const rounded = Math.round(inverse);
  if (Math.abs(inverse - rounded) < 1e-9 && rounded % 2 !== 0) return -((-base) ** exponent);
  return Number.NaN;
}

const LATEX_FUNCTIONS: Partial<Record<FunctionName, string>> = {
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  cot: "\\cot",
  sec: "\\sec",
  csc: "\\csc",
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  sinh: "\\sinh",
  cosh: "\\cosh",
  tanh: "\\tanh",
  ln: "\\ln",
  log: "\\log",
  sign: "\\operatorname{sgn}",
  round: "\\operatorname{round}",
};

function isAtom(expression: Expression): boolean {
  return expression.kind === "number" || expression.kind === "variable" || expression.kind === "constant";
}

function isSum(expression: Expression): boolean {
  return expression.kind === "binary" && (expression.operator === "+" || expression.operator === "-");
}

function parens(latex: string): string {
  return `\\left(${latex}\\right)`;
}

function startsWithDigit(expression: Expression): boolean {
  if (expression.kind === "number") return true;
  if (expression.kind === "binary" && expression.operator !== "/") return startsWithDigit(expression.left);
  return false;
}

export function toLatex(expression: Expression): string {
  switch (expression.kind) {
    case "number":
      return expression.text;
    case "variable":
      return "x";
    case "constant":
      return expression.name === "pi" ? "\\pi" : "e";
    case "negate": {
      const inner = toLatex(expression.argument);
      return `-${isSum(expression.argument) || expression.argument.kind === "negate" ? parens(inner) : inner}`;
    }
    case "call": {
      const argument = toLatex(expression.argument);
      switch (expression.name) {
        case "sqrt":
          return `\\sqrt{${argument}}`;
        case "cbrt":
          return `\\sqrt[3]{${argument}}`;
        case "abs":
          return `\\left|${argument}\\right|`;
        case "floor":
          return `\\left\\lfloor ${argument}\\right\\rfloor`;
        case "ceil":
          return `\\left\\lceil ${argument}\\right\\rceil`;
        case "exp":
          return `e^{${argument}}`;
        default: {
          const command = LATEX_FUNCTIONS[expression.name] ?? expression.name;
          return isAtom(expression.argument) ? `${command} ${argument}` : `${command}${parens(argument)}`;
        }
      }
    }
    case "binary": {
      const { operator, left, right } = expression;
      if (operator === "/") return `\\frac{${toLatex(left)}}{${toLatex(right)}}`;
      if (operator === "^") {
        const base = toLatex(left);
        const wrapped = isAtom(left) ? base : parens(base);
        return `${wrapped}^{${toLatex(right)}}`;
      }
      if (operator === "+") return `${toLatex(left)} + ${toLatex(right)}`;
      if (operator === "-") {
        const inner = toLatex(right);
        return `${toLatex(left)} - ${isSum(right) || right.kind === "negate" ? parens(inner) : inner}`;
      }
      const leftText = isSum(left) || left.kind === "negate" ? parens(toLatex(left)) : toLatex(left);
      const rightText = isSum(right) || right.kind === "negate" ? parens(toLatex(right)) : toLatex(right);
      const needsDot = startsWithDigit(right) && !(isSum(right) || right.kind === "negate");
      return needsDot ? `${leftText} \\cdot ${rightText}` : `${leftText}${right.kind === "call" || left.kind === "call" ? "\\," : " "}${rightText}`;
    }
  }
}
