const fs = require('fs');

console.log("process.argv", process.argv)
const [input, output, typing_amd_module_name] = process.argv.slice(2)

let typing_contents = fs.readFileSync(input, 'utf-8')
if (typing_amd_module_name) {
  const typing_amd_module_pattern = /\/\/\/ <amd-module name="[^"]+" \/>/
  typing_contents = typing_contents.replace(typing_amd_module_pattern, '')
  typing_contents = `/// <amd-module name="${typing_amd_module_name}" />\n${typing_contents}`
}

fs.writeFileSync(
  output,
  typing_contents,
)
