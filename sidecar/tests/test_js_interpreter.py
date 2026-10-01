import math

import pytest

from vivepdf.ops._js_builtins import parse_int, to_precision
from vivepdf.ops._js_interpreter import Interpreter
from vivepdf.ops._js_lexer import MAX_SOURCE, tokenize
from vivepdf.ops._js_parser import parse
from vivepdf.ops._js_values import (
    UNDEFINED,
    Budget,
    JSThrow,
    NativeFunction,
    ScriptError,
    ScriptLimit,
    number_to_string,
    to_fixed,
    to_number,
    to_string,
)


def _run(source: str, steps: int = 100_000, memory: int = 1 << 24) -> str:
    interpreter = Interpreter()
    interpreter.run(parse(source), Budget(steps, memory))
    return to_string(interpreter.globals.names.get("result"))


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("result = 0.1 + 0.2", "0.30000000000000004"),
        ("result = '5' * '2' + ('5' + 2)", "1052"),
        ("result = [] + {} + [1, [2, 3]]", "[object Object]1,2,3"),
        (
            "result = (null == undefined) + ',' + (null === undefined) + ',' + ('1' == 1)",
            "true,false,true",
        ),
        ("result = 1 / 0 + ' ' + -1 / 0 + ' ' + 0 / 0 + ' ' + 5 % -3", "Infinity -Infinity NaN 2"),
        (
            "result = (-5 >>> 28) + ' ' + (1 << 31) + ' ' + (~5) + ' ' + (6 & 3 | 8 ^ 1)",
            "15 -2147483648 -6 11",
        ),
        ("var x = 5; x *= 2; x -= 1; x /= 3; x %= 2; result = x", "1"),
        ("var i = 1; var j = i++ + ++i; result = i + ':' + j", "3:4"),
        (
            "result = typeof missing + typeof null + typeof 1 + typeof 'x' + typeof [] + typeof"
            " isNaN",
            "undefinedobjectnumberstringobjectfunction",
        ),
        ("function f(n) { return n < 2 ? n : f(n - 1) + f(n - 2) } result = f(15)", "610"),
        (
            "var add = function (a, b) { return a + b + arguments.length }; result = add(1, 2, 3)",
            "6",
        ),
        (
            "var fact = function inner(n) { return n ? n * inner(n - 1) : 1 }; result = fact(5)",
            "120",
        ),
        ("result = hoisted(); function hoisted() { return 'up' }", "up"),
        (
            "var s = 0; for (var i = 0; i < 10; i++) { if (i == 5) continue; if (i == 8) break; s"
            " += i } result = s",
            "23",
        ),
        ("var i = 0; do { i++ } while (i < 5); while (i < 9) i += 2; result = i", "9"),
        (
            "var o = {a: 1, 'b': 2, 3: 'c'}; var k = []; for (var x in o) k.push(x + '=' + o[x]);"
            " result = k.join()",
            "a=1,b=2,3=c",
        ),
        (
            "switch (3) { case 1: result = 'one'; case 3: result = 'three'; case 4: result +="
            " '!'; break; default: result = 'd' }",
            "three!",
        ),
        ("switch ('x') { case 'y': result = 1; break; default: result = 'fallback' }", "fallback"),
        (
            "try { null.x } catch (e) { result = e.name + ':' + (e instanceof TypeError) + ':' +"
            " (e instanceof Error) }",
            "TypeError:true:true",
        ),
        ("try { throw 'raw' } catch (e) { result = e } finally { result += '!' }", "raw!"),
        (
            "var r = (function () { try { return 'try' } finally { result = 'finally-' } })();"
            " result += r",
            "finally-try",
        ),
        (
            "try { try { throw new RangeError('x') } finally { result = 'inner' } } catch (e) {"
            " result += '/' + e.message }",
            "inner/x",
        ),
        (
            "function P(n) { this.n = n } var p = new P(4); result = p.n + ':' + (p instanceof P)"
            " + ':' + (p instanceof Array)",
            "4:true:false",
        ),
        (
            "var a = [3, 1, 10, 2]; a.sort(); result = a.join('-') + ' ' + a.sort(function (x, y)"
            " { return x - y }).join('-')",
            "1-10-2-3 1-2-3-10",
        ),
        (
            "result = [1, 2, 3].map(function (x) { return x * 2 }).filter(function (x) { return x"
            " > 2 }).reduce(function (a, b) { return a + b })",
            "10",
        ),
        (
            "result = [1, 2, 3].some(function (x) { return x > 2 }) + ',' + [1, 2].every(function"
            " (x) { return x > 1 })",
            "true,false",
        ),
        (
            "var a = [1, 2, 3, 4, 5]; var gone = a.splice(1, 2, 'x'); result = a.join() + '/' +"
            " gone.join()",
            "1,x,4,5/2,3",
        ),
        (
            "var a = [1, 2]; a.push(3, 4); a.unshift(0); a.shift(); a.pop(); result ="
            " a.concat([9], 8).reverse().join()",
            "8,9,3,2,1",
        ),
        (
            "var a = []; a[5] = 1; result = a.length + ':' + a + ':' + a.indexOf(1) + ':' + [1,"
            " 2, 1].lastIndexOf(1)",
            "6:,,,,,1:5:2",
        ),
        (
            "var t = new Array(3); t[1] = 'b'; result = t.join('|') + Array.isArray(t) +"
            " Array.isArray('t')",
            "|b|truefalse",
        ),
        (
            "result = 'a,b,,c'.split(',').length + ' ' + 'abc'.split('').join('.') + ' ' +"
            " 'abc'.split().length",
            "4 a.b.c 1",
        ),
        (
            "result = 'Hello'.replace('l', 'L') + ' ' + 'x-y'.replace('-', '[$&]') + ' ' +"
            " 'ab'.replace('b', function (m) { return m.toUpperCase() })",
            "HeLlo x[-]y aB",
        ),
        (
            "result = 'abc'.substring(2, 0) + 'abcdef'.substr(-3, 2) + 'abcdef'.slice(1, -1) +"
            " 'ABC'.toLowerCase()",
            "abdebcdeabc",
        ),
        (
            "result = 'hello'.charAt(1) + 'hello'.charCodeAt(0) + 'hello'.indexOf('l') +"
            " 'hello'.lastIndexOf('l') + '  x '.trim()",
            "e10423x",
        ),
        (
            "result = 'abc'.length + 'abc'[1] + String.fromCharCode(72, 105) + String(12) +"
            " Boolean('')",
            "3bHi12false",
        ),
        (
            "result = parseInt('  42px') + parseFloat('3.5e2abc') + Math.round(-2.5) +"
            " Math.max(1, 5, 3)",
            "395",
        ),
        (
            "result = Number('0x1F') + Number('') + ',' + Number('12abc') + ',' + isNaN('x') +"
            " isFinite('1')",
            "31,NaN,truetrue",
        ),
        (
            "result = Math.floor(-1.5) + Math.ceil(1.2) + Math.abs(-3) + Math.pow(2, 10) +"
            " Math.sqrt(16) + Math.min()",
            "Infinity",
        ),
        (
            "result = Math.pow(2, 10) + ':' + Math.sqrt(-1) + ':' + Math.pow(0, -1) + ':' +"
            " Math.pow(1, Infinity)",
            "1024:NaN:Infinity:NaN",
        ),
        (
            "result = (1.005).toFixed(2) + ' ' + (2.5).toPrecision(1) + ' ' + (255).toString(16)"
            " + ' ' + (0.5).toString(2)",
            "1.00 3 ff 0.1",
        ),
        (
            "result = (123.456).toFixed(1) + ' ' + 0.000001234 + ' ' + 1e21 + ' ' + 123e-20 + ' '"
            " + (-1e-7)",
            "123.5 0.000001234 1e+21 1.23e-18 -1e-7",
        ),
        (
            "var o = {a: 1}; delete o.a; result = ('a' in o) + ',' + o.hasOwnProperty('a') + ','"
            " + Object.keys({x: 1, y: 2})",
            "false,false,x,y",
        ),
        (
            "function sum() { var t = 0; for (var i = 0; i < arguments.length; i++) t +="
            " arguments[i]; return t } result = sum.apply(null, [1, 2, 3]) + sum.call(null, 4)",
            "10",
        ),
        ("var x = 1\nvar y = x\n++y\nresult = x + ',' + y", "1,2"),
        ("function f() { return\n 5 } result = f()", "undefined"),
        ("result = void 0 === undefined ? 'yes' : 'no'", "yes"),
        ("undeclared = 7; result = undeclared", "7"),
    ],
)
def test_script_semantics_follow_javascript(source: str, expected: str) -> None:
    assert _run(source) == expected


def test_a_thrown_value_escapes_the_script() -> None:
    with pytest.raises(JSThrow) as caught:
        _run("throw new RangeError('bad')")
    assert to_string(caught.value.value) == "RangeError: bad"
    with pytest.raises(JSThrow):
        _run("result = missingName + 1")


@pytest.mark.parametrize(
    "source",
    [
        "while (true) {}",
        "for (;;);",
        "try { while (true) {} } catch (e) { result = 'caught' }",
        "function g() { g() } g()",
        "var s = 'x'; while (true) s += s",
        "var a = []; while (true) a.push(new Array(100000))",
        "var a = new Array(100001)",
        "var a = []; a.length = 1e9",
        "var o = {}; for (var i = 0; ; i++) o['k' + i] = i",
        "var a = new Array(90000); while (true) a.indexOf(1)",
        "var p = '%1000d'; while (p.length < 900000) p += p; result = p",
        "result = /(a+)+b/.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')",
        "result = /(x*)*y/.exec(new Array(5000).join('x'))",
        "var p = {}; for (var i = 0; i < 100; i++) p = Object.create(p)",
        "var o = { get x() { return this.x } }; result = o.x",
    ],
)
def test_runaway_scripts_hit_a_limit_that_try_cannot_catch(source: str) -> None:
    with pytest.raises((ScriptLimit, JSThrow)) as caught:
        _run(source)
    if isinstance(caught.value, JSThrow):
        assert to_string(caught.value.value).startswith("RangeError")


def test_deep_nesting_and_huge_sources_are_refused() -> None:
    with pytest.raises(ScriptLimit):
        parse("x = " + "(" * 200 + "1" + ")" * 200)
    with pytest.raises(ScriptLimit):
        parse("if (a) " * 200 + "b()")
    with pytest.raises(ScriptLimit):
        tokenize("x" * (MAX_SOURCE + 1))


@pytest.mark.parametrize(
    "source",
    [
        "result = /(/.test('x')",
        "result = /a/gg",
        "result = /a{2,1}/",
        "var f = (x) => x",
        "var s = `template`",
        "class A {}",
        "var o = { get x(a) { return 1 } }",
        "var o = { set x() {} }",
        "a: a: while (true) {}",
        "while (true) { break nowhere }",
        "x: { continue x }",
        "break",
        "function f() { outer: for (;;) { (function () { break outer })() } }",
        "var s = 'unterminated",
        "/* open comment",
        "var 1x = 2",
        "result = 'bad \\x4'",
        "a +",
        "if (a) { b()",
        "return = 5",
    ],
)
def test_unsupported_or_broken_scripts_are_reported(source: str) -> None:
    with pytest.raises(ScriptError):
        parse(source)


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("result = '1,234.50'.replace(/,/g, '')", "1234.50"),
        ("result = /^(\\d{3})-(\\d{4})$/.exec('555-1234').slice(1).join('|')", "555|1234"),
        ("result = 'a1b22c333'.match(/\\d+/g).join()", "1,22,333"),
        (
            "result = 'Hello World'.search(/o W/i) + ':' + /^b/m.test('a' +"
            " String.fromCharCode(10) + 'b')",
            "4:true",
        ),
        ("result = 'John Smith'.replace(/(\\w+)\\s(\\w+)/, '$2, $1')", "Smith, John"),
        ("result = 'aaa'.replace(/a*?/g, '-')", "-a-a-a-"),
        (
            "result = 'a, b,c'.split(/\\s*,\\s*/).join('|') + ':' + 'abc'.split(/(b)/).length",
            "a|b|c:3",
        ),
        ("result = 'x'.replace(/x/, function (m) { return m.toUpperCase() + '!' })", "X!"),
        ("result = /(a)|(b)/.exec('b')[1] === undefined", "true"),
        ("result = /(?=(a+))a*b\\1/.exec('baaabac')[0]", "aba"),
        ("result = /(a*)b\\1+/.test('baaaac') + ':' + /[^]/.test('')", "true:false"),
        (
            "var r = /o/g; r.exec('foo'); result = r.lastIndex + ':' + r.source + ':' + r",
            "2:o:/o/g",
        ),
        ("result = new RegExp('a+', 'i').test('AA') + ':' + (/a/ instanceof RegExp)", "true:true"),
        (
            "var s = ''; outer: for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) {"
            " if (j == 1) continue outer; if (i == 2) break outer; s += i + '' + j } } result = s",
            "0010",
        ),
        ("var n = 0; a: { n = 1; break a; n = 2 } result = n", "1"),
        ("var n = 0; x: y: while (true) { n++; if (n < 3) continue x; break y } result = n", "3"),
        (
            "function P(n) { this.n = n } P.prototype.twice = function () { return this.n * 2 };"
            " var p = new P(4); result = p.twice() + ':' + (p instanceof P) + ':' + ('twice' in p)"
            " + ':' + p.hasOwnProperty('twice') + ':' + (p.constructor === P)",
            "8:true:true:false:true",
        ),
        (
            "function A() {} A.prototype = { get v() { return this.x * 10 }, set v(z) {"
            " this.x = z } };"
            " var a = new A(); a.v = 3; result = a.v + ':' + a.x",
            "30:3",
        ),
        (
            "var base = { hi: function () { return 'hi ' + this.name } }; var o ="
            " Object.create(base);"
            " o.name = 'Ada'; var k = []; for (var key in o) k.push(key);"
            " result = o.hi() + ':' + k.join() + ':' + (Object.getPrototypeOf(o) === base)",
            "hi Ada:name,hi:true",
        ),
        (
            "var o = { get only() { return 5 } }; o.only = 9; result = o.only + ':' + {"
            " get: 1, set: 2 }.set",
            "5:2",
        ),
    ],
)
def test_regexps_labels_and_prototypes_follow_javascript(source: str, expected: str) -> None:
    assert _run(source) == expected


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            "var d = new Date(2024, 1, 29, 13, 5, 9, 7); result = [d.getFullYear(), d.getMonth(),"
            " d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),"
            " d.getDay()].join()",
            "2024,1,29,13,5,9,7,4",
        ),
        ("result = Date.UTC(2000, 0, 1) + ':' + Date.UTC(99, 11, 31)", "946684800000:946598400000"),
        (
            "result = new Date(Date.UTC(2020, 11, 31, 23, 59, 59, 999)).toISOString()",
            "2020-12-31T23:59:59.999Z",
        ),
        ("result = new Date(0).toUTCString()", "Thu, 01 Jan 1970 00:00:00 GMT"),
        ("result = (new Date(2024, 2, 1, 12) - new Date(2024, 0, 1, 12)) / 864e5", "60"),
        (
            "var d = new Date(2024, 0, 31); d.setMonth(1); result = d.getMonth() + ':' +"
            " d.getDate()",
            "2:2",
        ),
        (
            "var d = new Date(2024, 5, 15); d.setDate(0); result = d.getDate() + '/' +"
            " d.getMonth()",
            "31/4",
        ),
        (
            "result = Date.parse('2024-03-05T10:20:30Z') + ':' + Date.parse('2024-03-05')",
            "1709634030000:1709596800000",
        ),
        (
            "result = new Date('3/5/2024').getDate() + ':' + new Date('Mar 5, 2024"
            " 10:30').getHours()",
            "5:10",
        ),
        (
            "result = isNaN(new Date('nope')) + ':' + new Date(NaN) + ':' + new"
            " Date(8.64e15 + 1).getTime()",
            "true:Invalid Date:NaN",
        ),
        (
            "result = (new Date(2024, 0, 1) < new Date(2024, 0, 2)) + ':' + typeof Date.now()",
            "true:number",
        ),
        (
            "result = new Date(-62198755200000).toISOString() + ':' + new Date(99,"
            " 0).getFullYear()",
            "-000001-01-01T00:00:00.000Z:1999",
        ),
        (
            "var d = new Date(2024, 0, 1); result = d.toString().slice(0, 15) + ':' +"
            " typeof (d + 1)",
            "Mon Jan 01 2024:string",
        ),
        (
            "result = new Date(Date.UTC(2024, 0, 1)).getUTCDay() + ':' + (new Date()"
            " instanceof Date)",
            "1:true",
        ),
    ],
)
def test_dates_follow_javascript(source: str, expected: str) -> None:
    assert _run(source) == expected


def test_date_methods_refuse_other_receivers() -> None:
    with pytest.raises(JSThrow) as caught:
        _run("var d = new Date(0); var o = { t: d.getTime }; o.t()")
    assert to_string(caught.value.value).startswith("TypeError")
    with pytest.raises(JSThrow) as caught:
        _run("new Date(NaN).toISOString()")
    assert to_string(caught.value.value).startswith("RangeError")


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            "result = JSON.stringify({a: [1, 'x', null, true], b: {c: undefined, d: function ()"
            " {}}, e: NaN})",
            '{"a":[1,"x",null,true],"b":{},"e":null}',
        ),
        ("result = JSON.stringify([undefined, function () {}])", "[null,null]"),
        (
            "result = JSON.stringify({a: 1, b: [1, 2]}, null, 2)",
            '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
        ),
        ("result = JSON.stringify([1], null, '--')", "[\n--1\n]"),
        (
            "result = JSON.stringify({a: 1, b: 'x'}, function (k, v) { return typeof v ==="
            " 'number' ? v * 2 : v })",
            '{"a":2,"b":"x"}',
        ),
        ("result = JSON.stringify({a: 1, b: 2, c: 3}, ['c', 'a'])", '{"c":3,"a":1}'),
        (
            "result = JSON.stringify('q\"\\\\' + String.fromCharCode(10, 1))",
            '"q\\"\\\\\\n\\u0001"',
        ),
        (
            "result = JSON.stringify({d: new Date(Date.UTC(2024, 0, 2))})",
            '{"d":"2024-01-02T00:00:00.000Z"}',
        ),
        ("result = JSON.stringify({toJSON: function (key) { return 'k' + key }})", '"k"'),
        ("result = typeof JSON.stringify(undefined)", "undefined"),
        (
            'var o = JSON.parse(\'{"a":[1,2,{"b":"x"}],"c":1.5e2,"d":null}\');'
            " result = o.a[2].b + o.c + o.d + o.a.length",
            "x150null3",
        ),
        (
            'result = JSON.stringify(JSON.parse(\'{"a":1,"b":{"c":2}}\', function (k, v) {'
            " return typeof v === 'number' ? v + 1 : v }))",
            '{"a":2,"b":{"c":3}}',
        ),
        (
            'result = JSON.stringify(JSON.parse(\'{"a":1,"b":2}\', function (k, v) {'
            " return k === 'a' ? undefined : v }))",
            '{"b":2}',
        ),
        (
            "var names = []; var bad = ['{a:1}', '[1,]', 'NaN', '']; for (var i = 0; i < 4;"
            " i++) { try { JSON.parse(bad[i]) } catch (e) { names.push(e.name) } }"
            " result = names.join()",
            "SyntaxError,SyntaxError,SyntaxError,SyntaxError",
        ),
        (
            "var a = {}; a.self = a; try { JSON.stringify(a) } catch (e) { result = e.name }",
            "TypeError",
        ),
        (
            "var keys = []; for (var k in new Error('x')) keys.push(k);"
            " result = keys.length + JSON.stringify(new Error('x'))",
            "0{}",
        ),
        (
            "var o = {}; Object.defineProperty(o, 'x', {value: 1}); o.x = 5; var keys = [];"
            " for (var k in o) keys.push(k);"
            " result = o.x + ':' + keys.length + ':' + delete o.x + ':' + o.x",
            "1:0:false:1",
        ),
        (
            "var o = {n: 2}; Object.defineProperty(o, 'double', {get: function () {"
            " return this.n * 2 }, enumerable: true}); o.n = 5;"
            " result = o.double + ':' + Object.keys(o).join()",
            "10:n,double",
        ),
        (
            "var o = {}; Object.defineProperty(o, 'x', {value: 1, writable: true}); o.x = 2;"
            " try { Object.defineProperty(o, 'x', {enumerable: true}) } catch (e) {"
            " result = e.name + o.x }",
            "TypeError2",
        ),
        (
            "var o = {}; Object.defineProperty(o, 'x', {value: 1, writable: true});"
            " Object.defineProperty(o, 'x', {value: 3}); result = o.x",
            "3",
        ),
        (
            "var d = Object.getOwnPropertyDescriptor({a: 1}, 'a');"
            " result = [d.value, d.writable, d.enumerable, d.configurable].join()",
            "1,true,true,true",
        ),
        (
            "var o = Object.freeze({a: 1, b: {c: 1}}); o.a = 2; o.z = 3; o.b.c = 2; delete o.a;"
            " result = [o.a, o.z, o.b.c, Object.isFrozen(o), Object.isFrozen(o.b),"
            " Object.isSealed(o)].join()",
            "1,,2,true,false,true",
        ),
        (
            "var a = Object.freeze([1, 2]); a[0] = 9; a[5] = 1; try { a.push(3) } catch (e) {"
            " result = e.name + a.join() + a.length }",
            "TypeError1,22",
        ),
        (
            "var o = Object.seal({a: 1}); o.a = 2; o.b = 1; delete o.a;"
            " result = o.a + ':' + o.b + ':' + Object.isExtensible(o)",
            "2:undefined:false",
        ),
        (
            "var o = Object.preventExtensions({a: 1}); o.b = 2; delete o.a;"
            " result = ('a' in o) + ':' + ('b' in o)",
            "false:false",
        ),
        (
            "var o = Object.create({base: 1}, {own: {value: 2, enumerable: true}}); var keys = [];"
            " for (var k in o) keys.push(k); result = keys.join() + ':' + o.base + o.own",
            "own,base:12",
        ),
        (
            "var o = Object.create(null); o.x = 1; var child = Object.create(o);"
            " result = typeof o.hasOwnProperty + ':' + typeof child.toString + ':' + ('x' in o)",
            "undefined:undefined:true",
        ),
        (
            "var o = {a: 1}; Object.defineProperty(o, 'h', {value: 2});"
            " result = Object.getOwnPropertyNames(o).join() + ':' + Object.keys(o).join() + ':'"
            " + Object.getOwnPropertyNames([5]).join() + ':' + o.propertyIsEnumerable('h')",
            "a,h:a:0,length:false",
        ),
        (
            "var o = {a: 1, b: 2}; var c = 10; with (o) { a = a + c; var d = b }"
            " result = o.a + ':' + d + ':' + c",
            "11:2:10",
        ),
        ("var o = {n: 3, f: function () { return this.n }}; with (o) { result = f() }", "3"),
        (
            "var o = {}; try { Object.defineProperty(o, 'x', {get: 1}) } catch (e) {"
            " result = e.name } try { Object.defineProperty(o, 'y', {get: function () {},"
            " value: 1}) } catch (e) { result += e.name }",
            "TypeErrorTypeError",
        ),
    ],
)
def test_json_property_attributes_and_with_follow_javascript(source: str, expected: str) -> None:
    assert _run(source) == expected


@pytest.mark.parametrize(
    "source",
    [
        "with ('text') { result = length }",
        "var a = [1]; Object.defineProperty(a, '0', {value: 2})",
    ],
)
def test_parts_of_the_language_outside_the_subset_are_reported(source: str) -> None:
    with pytest.raises(ScriptError) as caught:
        _run(source)
    assert not isinstance(caught.value, ScriptLimit)


def test_deeply_nested_json_hits_a_limit() -> None:
    with pytest.raises(ScriptLimit):
        _run("var s = ''; for (var i = 0; i < 20000; i++) s += '['; JSON.parse(s)")


def test_host_errors_become_script_errors() -> None:
    interpreter = Interpreter()

    def broken(_this: object, _args: list) -> None:
        raise KeyError("inner")

    interpreter.define("broken", NativeFunction("broken", broken))
    with pytest.raises(ScriptError, match="KeyError"):
        interpreter.run(parse("broken()"), Budget(100, 1000))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1.0, "1"),
        (-0.0, "0"),
        (123456789012345680000.0, "123456789012345680000"),
        (1e21, "1e+21"),
        (0.000001, "0.000001"),
        (1e-7, "1e-7"),
        (1.5e300, "1.5e+300"),
        (math.nan, "NaN"),
        (-math.inf, "-Infinity"),
    ],
)
def test_numbers_print_like_javascript(value: float, expected: str) -> None:
    assert number_to_string(value) == expected


def test_fixed_precision_and_parsing_edges() -> None:
    assert to_fixed(-0.0001, 2) == "-0.00"
    assert to_fixed(1e20, 2) == "100000000000000000000.00"
    assert len(to_fixed(1e20, 100)) == 122
    assert to_fixed(1e21, 2) == "1e+21"
    with pytest.raises(JSThrow):
        to_fixed(1.0, 101)
    assert to_precision(123.456, 2) == "1.2e+2"
    assert to_precision(0.000123, 2) == "0.00012"
    assert to_precision(99.99, 3) == "100"
    assert parse_int("0x1f", UNDEFINED) == 31
    assert parse_int("-12.9", UNDEFINED) == -12
    assert math.isnan(parse_int("z", UNDEFINED))
    assert parse_int("z", 36.0) == 35
    assert to_number(" 12 ") == 12 and math.isnan(to_number("1,5"))
