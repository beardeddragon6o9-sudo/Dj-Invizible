import { readdirSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) :
      (e.name.endsWith(".js") ? [join(dir, e.name)] : []));
}

const files = walk("api");
let ok = 0, fail = 0;

for (const f of files) {
  try {
    // cache-bust so repeated runs don’t reuse old modules
    const url = pathToFileURL(f).href + "?t=" + Date.now();
    await import(url);
    console.log("OK   ", f);
    ok++;
  } catch (e) {
    console.log("FAIL ", f);
    console.log(e.message);
    fail++;
  }
}
console.log("Summary ok=", ok, "fail=", fail);
