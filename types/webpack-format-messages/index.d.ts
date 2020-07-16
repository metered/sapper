declare module 'webpack-format-messages' {
  import { Stats } from 'webpack'

  export default function (stats: Stats): {
    errors: string[]
    warnings: string[]
  }
}
