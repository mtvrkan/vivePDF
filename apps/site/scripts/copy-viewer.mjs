import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../embed/dist/", import.meta.url));
const target = fileURLToPath(new URL("../public/viewer/", import.meta.url));

if (!existsSync(`${source}vivepdf.js`)) {
  console.error("The web viewer is not built. Run `pnpm build` in apps/embed first.");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.endsWith(".d.ts") });
