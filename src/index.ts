import {parseScript as parse} from "esprima";
import hoist from "hoister";
import {InfiniteChecker} from "./infinite-checker";
import {Primitives} from "./primitives";

const maxIterations = 1000000;

// 'eval' with a controlled environment
export function safeEval(src, parentContext) {
  const tree = prepareAst(src);
  const context = Object.create(parentContext || {});
  return finalValue(evaluateAst(tree, context));
}

// create a 'Function' constructor for a controlled environment
export function FunctionFactory(parentContext?) {
  const context = Object.create(parentContext || {});
  return function Function() {
    // normalize arguments array
    let args = Array.prototype.slice.call(arguments);
    let src = args.slice(-1)[0];
    args = args.slice(0, -1);
    if (typeof src === 'string') {
      //HACK: esprima doesn't like returns outside functions
      src = (parse('function a(){' + src + '}').body[0] as any).body;
    }
    const tree = prepareAst(src);
    return getFunction(tree, args, context);
  };
}

export const Function = FunctionFactory();

// takes an AST or js source and returns an AST
function prepareAst(src) {
  const tree = (typeof src === 'string') ? parse(src) : src;
  return hoist(tree);
}

// evaluate an AST in the given context
function evaluateAst(tree, context) {

  const safeFunction = FunctionFactory(context);
  const primitives = new Primitives(context);

// block scoped context for catch (ex) and 'let'
  let blockContext = context;

  return walk(tree);

// recursively walk every node in an array
  function walkAll(nodes) {
    let result = undefined;
    for (let i = 0; i < nodes.length; i++) {
      const childNode = nodes[i];
      if (childNode.type === 'EmptyStatement') continue;
      result = walk(childNode);
      if (result instanceof ReturnValue) {
        return result;
      }
    }
    return result;
  }

// recursively evaluate the node of an AST
  function walk(node) {
    if (!node) return;
    switch (node.type) {

      case 'Program': {
        return walkAll(node.body);
      }
      case 'BlockStatement': {
        enterBlock();
        const result = walkAll(node.body);
        leaveBlock();
        return result;
      }
      case 'FunctionDeclaration': {
        const params = node.params.map(getName);
        const value = getFunction(node.body, params, blockContext);
        return context[node.id.name] = value;
      }
      case 'FunctionExpression': {
        const params = node.params.map(getName);
        return getFunction(node.body, params, blockContext);
      }
      case 'ReturnStatement': {
        const value = walk(node.argument);
        return new ReturnValue('return', value);
      }
      case 'BreakStatement': {
        return new ReturnValue('break');
      }
      case 'ContinueStatement': {
        return new ReturnValue('continue');
      }
      case 'ExpressionStatement': {
        return walk(node.expression);
      }
      case 'AssignmentExpression': {
        return setValue(blockContext, node.left, node.right, node.operator);
      }
      case 'UpdateExpression': {
        return setValue(blockContext, node.argument, null, node.operator);
      }
      case 'VariableDeclaration':
        node.declarations.forEach(function (declaration) {
          const target = node.kind === 'let' ? blockContext : context;
          if (declaration.init) {
            target[declaration.id.name] = walk(declaration.init);
          } else {
            target[declaration.id.name] = undefined;
          }
        });
        break;

      case 'SwitchStatement': {
        let defaultHandler = null;
        let matched = false;
        const value = walk(node.discriminant);
        let result = undefined;

        enterBlock();

        let i = 0;
        while (result == null) {
          if (i < node.cases.length) {
            if (node.cases[i].test) { // check or fall through
              matched = matched || (walk(node.cases[i].test) === value);
            } else if (defaultHandler == null) {
              defaultHandler = i;
            }
            if (matched) {
              const r = walkAll(node.cases[i].consequent);
              if (r instanceof ReturnValue) { // break out
                if (r.type == 'break') break;
                result = r;
              }
            }
            i += 1; // continue
          } else if (!matched && defaultHandler != null) {
            // go back and do the default handler
            i = defaultHandler;
            matched = true;
          } else {
            // nothing we can do
            break;
          }
        }

        leaveBlock();
        return result;
      }
      case 'IfStatement': {
        if (walk(node.test)) {
          return walk(node.consequent);
        } else if (node.alternate) {
          return walk(node.alternate);
        }
      }
      case 'ForStatement': {
        const infinite = new InfiniteChecker(maxIterations);
        let result = undefined;

        enterBlock(); // allow lets on delarations
        for (walk(node.init); walk(node.test); walk(node.update)) {
          const r = walk(node.body);

          // handle early return, continue and break
          if (r instanceof ReturnValue) {
            if (r.type == 'continue') continue;
            if (r.type == 'break') break;
            result = r;
            break;
          }

          infinite.check();
        }
        leaveBlock();
        return result;
      }
      case 'ForInStatement': {
        const infinite = new InfiniteChecker(maxIterations);
        let result = undefined;

        const value = walk(node.right);
        let property = node.left;

        let target = context;
        enterBlock();

        if (property.type == 'VariableDeclaration') {
          walk(property);
          property = property.declarations[0].id;
          if (property.kind === 'let') {
            target = blockContext;
          }
        }

        for (let key in value) {
          setValue(target, property, {type: 'Literal', value: key});
          const r = walk(node.body);

          // handle early return, continue and break
          if (r instanceof ReturnValue) {
            if (r.type == 'continue') continue;
            if (r.type == 'break') break;
            result = r;
            break;
          }

          infinite.check();
        }
        leaveBlock();

        return result;
      }
      case 'WhileStatement':
        const infinite = new InfiniteChecker(maxIterations);
        while (walk(node.test)) {
          walk(node.body);
          infinite.check();
        }
        break;
      case 'TryStatement':
        try {
          walk(node.block);
        } catch (error) {
          enterBlock();
          const catchClause = node.handler;
          if (catchClause) {
            blockContext[catchClause.param.name] = error;
            walk(catchClause.body);
          }
          leaveBlock();
        } finally {
          if (node.finalizer) {
            walk(node.finalizer);
          }
        }
        break;
      case 'Literal':
        return node.value;
      case 'UnaryExpression': {
        if (node.operator === 'delete' && node.argument.type === 'MemberExpression') {
          const arg = node.argument;
          const parent = walk(arg.object);
          const prop = arg.computed ? walk(arg.property) : arg.property.name;
          delete parent[prop];
          return true;
        } else {
          const val = walk(node.argument);
          switch (node.operator) {
            case '+':
              return +val;
            case '-':
              return -val;
            case '~':
              return ~val;
            case '!':
              return !val;
            case 'typeof':
              return typeof val;
            default:
              return unsupportedExpression(node);
          }
        }
      }
      case 'ArrayExpression': {
        const obj: Array<any> = blockContext['Array']();
        for (let i = 0; i < node.elements.length; i++) {
          obj.push(walk(node.elements[i]));
        }
        return obj;
      }
      case 'ObjectExpression': {
        const obj: object = blockContext['Object']();
        for (let i = 0; i < node.properties.length; i++) {
          const prop = node.properties[i];
          const value = (prop.value === null) ? prop.value : walk(prop.value);
          obj[prop.key.value || prop.key.name] = value;
        }
        return obj;
      }
      case 'NewExpression': {
        const args = node.arguments.map(function (arg) {
          return walk(arg);
        });
        const target = walk(node.callee);
        return primitives.applyNew(target, args);
      }
      case 'BinaryExpression': {
        const l = walk(node.left);
        const r = walk(node.right);
        switch (node.operator) {
          case '==':
            return l === r;
          case '===':
            return l === r;
          case '!=':
            return l != r;
          case '!==':
            return l !== r;
          case '+':
            return l + r;
          case '-':
            return l - r;
          case '*':
            return l * r;
          case '/':
            return l / r;
          case '%':
            return l % r;
          case '<':
            return l < r;
          case '<=':
            return l <= r;
          case '>':
            return l > r;
          case '>=':
            return l >= r;
          case '|':
            return l | r;
          case '&':
            return l & r;
          case '^':
            return l ^ r;
          case 'instanceof':
            return l instanceof r;
          default:
            return unsupportedExpression(node);
        }
      }
      case 'LogicalExpression': {
        switch (node.operator) {
          case '&&':
            return walk(node.left) && walk(node.right);
          case '||':
            return walk(node.left) || walk(node.right);
          default:
            return unsupportedExpression(node);
        }
      }
      case 'ThisExpression': {
        return blockContext['this'];
      }
      case 'Identifier': {
        if (node.name === 'undefined') {
          return undefined;
        } else if (hasProperty(blockContext, node.name, primitives)) {
          return finalValue(blockContext[node.name]);
        } else {
          throw new ReferenceError(node.name + ' is not defined');
        }
      }
      case 'CallExpression': {
        let args = node.arguments.map(function (arg) {
          return walk(arg);
        });
        let object = null;
        const target = walk(node.callee);

        if (node.callee.type === 'MemberExpression') {
          object = walk(node.callee.object);
        }
        return target.apply(object, args);
      }
      case 'MemberExpression':
        let obj = walk(node.object);
        let prop;
        if (node.computed) {
          prop = walk(node.property);
        } else {
          prop = node.property.name;
        }
        obj = primitives.getPropertyObject(obj, prop);
        return checkValue(obj[prop]);

      case 'ConditionalExpression':
        const val = walk(node.test);
        return val ? walk(node.consequent) : walk(node.alternate);

      case 'EmptyStatement':
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
  function setValue(object, left, right, operator?) {
    let name = null;

    if (left.type === 'Identifier') {
      name = left.name;
      // handle parent context shadowing
      object = objectForKey(object, name, primitives);
    } else if (left.type === 'MemberExpression') {
      if (left.computed) {
        name = walk(left.property);
      } else {
        name = left.property.name;
      }
      object = walk(left.object);
    }

    // stop built in properties from being able to be changed
    if (canSetProperty(object, name, primitives)) {
      switch (operator) {
        case undefined:
          return object[name] = walk(right);
        case '=':
          return object[name] = walk(right);
        case '+=':
          return object[name] += walk(right);
        case '-=':
          return object[name] -= walk(right);
        case '++':
          return object[name]++;
        case '--':
          return object[name]--;
      }
    }

  }

}

// when an unsupported expression is encountered, throw an error
function unsupportedExpression(node) {
  console.error(node);
  const err: Error & { node?: any } = new Error('Unsupported expression: ' + node.type);
  err.node = node;
  throw err;
}

// walk a provided object's prototypal hierarchy to retrieve an inherited object
function objectForKey(object, key, primitives) {
  const proto = primitives.getPrototypeOf(object);
  if (!proto || hasOwnProperty(object, key)) {
    return object;
  } else {
    return objectForKey(proto, key, primitives);
  }
}

function hasProperty(object, key, primitives) {
  const proto = primitives.getPrototypeOf(object);
  const hasOwn = hasOwnProperty(object, key);
  if (object[key] !== undefined) {
    return true;
  } else if (!proto || hasOwn) {
    return hasOwn;
  } else {
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
  if (property === '__proto__' || primitives.isPrimitive(object)) {
    return false;
  } else if (object != null) {

    if (hasOwnProperty(object, property)) {
      if (propertyIsEnumerable(object, property)) {
        return true;
      } else {
        return false;
      }
    } else {
      return canSetProperty(primitives.getPrototypeOf(object), property, primitives);
    }

  } else {
    return true;
  }
}

// generate a function with specified context
function getFunction(body, params, parentContext) {
  return function () {
    const context = Object.create(parentContext);
    // TODO: how to check for it?..
    // if (this == global) {
    //     context['this'] = null;
    // } else {
    context['this'] = this;
    // }
    // normalize arguments array
    const args = Array.prototype.slice.call(arguments);
    context['arguments'] = arguments;
    args.forEach(function (arg, idx) {
      const param = params[idx];
      if (param) {
        context[param] = arg;
      }
    });
    const result = evaluateAst(body, context);

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
class ReturnValue {
  constructor(public type, public value?) {
  }
}
