import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../..", import.meta.url);
const here = new URL("./", import.meta.url);
const output = fileURLToPath(new URL("dist/thunderbird/", root));
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".mailport-"));
const content = join(staging, "content");
const artifact = join(output, "mailport-preview.xpi");
try {
  await mkdir(content);
  const extensionFiles = ["manifest.json", "schema.json", "background.js", "import.html", "import.css", "import.js"];
  for (const name of extensionFiles) {
    await copyFile(new URL(`extension/${name}`, here), join(content, name));
  }
  const bundledFiles = {
    "browser.js": "packages/sdk/dist/browser.js",
    "AlloVariable.woff2": "node_modules/allo-font/fonts/webfonts/AlloVariable.woff2",
    "Allo-OFL.txt": "apps/vault/licenses/Allo-OFL.txt",
    "PaperMono.woff2": "apps/vault/public/fonts/PaperMono.woff2",
    "PaperMono-OFL.txt": "apps/vault/public/fonts/PaperMono-OFL.txt",
    "LICENSE": "LICENSE",
    "LICENSE-hpke-core.txt": "node_modules/@hpke/core/LICENSE",
    "LICENSE-hpke-common.txt": "node_modules/@hpke/common/LICENSE",
    "LICENSE-zod.txt": "node_modules/zod/LICENSE",
  };
  for (const [name, source] of Object.entries(bundledFiles)) {
    await copyFile(new URL(source, root), join(content, name));
  }
  const provision = await readFile(new URL("provision.js", here), "utf8");
  const experiment = await readFile(new URL("extension/experiment.js", here), "utf8");
  await writeFile(join(content, "api.js"), `${provision}\n${experiment}`);
  const archive = join(staging, "addon.xpi");
  execFileSync("zip", ["-q", archive, ...extensionFiles, ...Object.keys(bundledFiles), "api.js"], { cwd: content });
  await rename(archive, artifact);
  console.log(artifact);
} finally {
  await rm(staging, { recursive: true, force: true });
}
