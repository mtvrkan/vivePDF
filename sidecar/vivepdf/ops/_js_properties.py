from typing import TYPE_CHECKING, Any

from vivepdf.ops._js_values import (
    FIXED,
    HIDDEN,
    READ_ONLY,
    UNDEFINED,
    Accessor,
    JSArray,
    JSFunction,
    JSObject,
    NativeFunction,
    ScriptError,
    array_index,
    same_value,
    throw_error,
    to_boolean,
)

if TYPE_CHECKING:
    from vivepdf.ops._js_interpreter import Interpreter

DESCRIPTOR_FIELDS = ("enumerable", "configurable", "value", "writable", "get", "set")
ACCESSOR_FIELDS = frozenset({"get", "set"})
DATA_FIELDS = frozenset({"value", "writable"})
ARRAY_MUTATORS = frozenset({"push", "pop", "shift", "unshift", "splice", "reverse", "sort"})


def _callable(value: Any) -> bool:
    return isinstance(value, JSFunction | NativeFunction)


def target_object(value: Any, action: str) -> JSObject:
    if not isinstance(value, JSObject):
        raise throw_error("TypeError", f"Object.{action} called on a non-object")
    return value


class Properties:
    def __init__(self, interpreter: "Interpreter") -> None:
        self.interpreter = interpreter

    def descriptor(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, JSObject):
            raise throw_error("TypeError", "property description must be an object")
        fields = {
            field: self.interpreter.get_member(value, field)
            for field in DESCRIPTOR_FIELDS
            if value.has_property(field)
        }
        for field in ACCESSOR_FIELDS & fields.keys():
            if fields[field] is not UNDEFINED and not _callable(fields[field]):
                raise throw_error("TypeError", f"{field}ter must be a function")
        if fields.keys() & ACCESSOR_FIELDS and fields.keys() & DATA_FIELDS:
            raise throw_error("TypeError", "a property cannot have both accessors and a value")
        return fields

    def define(self, target: JSObject, key: str, fields: dict[str, Any]) -> None:
        if isinstance(target, JSArray) and (key == "length" or array_index(key) is not None):
            raise ScriptError("defining array elements is not supported")
        accessor = bool(fields.keys() & ACCESSOR_FIELDS)
        if not target.has(key):
            if not target.extensible:
                raise throw_error("TypeError", f"cannot define property {key!r}")
            flags = (
                (0 if to_boolean(fields.get("enumerable", False)) else HIDDEN)
                | (0 if to_boolean(fields.get("configurable", False)) else FIXED)
                | (0 if accessor or to_boolean(fields.get("writable", False)) else READ_ONLY)
            )
            target.put(
                key, self._stored(None, fields) if accessor else fields.get("value", UNDEFINED)
            )
            target.set_flags(key, flags)
            return
        current = target.get(key)
        flags = target.flags(key)
        was_accessor = isinstance(current, Accessor)
        changes_kind = (accessor and not was_accessor) or (
            not accessor and was_accessor and bool(fields.keys() & DATA_FIELDS)
        )
        if flags & FIXED:
            self._check_fixed(key, fields, flags, current, was_accessor, changes_kind)
        if "enumerable" in fields:
            flags = flags & ~HIDDEN if to_boolean(fields["enumerable"]) else flags | HIDDEN
        if "configurable" in fields and to_boolean(fields["configurable"]):
            flags &= ~FIXED
        elif "configurable" in fields:
            flags |= FIXED
        if accessor:
            target.put(key, self._stored(None if changes_kind else current, fields))
            flags &= ~READ_ONLY
        elif changes_kind or not was_accessor:
            if changes_kind:
                flags |= READ_ONLY
            if "writable" in fields:
                flags = flags & ~READ_ONLY if to_boolean(fields["writable"]) else flags | READ_ONLY
            target.put(key, fields.get("value", UNDEFINED if changes_kind else current))
        target.set_flags(key, flags)

    def _check_fixed(
        self,
        key: str,
        fields: dict[str, Any],
        flags: int,
        current: Any,
        was_accessor: bool,
        changes_kind: bool,
    ) -> None:
        refused = (
            to_boolean(fields.get("configurable", False))
            or ("enumerable" in fields and to_boolean(fields["enumerable"]) == bool(flags & HIDDEN))
            or changes_kind
        )
        if not refused and was_accessor:
            refused = any(
                field in fields
                and not same_value(fields[field], getattr(current, f"{field}ter") or UNDEFINED)
                for field in ("get", "set")
            )
        elif not refused and flags & READ_ONLY:
            refused = to_boolean(fields.get("writable", False)) or (
                "value" in fields and not same_value(fields["value"], current)
            )
        if refused:
            raise throw_error("TypeError", f"cannot redefine property {key!r}")

    def _stored(self, current: Any, fields: dict[str, Any]) -> Accessor:
        accessor = Accessor()
        if isinstance(current, Accessor):
            accessor.getter, accessor.setter = current.getter, current.setter
        if "get" in fields:
            accessor.getter = None if fields["get"] is UNDEFINED else fields["get"]
        if "set" in fields:
            accessor.setter = None if fields["set"] is UNDEFINED else fields["set"]
        return accessor

    def define_all(self, target: JSObject, properties: Any) -> None:
        if not isinstance(properties, JSObject):
            raise throw_error("TypeError", "property descriptions must be an object")
        keys = properties.keys()
        described = [
            (key, self.descriptor(self.interpreter.get_member(properties, key))) for key in keys
        ]
        for key, fields in described:
            self.define(target, key, fields)

    def own_descriptor(self, target: JSObject, key: str) -> Any:
        if not target.has(key):
            return UNDEFINED
        flags = target.flags(key)
        fixed = isinstance(target, JSArray) and key == "length"
        result = JSObject(
            {
                "enumerable": not (flags & HIDDEN or fixed),
                "configurable": not (flags & FIXED or fixed),
            }
        )
        value = target.get(key)
        if isinstance(value, Accessor):
            result.put("get", UNDEFINED if value.getter is None else value.getter)
            result.put("set", UNDEFINED if value.setter is None else value.setter)
        else:
            result.put("value", value)
            result.put("writable", not flags & READ_ONLY)
        return result

    def lock(self, target: JSObject, frozen: bool) -> JSObject:
        keys = target.own_keys()
        self.interpreter.builtins.spend(len(keys))
        target.extensible = False
        for key in keys:
            flags = target.flags(key) | FIXED
            if frozen and not isinstance(target.get(key), Accessor):
                flags |= READ_ONLY
            target.set_flags(key, flags)
        return target

    def locked(self, target: JSObject, frozen: bool) -> bool:
        if target.extensible:
            return False
        for key in target.own_keys():
            flags = target.flags(key)
            if isinstance(target, JSArray) and key == "length":
                flags |= FIXED
            if not flags & FIXED:
                return False
            if frozen and not flags & READ_ONLY and not isinstance(target.get(key), Accessor):
                return False
        return True

    def writable(self, subject: JSObject, key: str) -> bool:
        holder = subject.owner(key)
        if holder is not None and holder.flags(key) & READ_ONLY:
            return False
        return holder is subject or subject.extensible
