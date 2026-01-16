import { mouse } from "@nut-tree-fork/nut-js";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  while (true) {
    const pos = await mouse.getPosition();
    process.stdout.write(`\rx=${pos.x} y=${pos.y}  `);
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
