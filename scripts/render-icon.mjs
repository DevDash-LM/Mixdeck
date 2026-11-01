// Renders assets/icon.svg -> assets/icon-1024.png (then run `npm run tauri icon assets/icon-1024.png`).
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync(new URL("../assets/icon.svg", import.meta.url));
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(new URL("../assets/icon-1024.png", import.meta.url), png);
console.log(`wrote assets/icon-1024.png (${png.length} bytes)`);
