import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { cmd, source } = resolveCodexCommand();
  const args = ["--version"];
  const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS || "5000");
  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const shell = shouldUseShell(cmd);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`codex --version timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

  if (code !== 0) {
    throw new Error(`codex --version failed (exit ${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const output = (stdout || stderr).trim();
  if (!output) {
    throw new Error("codex --version produced no output.");
  }

  const detail = output.split("\n")[0];
  const sourceNote = source ? ` (${source})` : "";
  console.log(`Codex CLI test: OK${sourceNote} (${detail})`);
}

function resolveCodexCommand() {
  const envPath = process.env.CODEX_BIN;
  if (envPath) {
    if (process.platform === "win32") {
      const resolved = resolveWindowsExecutable(envPath);
      if (resolved) return { cmd: resolved, source: "CODEX_BIN" };
    }
    return { cmd: envPath, source: "CODEX_BIN" };
  }

  const platform = process.platform;
  if (platform === "win32") {
    const whereResult = spawnSync("where", ["codex"], { encoding: "utf8" });
    if (whereResult.status === 0 && whereResult.stdout) {
      const first = whereResult.stdout.split(/\r?\n/).find(Boolean);
      const resolved = first ? resolveWindowsExecutable(first) : "";
      if (resolved) return { cmd: resolved, source: "PATH" };
    }

    const env = process.env;
    const candidates = uniqueStrings([
      path.join(env.APPDATA || "", "npm", "codex.cmd"),
      path.join(env.LOCALAPPDATA || "", "Programs", "Codex", "codex.exe"),
      path.join(env.LOCALAPPDATA || "", "Programs", "codex", "codex.exe"),
      path.join(env.LOCALAPPDATA || "", "Codex", "codex.exe"),
      path.join(env.PROGRAMFILES || "", "Codex", "codex.exe"),
      path.join(env["ProgramFiles(x86)"] || "", "Codex", "codex.exe"),
      path.join(env.USERPROFILE || "", "scoop", "shims", "codex.exe"),
      path.join(env.USERPROFILE || "", "scoop", "shims", "codex.cmd"),
      path.join("C:\\ProgramData", "chocolatey", "bin", "codex.exe"),
    ]);

    const found = candidates.find((candidate) => candidate && existsSync(candidate));
    if (found) return { cmd: found, source: "common install path" };
  } else {
    const whichResult = spawnSync("sh", ["-lc", "command -v codex"], { encoding: "utf8" });
    if (whichResult.status === 0 && whichResult.stdout) {
      const first = whichResult.stdout.split(/\r?\n/).find(Boolean);
      if (first) return { cmd: first, source: "PATH" };
    }

    const home = process.env.HOME || "";
    const candidates = uniqueStrings([
      "/usr/local/bin/codex",
      "/usr/bin/codex",
      "/opt/homebrew/bin/codex",
      path.join(home, ".local", "bin", "codex"),
    ]);
    const found = candidates.find((candidate) => candidate && existsSync(candidate));
    if (found) return { cmd: found, source: "common install path" };
  }

  throw new Error(
    "codex not found. Install Codex CLI or set CODEX_BIN to the executable path."
  );
}

function shouldUseShell(cmd) {
  if (process.platform !== "win32") return false;
  return /\.(cmd|bat)$/i.test(cmd);
}

function resolveWindowsExecutable(candidate) {
  if (!candidate) return "";
  const ext = path.extname(candidate);
  if (ext) return existsSync(candidate) ? candidate : "";
  const withCmd = `${candidate}.cmd`;
  if (existsSync(withCmd)) return withCmd;
  const withExe = `${candidate}.exe`;
  if (existsSync(withExe)) return withExe;
  const withBat = `${candidate}.bat`;
  if (existsSync(withBat)) return withBat;
  if (existsSync(candidate)) return candidate;
  return "";
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

main().catch((error) => {
  console.error("Codex CLI test: FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
