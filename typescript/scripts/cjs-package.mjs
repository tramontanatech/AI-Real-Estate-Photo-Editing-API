// Marks dist/cjs as CommonJS so `require("stagerai")` works next to the ESM build.
import { writeFileSync } from "node:fs";
writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), '{ "type": "commonjs" }\n');
