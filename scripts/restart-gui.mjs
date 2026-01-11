import { execSync, spawn } from "node:child_process";

function killPort(port) {
  const pidText = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: "utf8" }).trim();
  if (!pidText) return;
  for (const pid of pidText.split(/\s+/g).filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
}

async function main() {
  const port = Number(process.env.PORT ?? "3333");
  killPort(port);

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCmd, ["run", "gui"], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
