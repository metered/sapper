import * as path from 'path';
import * as fs from 'fs';

const loadConfigFile = require('rollup/dist/loadConfigFile');

export async function load_rollup_config(config_path: string) {
  let input = config_path
  try {
    await fs.promises.stat(input)
    input = path.resolve(input)
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err
    }
  }

  const { options, warnings } = await loadConfigFile(input);

  // Flush any config file warnings to stderr
  warnings.flush();

  return options
}

