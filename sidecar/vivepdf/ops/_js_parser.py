from vivepdf.ops._js_lexer import Token, tokenize
from vivepdf.ops._js_regexp import compile_pattern
from vivepdf.ops._js_values import ScriptError, ScriptLimit

MAX_DEPTH = 48
BINARY_PRECEDENCE = {
    "||": 1,
    "&&": 2,
    "|": 3,
    "^": 4,
    "&": 5,
    "==": 6,
    "!=": 6,
    "===": 6,
    "!==": 6,
    "<": 7,
    ">": 7,
    "<=": 7,
    ">=": 7,
    "in": 7,
    "instanceof": 7,
    "<<": 8,
    ">>": 8,
    ">>>": 8,
    "+": 9,
    "-": 9,
    "*": 10,
    "/": 10,
    "%": 10,
}
LOGICAL = frozenset({"||", "&&"})
ASSIGNMENTS = frozenset({"=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", ">>>=", "&=", "|=", "^="})
UNARY = frozenset({"-", "+", "!", "~", "typeof", "void", "delete"})
UPDATES = frozenset({"++", "--"})
LITERALS = {"true": True, "false": False, "null": None}
ACCESSOR_PARAMS = {"get": 0, "set": 1}

Node = tuple


LOOP_KEYWORDS = frozenset({"for", "while", "do"})


class Parser:
    def __init__(self, source: str) -> None:
        self.tokens = tokenize(source)
        self.position = 0
        self.depth = 0
        self.labels: dict[str, bool] = {}
        self.loops = 0
        self.switches = 0

    def peek(self, offset: int = 0) -> Token:
        return self.tokens[min(self.position + offset, len(self.tokens) - 1)]

    def advance(self) -> Token:
        token = self.tokens[self.position]
        if token.kind != "end":
            self.position += 1
        return token

    def at(self, value: str) -> bool:
        token = self.peek()
        return token.kind in ("punct", "keyword") and token.value == value

    def accept(self, value: str) -> bool:
        if self.at(value):
            self.advance()
            return True
        return False

    def expect(self, value: str) -> None:
        if not self.accept(value):
            raise ScriptError(f"expected {value!r}")

    def identifier(self) -> str:
        token = self.advance()
        if token.kind != "name":
            raise ScriptError("expected a name")
        return token.value

    def semicolon(self) -> None:
        if self.accept(";"):
            return
        token = self.peek()
        if token.kind == "end" or token.newline or self.at("}"):
            return
        raise ScriptError("expected ';'")

    def enter(self) -> None:
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise ScriptLimit("script nested too deeply")

    def leave(self) -> None:
        self.depth -= 1

    def program(self) -> list[Node]:
        statements = []
        while self.peek().kind != "end":
            statements.append(self.statement())
        return statements

    def statement(self) -> Node:
        self.enter()
        try:
            return self._statement()
        finally:
            self.leave()

    def _statement(self) -> Node:
        token = self.peek()
        if token.kind == "punct":
            if token.value == "{":
                return ("block", self.block())
            if token.value == ";":
                self.advance()
                return ("empty",)
        if token.kind == "keyword":
            handler = getattr(self, f"_{token.value}_statement", None)
            if handler is not None:
                self.advance()
                return handler()
        if self.label_ahead(0):
            self.advance()
            self.advance()
            return self.labelled(token.value, self.labelled_body(token.value))
        expression = self.expression()
        self.semicolon()
        return ("expression", expression)

    def label_ahead(self, offset: int) -> bool:
        colon = self.peek(offset + 1)
        return self.peek(offset).kind == "name" and colon.kind == "punct" and colon.value == ":"

    def labelled_body(self, label: str) -> Node:
        if label in self.labels:
            raise ScriptError(f"duplicate label '{label}'")
        offset = 0
        while self.label_ahead(offset):
            offset += 2
        target = self.peek(offset)
        self.labels[label] = target.kind == "keyword" and target.value in LOOP_KEYWORDS
        try:
            return self.statement()
        finally:
            del self.labels[label]

    def loop_body(self) -> Node:
        self.loops += 1
        try:
            return self.statement()
        finally:
            self.loops -= 1

    def labelled(self, label: str, body: Node) -> Node:
        if body[0] == "labelled":
            return ("labelled", [label, *body[1]], body[2])
        return ("labelled", [label], body)

    def block(self) -> list[Node]:
        self.expect("{")
        statements = []
        while not self.accept("}"):
            if self.peek().kind == "end":
                raise ScriptError("expected '}'")
            statements.append(self.statement())
        return statements

    def declarations(self, no_in: bool = False) -> Node:
        items = []
        while True:
            name = self.identifier()
            value = self.assignment(no_in) if self.accept("=") else None
            items.append((name, value))
            if not self.accept(","):
                return ("var", items)

    def _var_statement(self) -> Node:
        node = self.declarations()
        self.semicolon()
        return node

    _let_statement = _var_statement
    _const_statement = _var_statement

    def _function_statement(self) -> Node:
        name = self.identifier()
        params, body = self.function_rest()
        return ("function_declaration", name, params, body)

    def function_rest(self) -> tuple[list[str], list[Node]]:
        self.expect("(")
        params = []
        if not self.accept(")"):
            while True:
                params.append(self.identifier())
                if self.accept(")"):
                    break
                self.expect(",")
        outer = (self.labels, self.loops, self.switches)
        self.labels, self.loops, self.switches = {}, 0, 0
        try:
            return params, self.block()
        finally:
            self.labels, self.loops, self.switches = outer

    def _return_statement(self) -> Node:
        token = self.peek()
        if self.at(";") or self.at("}") or token.kind == "end" or token.newline:
            self.accept(";")
            return ("return", None)
        value = self.expression()
        self.semicolon()
        return ("return", value)

    def _if_statement(self) -> Node:
        test = self.parenthesized()
        consequent = self.statement()
        alternate = self.statement() if self.accept("else") else None
        return ("if", test, consequent, alternate)

    def parenthesized(self) -> Node:
        self.expect("(")
        value = self.expression()
        self.expect(")")
        return value

    def _for_statement(self) -> Node:
        self.expect("(")
        initial: Node | None = None
        if self.at("var") or self.at("let") or self.at("const"):
            self.advance()
            if self.peek(1).kind == "keyword" and self.peek(1).value == "in":
                name = self.identifier()
                self.expect("in")
                return self.for_in(("var", [(name, None)]), ("name", name))
            initial = self.declarations(no_in=True)
        elif not self.at(";"):
            expression = self.expression(no_in=True)
            if self.accept("in"):
                return self.for_in(None, expression)
            initial = ("expression", expression)
        self.expect(";")
        test = None if self.at(";") else self.expression()
        self.expect(";")
        update = None if self.at(")") else self.expression()
        self.expect(")")
        return ("for", initial, test, update, self.loop_body())

    def for_in(self, declaration: Node | None, target: Node) -> Node:
        if target[0] not in ("name", "member"):
            raise ScriptError("invalid for-in target")
        subject = self.expression()
        self.expect(")")
        return ("for_in", declaration, target, subject, self.loop_body())

    def _with_statement(self) -> Node:
        subject = self.parenthesized()
        return ("with", subject, self.statement())

    def _while_statement(self) -> Node:
        test = self.parenthesized()
        return ("while", test, self.loop_body())

    def _do_statement(self) -> Node:
        body = self.loop_body()
        self.expect("while")
        test = self.parenthesized()
        self.accept(";")
        return ("do", body, test)

    def _break_statement(self) -> Node:
        label = self.jump_label()
        if label is None and not (self.loops or self.switches):
            raise ScriptError("break outside a loop or switch")
        if label is not None and label not in self.labels:
            raise ScriptError(f"undefined label '{label}'")
        return ("break", label)

    def _continue_statement(self) -> Node:
        label = self.jump_label()
        if label is None and not self.loops:
            raise ScriptError("continue outside a loop")
        if label is not None and not self.labels.get(label, False):
            raise ScriptError(f"label '{label}' does not name a loop")
        return ("continue", label)

    def jump_label(self) -> str | None:
        token = self.peek()
        label = None
        if token.kind == "name" and not token.newline:
            label = self.identifier()
        self.semicolon()
        return label

    def _throw_statement(self) -> Node:
        if self.peek().newline:
            raise ScriptError("line break after throw")
        value = self.expression()
        self.semicolon()
        return ("throw", value)

    def _try_statement(self) -> Node:
        body = self.block()
        catch_name = catch_body = finally_body = None
        if self.accept("catch"):
            self.expect("(")
            catch_name = self.identifier()
            self.expect(")")
            catch_body = self.block()
        if self.accept("finally"):
            finally_body = self.block()
        if catch_body is None and finally_body is None:
            raise ScriptError("try without catch or finally")
        return ("try", body, catch_name, catch_body, finally_body)

    def _switch_statement(self) -> Node:
        subject = self.parenthesized()
        self.expect("{")
        cases: list[tuple[Node | None, list[Node]]] = []
        seen_default = False
        while not self.accept("}"):
            if self.accept("case"):
                test: Node | None = self.expression()
            elif self.accept("default"):
                if seen_default:
                    raise ScriptError("duplicate default")
                seen_default = True
                test = None
            else:
                raise ScriptError("expected case")
            self.expect(":")
            body = []
            self.switches += 1
            try:
                while not (self.at("case") or self.at("default") or self.at("}")):
                    if self.peek().kind == "end":
                        raise ScriptError("expected '}'")
                    body.append(self.statement())
            finally:
                self.switches -= 1
            cases.append((test, body))
        return ("switch", subject, cases)

    def expression(self, no_in: bool = False) -> Node:
        first = self.assignment(no_in)
        if not self.at(","):
            return first
        items = [first]
        while self.accept(","):
            items.append(self.assignment(no_in))
        return ("sequence", items)

    def assignment(self, no_in: bool = False) -> Node:
        self.enter()
        try:
            target = self.conditional(no_in)
            token = self.peek()
            if token.kind == "punct" and token.value in ASSIGNMENTS:
                if target[0] not in ("name", "member"):
                    raise ScriptError("invalid assignment target")
                self.advance()
                return ("assign", token.value, target, self.assignment(no_in))
            return target
        finally:
            self.leave()

    def conditional(self, no_in: bool) -> Node:
        test = self.binary(0, no_in)
        if not self.accept("?"):
            return test
        consequent = self.assignment()
        self.expect(":")
        return ("conditional", test, consequent, self.assignment(no_in))

    def binary(self, minimum: int, no_in: bool) -> Node:
        left = self.unary()
        while True:
            token = self.peek()
            operator = token.value if token.kind in ("punct", "keyword") else None
            precedence = BINARY_PRECEDENCE.get(operator) if isinstance(operator, str) else None
            if precedence is None or precedence <= minimum or (no_in and operator == "in"):
                return left
            self.advance()
            right = self.binary(precedence, no_in)
            kind = "logical" if operator in LOGICAL else "binary"
            left = (kind, operator, left, right)

    def unary(self) -> Node:
        self.enter()
        try:
            token = self.peek()
            if token.kind in ("punct", "keyword") and token.value in UNARY:
                self.advance()
                return ("unary", token.value, self.unary())
            if token.kind == "punct" and token.value in UPDATES:
                self.advance()
                target = self.unary()
                if target[0] not in ("name", "member"):
                    raise ScriptError("invalid update target")
                return ("update", token.value, True, target)
            return self.postfix()
        finally:
            self.leave()

    def postfix(self) -> Node:
        value = self.call()
        token = self.peek()
        if token.kind == "punct" and token.value in UPDATES and not token.newline:
            if value[0] not in ("name", "member"):
                raise ScriptError("invalid update target")
            self.advance()
            return ("update", token.value, False, value)
        return value

    def arguments(self) -> list[Node]:
        values: list[Node] = []
        if self.accept(")"):
            return values
        while True:
            values.append(self.assignment())
            if self.accept(")"):
                return values
            self.expect(",")

    def call(self) -> Node:
        if self.accept("new"):
            callee = self.member(self.primary(), allow_calls=False)
            values = self.arguments() if self.accept("(") else []
            value: Node = ("new", callee, values)
        else:
            value = self.primary()
        return self.member(value, allow_calls=True)

    def member(self, value: Node, allow_calls: bool) -> Node:
        while True:
            if self.accept("."):
                token = self.advance()
                if token.kind not in ("name", "keyword"):
                    raise ScriptError("expected a property name")
                value = ("member", value, ("literal", token.value))
            elif self.accept("["):
                key = self.expression()
                self.expect("]")
                value = ("member", value, key)
            elif allow_calls and self.accept("("):
                value = ("call", value, self.arguments())
            else:
                return value

    def primary(self) -> Node:
        token = self.advance()
        if token.kind in ("number", "string"):
            return ("literal", token.value)
        if token.kind == "regexp":
            return ("regexp", compile_pattern(*token.value))
        if token.kind == "name":
            return ("name", token.value)
        if token.kind == "keyword":
            if token.value in LITERALS:
                return ("literal", LITERALS[token.value])
            if token.value == "this":
                return ("this",)
            if token.value == "function":
                name = self.identifier() if self.peek().kind == "name" else None
                params, body = self.function_rest()
                return ("function", name, params, body)
        if token.kind == "punct":
            if token.value == "(":
                value = self.expression()
                self.expect(")")
                return value
            if token.value == "[":
                return self.array_literal()
            if token.value == "{":
                return self.object_literal()
        raise ScriptError("unexpected token")

    def array_literal(self) -> Node:
        items: list[Node | None] = []
        while not self.accept("]"):
            if self.accept(","):
                items.append(None)
                continue
            items.append(self.assignment())
            if not self.at("]"):
                self.expect(",")
        return ("array", items)

    def property_name(self) -> str | float:
        token = self.advance()
        if token.kind not in ("name", "string", "keyword", "number"):
            raise ScriptError("expected a property name")
        return token.value

    def accessor(self, kind: str) -> Node:
        params, body = self.function_rest()
        if len(params) != ACCESSOR_PARAMS[kind]:
            raise ScriptError(f"a {kind}ter takes {ACCESSOR_PARAMS[kind]} parameters")
        return ("function", None, params, body)

    def object_literal(self) -> Node:
        entries: list[tuple[str, str | float, Node]] = []
        while not self.accept("}"):
            token = self.peek()
            key = self.property_name()
            if (
                token.kind == "name"
                and key in ACCESSOR_PARAMS
                and not (self.at(":") or self.at(",") or self.at("}"))
            ):
                name = self.property_name()
                entries.append((str(key), name, self.accessor(str(key))))
            else:
                self.expect(":")
                entries.append(("init", key, self.assignment()))
            if not self.at("}"):
                self.expect(",")
        return ("object", entries)


def parse(source: str) -> list[Node]:
    return Parser(source).program()
