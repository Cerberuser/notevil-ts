"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var esprima_1 = require("esprima");
var hoister_1 = __importDefault(require("hoister"));
var infinite_checker_1 = require("./infinite-checker");
var primitives_1 = require("./primitives");
var maxIterations = 1000000;
// 'eval' with a controlled environment
function safeEval(src, parentContext) {
    var tree = prepareAst(src);
    var context = Object.create(parentContext || {});
    return finalValue(evaluateAst(tree, context));
}
exports.safeEval = safeEval;
// create a 'Function' constructor for a controlled environment
function FunctionFactory(parentContext) {
    var context = Object.create(parentContext || {});
    // TODO: make this args generic, possibly (to pass into getFunction)?
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var src = args.slice(-1)[0];
        args = args.slice(0, -1);
        if (typeof src === "string") {
            // HACK: esprima doesn't like returns outside functions
            src = esprima_1.parseScript("function a(){" + src + "}").body[0].body;
        }
        var tree = prepareAst(src);
        return getFunction(tree, args, context);
    };
}
exports.FunctionFactory = FunctionFactory;
exports.SafeFunction = FunctionFactory();
// takes an AST or js source and returns an AST
function prepareAst(src) {
    var tree = (typeof src === "string") ? esprima_1.parseScript(src) : src;
    return hoister_1.default(tree);
}
// evaluate an AST in the given context
function evaluateAst(tree, context) {
    var safeFunction = FunctionFactory(context);
    var primitives = new primitives_1.Primitives(context);
    // block scoped context for catch (ex) and 'let'
    var blockContext = context;
    return walk(tree);
    // recursively walk every node in an array
    function walkAll(nodes) {
        var result;
        for (var _i = 0, nodes_1 = nodes; _i < nodes_1.length; _i++) {
            var childNode = nodes_1[_i];
            if (childNode.type === "EmptyStatement") {
                continue;
            }
            result = walk(childNode);
            if (result instanceof ReturnValue) {
                return result;
            }
        }
        return result;
    }
    // recursively evaluate the node of an AST
    function walk(node) {
        if (!node) {
            return;
        }
        switch (node.type) {
            case "Program": {
                return walkAll(node.body);
            }
            case "BlockStatement": {
                enterBlock();
                var result = walkAll(node.body);
                leaveBlock();
                return result;
            }
            case "FunctionDeclaration": {
                var params = node.params.map(getName);
                var value = getFunction(node.body, params, blockContext);
                return context[node.id.name] = value;
            }
            case "FunctionExpression":
            case "ArrowFunctionExpression": {
                var params = node.params.map(getName);
                return getFunction(node.body, params, blockContext);
            }
            case "ReturnStatement": {
                var value = walk(node.argument);
                return new ReturnValue("return", value);
            }
            case "BreakStatement": {
                return new ReturnValue("break");
            }
            case "ContinueStatement": {
                return new ReturnValue("continue");
            }
            case "ExpressionStatement": {
                return walk(node.expression);
            }
            case "AssignmentExpression": {
                return setValue(blockContext, node.left, node.right, node.operator);
            }
            case "UpdateExpression": {
                return setValue(blockContext, node.argument, null, node.operator);
            }
            case "VariableDeclaration":
                node.declarations.forEach(function (declaration) {
                    var target = node.kind === "let" ? blockContext : context;
                    if (declaration.init) {
                        target[declaration.id.name] = walk(declaration.init);
                    }
                    else {
                        target[declaration.id.name] = undefined;
                    }
                });
                break;
            case "SwitchStatement": {
                var defaultHandler = null;
                var matched = false;
                var value = walk(node.discriminant);
                var result = void 0;
                enterBlock();
                var i = 0;
                while (result == null) {
                    if (i < node.cases.length) {
                        if (node.cases[i].test) { // check or fall through
                            matched = matched || (walk(node.cases[i].test) === value);
                        }
                        else if (defaultHandler == null) {
                            defaultHandler = i;
                        }
                        if (matched) {
                            var r = walkAll(node.cases[i].consequent);
                            if (r instanceof ReturnValue) { // break out
                                if (r.type === "break") {
                                    break;
                                }
                                result = r;
                            }
                        }
                        i += 1; // continue
                    }
                    else if (!matched && defaultHandler != null) {
                        // go back and do the default handler
                        i = defaultHandler;
                        matched = true;
                    }
                    else {
                        // nothing we can do
                        break;
                    }
                }
                leaveBlock();
                return result;
            }
            case "IfStatement": {
                if (walk(node.test)) {
                    return walk(node.consequent);
                }
                else if (node.alternate) {
                    return walk(node.alternate);
                }
            }
            case "ForStatement": {
                var infinite = new infinite_checker_1.InfiniteChecker(maxIterations);
                var result = void 0;
                enterBlock(); // allow lets on delarations
                for (walk(node.init); walk(node.test); walk(node.update)) {
                    var r = walk(node.body);
                    // handle early return, continue and break
                    if (r instanceof ReturnValue) {
                        if (r.type === "continue") {
                            continue;
                        }
                        if (r.type === "break") {
                            break;
                        }
                        result = r;
                        break;
                    }
                    infinite.check();
                }
                leaveBlock();
                return result;
            }
            case "ForInStatement": {
                var infinite = new infinite_checker_1.InfiniteChecker(maxIterations);
                var result = void 0;
                var value = walk(node.right);
                var property = node.left;
                var target = context;
                enterBlock();
                if (property.type === "VariableDeclaration") {
                    walk(property);
                    property = property.declarations[0].id;
                    if (property.kind === "let") {
                        target = blockContext;
                    }
                }
                for (var key in value) {
                    if (!value.hasOwnProperty(key)) {
                        continue;
                    }
                    setValue(target, property, { type: "Literal", value: key });
                    var r = walk(node.body);
                    // handle early return, continue and break
                    if (r instanceof ReturnValue) {
                        if (r.type === "continue") {
                            continue;
                        }
                        if (r.type === "break") {
                            break;
                        }
                        result = r;
                        break;
                    }
                    infinite.check();
                }
                leaveBlock();
                return result;
            }
            case "WhileStatement": {
                var infinite = new infinite_checker_1.InfiniteChecker(maxIterations);
                while (walk(node.test)) {
                    walk(node.body);
                    infinite.check();
                }
                break;
            }
            case "TryStatement":
                try {
                    walk(node.block);
                }
                catch (error) {
                    enterBlock();
                    var catchClause = node.handler;
                    if (catchClause) {
                        blockContext[catchClause.param.name] = error;
                        walk(catchClause.body);
                    }
                    leaveBlock();
                }
                finally {
                    if (node.finalizer) {
                        walk(node.finalizer);
                    }
                }
                break;
            case "Literal":
                return node.value;
            case "UnaryExpression": {
                if (node.operator === "delete" && node.argument.type === "MemberExpression") {
                    var arg = node.argument;
                    var parent_1 = walk(arg.object);
                    var prop = arg.computed ? walk(arg.property) : arg.property.name;
                    delete parent_1[prop];
                    return true;
                }
                else {
                    var val = walk(node.argument);
                    switch (node.operator) {
                        case "+":
                            return +val;
                        case "-":
                            return -val;
                        case "~":
                            return ~val;
                        case "!":
                            return !val;
                        case "typeof":
                            return typeof val;
                        default:
                            return unsupportedExpression(node);
                    }
                }
            }
            case "ArrayExpression": {
                var obj = blockContext.Array();
                for (var _i = 0, _a = node.elements; _i < _a.length; _i++) {
                    var element = _a[_i];
                    obj.push(walk(element));
                }
                return obj;
            }
            case "ObjectExpression": {
                var obj = blockContext.Object();
                for (var _b = 0, _c = node.properties; _b < _c.length; _b++) {
                    var prop = _c[_b];
                    var value = (prop.value === null) ? prop.value : walk(prop.value);
                    obj[prop.key.value || prop.key.name] = value;
                }
                return obj;
            }
            case "NewExpression": {
                var args = node.arguments.map(function (arg) {
                    return walk(arg);
                });
                var target = walk(node.callee);
                return primitives.applyNew(target, args);
            }
            case "BinaryExpression": {
                var l = walk(node.left);
                var r = walk(node.right);
                switch (node.operator) {
                    case "==":
                        return l === r;
                    case "===":
                        return l === r;
                    case "!=":
                        // tslint:disable-next-line:triple-equals
                        return l != r;
                    case "!==":
                        return l !== r;
                    case "+":
                        return l + r;
                    case "-":
                        return l - r;
                    case "*":
                        return l * r;
                    case "/":
                        return l / r;
                    case "%":
                        return l % r;
                    case "<":
                        return l < r;
                    case "<=":
                        return l <= r;
                    case ">":
                        return l > r;
                    case ">=":
                        return l >= r;
                    case "|":
                        return l | r;
                    case "&":
                        return l & r;
                    case "^":
                        return l ^ r;
                    case "instanceof":
                        return l instanceof r;
                    default:
                        return unsupportedExpression(node);
                }
            }
            case "LogicalExpression": {
                switch (node.operator) {
                    case "&&":
                        return walk(node.left) && walk(node.right);
                    case "||":
                        return walk(node.left) || walk(node.right);
                    default:
                        return unsupportedExpression(node);
                }
            }
            case "ThisExpression": {
                return blockContext.this;
            }
            case "Identifier": {
                if (node.name === "undefined") {
                    return undefined;
                }
                else if (hasProperty(blockContext, node.name, primitives)) {
                    return finalValue(blockContext[node.name]);
                }
                else {
                    throw new ReferenceError(node.name + " is not defined");
                }
            }
            case "CallExpression": {
                var args = node.arguments.map(function (arg) {
                    return walk(arg);
                });
                var object = null;
                var target = walk(node.callee);
                if (node.callee.type === "MemberExpression") {
                    object = walk(node.callee.object);
                }
                return target.apply(object, args);
            }
            case "MemberExpression": {
                var obj = walk(node.object);
                var prop = void 0;
                if (node.computed) {
                    prop = walk(node.property);
                }
                else {
                    prop = node.property.name;
                }
                obj = primitives.getPropertyObject(obj, prop);
                return checkValue(obj[prop]);
            }
            case "ConditionalExpression": {
                var val = walk(node.test);
                return val ? walk(node.consequent) : walk(node.alternate);
            }
            case "EmptyStatement":
                return;
            default:
                return unsupportedExpression(node);
        }
    }
    // safely retrieve a value
    function checkValue(value) {
        if (value === Function) {
            value = safeFunction;
        }
        return finalValue(value);
    }
    // block scope context control
    function enterBlock() {
        blockContext = Object.create(blockContext);
    }
    function leaveBlock() {
        blockContext = Object.getPrototypeOf(blockContext);
    }
    // set a value in the specified context if allowed
    function setValue(object, left, right, operator) {
        var name = null;
        if (left.type === "Identifier") {
            name = left.name;
            // handle parent context shadowing
            object = objectForKey(object, name, primitives);
        }
        else if (left.type === "MemberExpression") {
            if (left.computed) {
                name = walk(left.property);
            }
            else {
                name = left.property.name;
            }
            object = walk(left.object);
        }
        // stop built in properties from being able to be changed
        if (canSetProperty(object, name, primitives)) {
            switch (operator) {
                case undefined:
                    return object[name] = walk(right);
                case "=":
                    return object[name] = walk(right);
                case "+=":
                    return object[name] += walk(right);
                case "-=":
                    return object[name] -= walk(right);
                case "++":
                    return object[name]++;
                case "--":
                    return object[name]--;
            }
        }
    }
}
// when an unsupported expression is encountered, throw an error
function unsupportedExpression(node) {
    console.error(node);
    var err = new Error("Unsupported expression: " + node.type);
    err.node = node;
    throw err;
}
// walk a provided object's prototypal hierarchy to retrieve an inherited object
function objectForKey(object, key, primitives) {
    var proto = primitives.getPrototypeOf(object);
    if (!proto || hasOwnProperty(object, key)) {
        return object;
    }
    else {
        return objectForKey(proto, key, primitives);
    }
}
function hasProperty(object, key, primitives) {
    var proto = primitives.getPrototypeOf(object);
    var hasOwn = hasOwnProperty(object, key);
    if (object[key] !== undefined) {
        return true;
    }
    else if (!proto || hasOwn) {
        return hasOwn;
    }
    else {
        return hasProperty(proto, key, primitives);
    }
}
function hasOwnProperty(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}
function propertyIsEnumerable(object, key) {
    return Object.prototype.propertyIsEnumerable.call(object, key);
}
// determine if we have write access to a property
function canSetProperty(object, property, primitives) {
    if (property === "__proto__" || primitives.isPrimitive(object)) {
        return false;
    }
    else if (object != null) {
        if (hasOwnProperty(object, property)) {
            if (propertyIsEnumerable(object, property)) {
                return true;
            }
            else {
                return false;
            }
        }
        else {
            return canSetProperty(primitives.getPrototypeOf(object), property, primitives);
        }
    }
    else {
        return true;
    }
}
// generate a function with specified context
function getFunction(body, params, parentContext) {
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var context = Object.create(parentContext);
        if (this === global) {
            context.this = null;
        }
        else {
            context.this = this;
        }
        context.arguments = args;
        args.forEach(function (arg, idx) {
            var param = params[idx];
            if (param) {
                context[param] = arg;
            }
        });
        var result = evaluateAst(body, context);
        if (result instanceof ReturnValue) {
            return result.value;
        }
    };
}
function finalValue(value) {
    if (value instanceof ReturnValue) {
        return value.value;
    }
    return value;
}
// get the name of an identifier
function getName(identifier) {
    return identifier.name;
}
// a ReturnValue struct for differentiating between expression result and return statement
var ReturnValue = /** @class */ (function () {
    function ReturnValue(type, value) {
        this.type = type;
        this.value = value;
    }
    return ReturnValue;
}());
//# sourceMappingURL=index.js.map