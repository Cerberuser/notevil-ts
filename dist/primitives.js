"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var names = ["Object", "String", "Boolean", "Number", "RegExp", "Date", "Array"];
var immutable = { string: "String", boolean: "Boolean", number: "Number" };
// let primitives = names.map(getGlobal);
var primitives = [Object, String, Boolean, Number, RegExp, Date, Array];
var protos = primitives.map(getProto);
var protoReplacements = {};
var Primitives = /** @class */ (function () {
    function Primitives(context) {
        this.context = context;
        for (var i = 0; i < names.length; i++) {
            if (!this.context[names[i]]) {
                this.context[names[i]] = wrap(primitives[i]);
            }
        }
    }
    Primitives.prototype.replace = function (value) {
        var primIndex = primitives.indexOf(value);
        var protoIndex = protos.indexOf(value);
        if (~primIndex) {
            var name_1 = names[primIndex];
            return this.context[name_1];
        }
        else if (~protoIndex) {
            var name_2 = names[protoIndex];
            return this.context[name_2].prototype;
        }
        else {
            return value;
        }
    };
    Primitives.prototype.getPropertyObject = function (object, property) {
        if (immutable[typeof object]) {
            return this.getPrototypeOf(object);
        }
        return object;
    };
    Primitives.prototype.isPrimitive = function (value) {
        return primitives.indexOf(value) !== -1 || protos.indexOf(value) !== -1;
    };
    Primitives.prototype.getPrototypeOf = function (value) {
        if (value == null) { // handle null and undefined
            return value;
        }
        var immutableType = immutable[typeof value];
        var proto;
        if (immutableType) {
            proto = this.context[immutableType].prototype;
        }
        else {
            proto = Object.getPrototypeOf(value);
        }
        if (!proto || proto === Object.prototype) {
            return null;
        }
        else {
            var replacement = this.replace(proto);
            if (replacement === value) {
                replacement = this.replace(Object.prototype);
            }
            return replacement;
        }
    };
    Primitives.prototype.applyNew = function (func, args) {
        if (func.wrapped) {
            var prim = Object.getPrototypeOf(func);
            var instance = new (Function.prototype.bind.apply(prim, arguments));
            setProto(instance, func.prototype);
            return instance;
        }
        else {
            return new (Function.prototype.bind.apply(func, arguments));
        }
    };
    return Primitives;
}());
exports.Primitives = Primitives;
function getProto(func) {
    return func.prototype;
}
// function getGlobal(str) {
//   return global[str];
// }
function setProto(obj, proto) {
    obj.__proto__ = proto;
}
function wrap(prim) {
    var proto = Object.create(prim.prototype);
    var result = function () {
        if (this instanceof result) {
            prim.apply(this, arguments);
        }
        else {
            var instance = prim.apply(null, arguments);
            setProto(instance, proto);
            return instance;
        }
    };
    setProto(result, prim);
    result.prototype = proto;
    result.wrapped = true;
    return result;
}
