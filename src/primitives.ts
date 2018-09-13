const names = ["Object", "String", "Boolean", "Number", "RegExp", "Date", "Array"];
const immutable = {string: "String", boolean: "Boolean", number: "Number" };

// let primitives = names.map(getGlobal);
const primitives = [Object, String, Boolean, Number, RegExp, Date, Array];
const protos = primitives.map(getProto);

// const protoReplacements = {};

export class Primitives {

    public context: object;

    constructor(context) {
        this.context = context;
        for (let i = 0; i < names.length; i++) {
            if (!this.context[names[i]]) {
                this.context[names[i]] = wrap(primitives[i]);
            }
        }
    }

    public replace(value) {
        const primIndex = primitives.indexOf(value);
        const protoIndex = protos.indexOf(value);

        if (~primIndex) {
            const name = names[primIndex];
            return this.context[name];
        } else if (~protoIndex) {
            const name = names[protoIndex];
            return this.context[name].prototype;
        } else {
            return value;
        }
    }

    public getPropertyObject(object, property) {
        if (immutable[typeof object]) {
            return this.getPrototypeOf(object);
        }
        return object;
    }

    public isPrimitive(value) {
        return primitives.indexOf(value) !== -1 || protos.indexOf(value) !== -1;
    }

    public getPrototypeOf(value) {
        if (value == null) { // handle null and undefined
            return value;
        }

        const immutableType = immutable[typeof value];
        let proto;
        if (immutableType) {
            proto = this.context[immutableType].prototype;
        } else {
            proto = Object.getPrototypeOf(value);
        }

        if (!proto || proto === Object.prototype) {
            return null;
        } else {
            let replacement = this.replace(proto);
            if (replacement === value) {
                replacement = this.replace(Object.prototype);
            }
            return replacement;
        }
    }

    public applyNew(func, args) {
        if (func.wrapped) {
            const prim = Object.getPrototypeOf(func);
            const instance = new (Function.prototype.bind.apply(prim, arguments));
            setProto(instance, func.prototype);
            return instance;
        } else {
            return new (Function.prototype.bind.apply(func, arguments));
        }
    }
}

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
  const proto = Object.create(prim.prototype);

  const result: any = function() {
    if (this instanceof result) {
      prim.apply(this, arguments);
    } else {
      const instance = prim.apply(null, arguments);
      setProto(instance, proto);
      return instance;
    }
  };
  setProto(result, prim);
  result.prototype = proto;
  result.wrapped = true;
  return result;
}
