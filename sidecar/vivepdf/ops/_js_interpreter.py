from collections.abc import Callable
from typing import Any

from vivepdf.ops._js_builtins import Builtins
from vivepdf.ops._js_parser import Node
from vivepdf.ops._js_regexp import RegExpObject
from vivepdf.ops._js_values import (
    ACTIVE_BUDGET,
    SLOT_COST,
    UNDEFINED,
    Accessor,
    Budget,
    JSArray,
    JSFunction,
    JSObject,
    JSThrow,
    NativeFunction,
    ScriptError,
    ScriptLimit,
    allocate,
    binary_operation,
    property_key,
    strict_equals,
    throw_error,
    to_boolean,
    to_int32,
    to_number,
    type_of,
)

MAX_CALL_DEPTH = 32
Completion = tuple | None
BREAK = ("break",)
CONTINUE = ("continue",)


class Scope:
    __slots__ = ("names", "parent")

    def __init__(self, parent: "Scope | None" = None) -> None:
        self.names: dict[str, Any] = {}
        self.parent = parent

    def find(self, name: str) -> "Scope | None":
        scope: Scope | None = self
        while scope is not None:
            if name in scope.names:
                return scope
            scope = scope.parent
        return None


class _ObjectNames:
    __slots__ = ("interpreter", "subject")

    def __init__(self, interpreter: "Interpreter", subject: JSObject) -> None:
        self.interpreter = interpreter
        self.subject = subject

    def __contains__(self, name: str) -> bool:
        return self.subject.has_property(name)

    def __getitem__(self, name: str) -> Any:
        return self.interpreter.get_member(self.subject, name)

    def __setitem__(self, name: str, value: Any) -> None:
        self.interpreter.put_member(self.subject, name, value)


class ObjectScope(Scope):
    __slots__ = ("subject",)

    def __init__(self, interpreter: "Interpreter", subject: JSObject, parent: Scope) -> None:
        super().__init__(parent)
        self.names = _ObjectNames(interpreter, subject)
        self.subject = subject


class Interpreter:
    def __init__(self) -> None:
        self.globals = Scope()
        self.budget = Budget(0, 0)
        self.calls = 0
        self.hoisted: dict[int, tuple[list[str], list[Node]]] = {}
        self.programs: list[list[Node]] = []
        self.builtins = Builtins(self)
        self.globals.names.update(self.builtins.globals())
        self.globals.names["this"] = UNDEFINED
        self.statements: dict[str, Callable[[Node, Scope], Completion]] = {
            "var": self._var,
            "function_declaration": self._nothing,
            "empty": self._nothing,
            "return": self._return,
            "if": self._if,
            "for": self._for,
            "for_in": self._for_in,
            "while": self._while,
            "do": self._do,
            "break": lambda node, _scope: BREAK if node[1] is None else node,
            "continue": lambda node, _scope: CONTINUE if node[1] is None else node,
            "labelled": self._labelled,
            "block": lambda node, scope: self.execute_list(node[1], scope),
            "expression": self._expression_statement,
            "try": self._try,
            "throw": self._throw,
            "switch": self._switch,
            "with": self._with,
        }
        self.expressions: dict[str, Callable[[Node, Scope], Any]] = {
            "literal": lambda node, _scope: node[1],
            "regexp": lambda node, _scope: RegExpObject(node[1]),
            "name": self._name,
            "this": lambda _node, scope: self._name(("name", "this"), scope),
            "array": self._array,
            "object": self._object,
            "function": self._function,
            "member": self._member,
            "call": self._call,
            "new": self._new,
            "unary": self._unary,
            "update": self._update,
            "binary": self._binary,
            "logical": self._logical,
            "conditional": self._conditional,
            "assign": self._assign,
            "sequence": self._sequence,
        }

    def define(self, name: str, value: Any) -> None:
        self.globals.names[name] = value

    def run(self, program: list[Node], budget: Budget, isolated: bool = False) -> None:
        self.programs.append(program)
        scope = Scope(self.globals) if isolated else self.globals
        token = ACTIVE_BUDGET.set(budget)
        self.budget = budget
        self.calls = 0
        try:
            self.hoist(program, scope)
            self.execute_list(program, scope)
        except (ScriptError, JSThrow):
            raise
        except RecursionError as error:
            raise ScriptLimit("script nested too deeply") from error
        except Exception as error:
            raise ScriptError(f"script failed: {type(error).__name__}") from error
        finally:
            ACTIVE_BUDGET.reset(token)

    def hoist(self, body: list[Node], scope: Scope) -> None:
        cached = self.hoisted.get(id(body))
        if cached is None:
            names: list[str] = []
            functions: list[Node] = []
            for node in body:
                _collect(node, names, functions)
            cached = (names, functions)
            self.hoisted[id(body)] = cached
        names, functions = cached
        for name in names:
            scope.names.setdefault(name, UNDEFINED)
        for node in functions:
            scope.names[node[1]] = JSFunction(node[1], node[2], node[3], scope)

    def execute_list(self, body: list[Node], scope: Scope) -> Completion:
        for node in body:
            completion = self.execute(node, scope)
            if completion is not None:
                return completion
        return None

    def execute(self, node: Node, scope: Scope) -> Completion:
        self.budget.step()
        return self.statements[node[0]](node, scope)

    def evaluate(self, node: Node, scope: Scope) -> Any:
        return self.expressions[node[0]](node, scope)

    def _nothing(self, _node: Node, _scope: Scope) -> Completion:
        return None

    def _var(self, node: Node, scope: Scope) -> Completion:
        for name, initial in node[1]:
            if initial is not None:
                self.assign_name(name, self.evaluate(initial, scope), scope)
        return None

    def _return(self, node: Node, scope: Scope) -> Completion:
        return ("return", UNDEFINED if node[1] is None else self.evaluate(node[1], scope))

    def _if(self, node: Node, scope: Scope) -> Completion:
        if to_boolean(self.evaluate(node[1], scope)):
            return self.execute(node[2], scope)
        return None if node[3] is None else self.execute(node[3], scope)

    def _loop_body(
        self, body: Node, scope: Scope, labels: tuple[str, ...] = ()
    ) -> tuple[bool, Completion]:
        self.budget.step()
        completion = self.execute(body, scope)
        if completion is None or completion is CONTINUE:
            return False, None
        if completion is BREAK:
            return True, None
        if completion[0] == "continue" and completion[1] in labels:
            return False, None
        return True, completion

    def _labelled(self, node: Node, scope: Scope) -> Completion:
        labels, body = tuple(node[1]), node[2]
        if body[0] in LOOPS:
            self.budget.step()
            completion = LOOPS[body[0]](self, body, scope, labels)
        else:
            completion = self.execute(body, scope)
        if completion is not None and completion[0] == "break" and completion[1] in labels:
            return None
        return completion

    def _for(self, node: Node, scope: Scope, labels: tuple[str, ...] = ()) -> Completion:
        _, initial, test, update, body = node
        if initial is not None:
            self.execute(initial, scope)
        while test is None or to_boolean(self.evaluate(test, scope)):
            stop, completion = self._loop_body(body, scope, labels)
            if stop:
                return completion
            if update is not None:
                self.evaluate(update, scope)
        return None

    def _for_in(self, node: Node, scope: Scope, labels: tuple[str, ...] = ()) -> Completion:
        _, _declaration, target, subject_node, body = node
        subject = self.evaluate(subject_node, scope)
        if isinstance(subject, JSObject):
            keys = subject.all_keys()
        elif isinstance(subject, str):
            keys = [str(index) for index in range(len(subject))]
        else:
            keys = []
        allocate(len(keys) * SLOT_COST)
        for key in keys:
            if isinstance(subject, JSObject) and not subject.has_property(key):
                continue
            self.store(target, key, scope)
            stop, completion = self._loop_body(body, scope, labels)
            if stop:
                return completion
        return None

    def _while(self, node: Node, scope: Scope, labels: tuple[str, ...] = ()) -> Completion:
        while to_boolean(self.evaluate(node[1], scope)):
            stop, completion = self._loop_body(node[2], scope, labels)
            if stop:
                return completion
        return None

    def _do(self, node: Node, scope: Scope, labels: tuple[str, ...] = ()) -> Completion:
        while True:
            stop, completion = self._loop_body(node[1], scope, labels)
            if stop:
                return completion
            if not to_boolean(self.evaluate(node[2], scope)):
                return None

    def _expression_statement(self, node: Node, scope: Scope) -> Completion:
        self.evaluate(node[1], scope)
        return None

    def _try(self, node: Node, scope: Scope) -> Completion:
        _, body, name, handler, final = node
        pending: JSThrow | None = None
        completion: Completion = None
        try:
            completion = self.execute_list(body, scope)
        except JSThrow as error:
            if handler is None:
                pending = error
            else:
                catch_scope = Scope(scope)
                catch_scope.names[name] = error.value
                try:
                    completion = self.execute_list(handler, catch_scope)
                except JSThrow as again:
                    pending = again
        if final is not None:
            final_completion = self.execute_list(final, scope)
            if final_completion is not None:
                return final_completion
        if pending is not None:
            raise pending
        return completion

    def _throw(self, node: Node, scope: Scope) -> Completion:
        raise JSThrow(self.evaluate(node[1], scope))

    def _switch(self, node: Node, scope: Scope) -> Completion:
        _, subject_node, cases = node
        subject = self.evaluate(subject_node, scope)
        start = None
        for index, (test, _body) in enumerate(cases):
            if test is not None and strict_equals(subject, self.evaluate(test, scope)):
                start = index
                break
        if start is None:
            start = next((index for index, case in enumerate(cases) if case[0] is None), None)
        if start is None:
            return None
        for _test, body in cases[start:]:
            completion = self.execute_list(body, scope)
            if completion is BREAK:
                return None
            if completion is not None:
                return completion
        return None

    def _with(self, node: Node, scope: Scope) -> Completion:
        subject = self.evaluate(node[1], scope)
        if subject is None or subject is UNDEFINED:
            raise throw_error("TypeError", f"with needs an object, not {type_of(subject)}")
        if not isinstance(subject, JSObject):
            raise ScriptError("with on a primitive value is not supported")
        return self.execute(node[2], ObjectScope(self, subject, scope))

    def _name(self, node: Node, scope: Scope) -> Any:
        found = scope.find(node[1])
        if found is None:
            raise throw_error("ReferenceError", f"{node[1]} is not defined")
        return found.names[node[1]]

    def _array(self, node: Node, scope: Scope) -> Any:
        items = [UNDEFINED if item is None else self.evaluate(item, scope) for item in node[1]]
        return JSArray(items)

    def _object(self, node: Node, scope: Scope) -> Any:
        result = JSObject()
        for kind, key, value in node[1]:
            name = property_key(key)
            if kind == "init":
                result.put(name, self.evaluate(value, scope))
                continue
            accessor = result.properties.get(name)
            if not isinstance(accessor, Accessor):
                accessor = Accessor()
                result.put(name, accessor)
            if kind == "get":
                accessor.getter = self.evaluate(value, scope)
            else:
                accessor.setter = self.evaluate(value, scope)
        return result

    def _function(self, node: Node, scope: Scope) -> Any:
        _, name, params, body = node
        if name is None:
            return JSFunction(None, params, body, scope)
        inner = Scope(scope)
        function = JSFunction(name, params, body, inner)
        inner.names[name] = function
        return function

    def _member(self, node: Node, scope: Scope) -> Any:
        subject = self.evaluate(node[1], scope)
        return self.get_member(subject, property_key(self.evaluate(node[2], scope)))

    def get_member(self, subject: Any, key: str) -> Any:
        if subject is None or subject is UNDEFINED:
            raise throw_error("TypeError", f"cannot read property {key!r} of {type_of(subject)}")
        if isinstance(subject, JSObject):
            value = subject.get(key)
            if value is UNDEFINED and not subject.has(key) and subject.proto is not None:
                holder = subject.owner(key)
                value = UNDEFINED if holder is None else holder.get(key)
            if isinstance(value, Accessor):
                return UNDEFINED if value.getter is None else self.call(value.getter, subject, [])
            if value is not UNDEFINED:
                return value
        return self.builtins.prototype(subject, key)

    def put_member(self, subject: Any, key: str, value: Any) -> None:
        if subject is None or subject is UNDEFINED:
            raise throw_error("TypeError", f"cannot set property {key!r} of {type_of(subject)}")
        if isinstance(subject, JSObject):
            holder = subject.owner(key)
            accessor = None if holder is None else holder.properties.get(key)
            if isinstance(accessor, Accessor):
                if accessor.setter is not None:
                    self.call(accessor.setter, subject, [value])
                return
            if self.builtins.properties.writable(subject, key):
                subject.put(key, value)

    def _arguments(self, nodes: list[Node], scope: Scope) -> list[Any]:
        return [self.evaluate(node, scope) for node in nodes]

    def _call(self, node: Node, scope: Scope) -> Any:
        callee = node[1]
        if callee[0] == "member":
            this = self.evaluate(callee[1], scope)
            function = self.get_member(this, property_key(self.evaluate(callee[2], scope)))
        else:
            this = UNDEFINED
            if callee[0] == "name":
                found = scope.find(callee[1])
                if isinstance(found, ObjectScope):
                    this = found.subject
            function = self.evaluate(callee, scope)
        return self.call(function, this, self._arguments(node[2], scope))

    def call(self, function: Any, this: Any, args: list[Any]) -> Any:
        self.budget.step()
        if isinstance(function, NativeFunction):
            return function.call(this, args)
        if not isinstance(function, JSFunction):
            raise throw_error("TypeError", "not a function")
        self.calls += 1
        if self.calls > MAX_CALL_DEPTH:
            raise ScriptLimit("too much recursion")
        try:
            scope = Scope(function.scope)
            names = scope.names
            names["this"] = (
                self.globals.names["this"] if this is None or this is UNDEFINED else this
            )
            for index, name in enumerate(function.params):
                names[name] = args[index] if index < len(args) else UNDEFINED
            names["arguments"] = JSArray(args)
            self.hoist(function.body, scope)
            completion = self.execute_list(function.body, scope)
        finally:
            self.calls -= 1
        if completion is not None and completion[0] == "return":
            return completion[1]
        return UNDEFINED

    def _new(self, node: Node, scope: Scope) -> Any:
        constructor = self.evaluate(node[1], scope)
        args = self._arguments(node[2], scope)
        self.budget.step()
        if isinstance(constructor, NativeFunction) and constructor.construct is not None:
            return constructor.construct(args)
        if not isinstance(constructor, JSFunction):
            raise throw_error("TypeError", "not a constructor")
        prototype = constructor.get("prototype")
        instance = JSObject(proto=prototype if isinstance(prototype, JSObject) else None)
        result = self.call(constructor, instance, args)
        return result if isinstance(result, JSObject) else instance

    def _unary(self, node: Node, scope: Scope) -> Any:
        _, operator, operand = node
        if operator == "typeof":
            if operand[0] == "name" and scope.find(operand[1]) is None:
                return "undefined"
            return type_of(self.evaluate(operand, scope))
        if operator == "delete":
            if operand[0] != "member":
                return True
            subject = self.evaluate(operand[1], scope)
            key = property_key(self.evaluate(operand[2], scope))
            return subject.remove(key) if isinstance(subject, JSObject) else True
        value = self.evaluate(operand, scope)
        if operator == "void":
            return UNDEFINED
        if operator == "!":
            return not to_boolean(value)
        if operator == "-":
            return -to_number(value)
        if operator == "+":
            return to_number(value)
        return float(~to_int32(value))

    def reference(self, target: Node, scope: Scope) -> tuple[Any, str]:
        if target[0] == "name":
            return scope, target[1]
        subject = self.evaluate(target[1], scope)
        return subject, property_key(self.evaluate(target[2], scope))

    def read(self, holder: Any, key: str, scope: Scope) -> Any:
        if holder is scope:
            return self._name(("name", key), scope)
        return self.get_member(holder, key)

    def write(self, holder: Any, key: str, value: Any, scope: Scope) -> None:
        if holder is scope:
            self.assign_name(key, value, scope)
        else:
            self.put_member(holder, key, value)

    def store(self, target: Node, value: Any, scope: Scope) -> None:
        holder, key = self.reference(target, scope)
        self.write(holder, key, value, scope)

    def assign_name(self, name: str, value: Any, scope: Scope) -> None:
        found = scope.find(name) or self.globals
        found.names[name] = value

    def _update(self, node: Node, scope: Scope) -> Any:
        _, operator, prefix, target = node
        holder, key = self.reference(target, scope)
        old = to_number(self.read(holder, key, scope))
        new = old + 1 if operator == "++" else old - 1
        self.write(holder, key, new, scope)
        return new if prefix else old

    def _binary(self, node: Node, scope: Scope) -> Any:
        _, operator, left_node, right_node = node
        left = self.evaluate(left_node, scope)
        right = self.evaluate(right_node, scope)
        if operator == "instanceof":
            return self.builtins.instance_of(left, right)
        return binary_operation(operator, left, right)

    def _logical(self, node: Node, scope: Scope) -> Any:
        _, operator, left_node, right_node = node
        left = self.evaluate(left_node, scope)
        if to_boolean(left) == (operator == "||"):
            return left
        return self.evaluate(right_node, scope)

    def _conditional(self, node: Node, scope: Scope) -> Any:
        _, test, consequent, alternate = node
        chosen = consequent if to_boolean(self.evaluate(test, scope)) else alternate
        return self.evaluate(chosen, scope)

    def _assign(self, node: Node, scope: Scope) -> Any:
        _, operator, target, value_node = node
        holder, key = self.reference(target, scope)
        if operator == "=":
            value = self.evaluate(value_node, scope)
        else:
            current = self.read(holder, key, scope)
            value = binary_operation(operator[:-1], current, self.evaluate(value_node, scope))
        self.write(holder, key, value, scope)
        return value

    def _sequence(self, node: Node, scope: Scope) -> Any:
        value = UNDEFINED
        for item in node[1]:
            value = self.evaluate(item, scope)
        return value


def _collect(node: Node, names: list[str], functions: list[Node]) -> None:
    kind = node[0]
    if kind == "var":
        names.extend(name for name, _value in node[1])
    elif kind == "function_declaration":
        functions.append(node)
    elif kind == "block":
        for child in node[1]:
            _collect(child, names, functions)
    elif kind == "if":
        _collect(node[2], names, functions)
        if node[3] is not None:
            _collect(node[3], names, functions)
    elif kind in ("for", "for_in"):
        if node[1] is not None:
            _collect(node[1], names, functions)
        _collect(node[4], names, functions)
    elif kind in ("while", "do"):
        _collect(node[2] if kind == "while" else node[1], names, functions)
    elif kind == "try":
        for block in (node[1], node[3], node[4]):
            for child in block or ():
                _collect(child, names, functions)
    elif kind == "switch":
        for _test, body in node[2]:
            for child in body:
                _collect(child, names, functions)
    elif kind in ("labelled", "with"):
        _collect(node[2], names, functions)


LOOPS: dict[str, Callable[..., Completion]] = {
    "for": Interpreter._for,
    "for_in": Interpreter._for_in,
    "while": Interpreter._while,
    "do": Interpreter._do,
}
