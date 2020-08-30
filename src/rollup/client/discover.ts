import * as walk from 'acorn-walk'
import { PluginContext } from 'rollup'

export function discover_unconditional_imports(ctx: PluginContext, code: string) {
  const imports: string[] = []
  walk.simple(ctx.parse(code, {}), {
    ImportExpression: (node: any) => imports.push(node.source.value),
  }, walk.make({
    SwitchStatement: (node: any, st, c) => {
      c(node.discriminant, st)
    },
    SwitchCase: (node: any, st, c) => {
      if (node.test) c(node.test, st)
    },
    Function: (node: any, st, c) => {
      if (node.id) c(node.id, st)
      for (let param of node.params)
        c(param, st)
    },
    FunctionExpression: (node: any, st, c) => { },
    ArrowFunctionExpression: (node: any, st, c) => { },
    FunctionDeclaration: (node: any, st, c) => { },
    SequenceExpression: (node: any, st, c) => { },
    ImportExpression: (node: any, st, c) => {
      c(node.source, st)
    },
    MethodDefinition: (node: any, st, c) => {
      if (node.computed) c(node.key, st)
    },
    Property: (node: any, st, c) => {
      if (node.computed) c(node.key, st)
    },
  }))
  return imports
}