import { spawn, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type JsonRecord = Record<string, unknown>;

type ExtensionQueueItem = {
  id: string;
  prompt: string;
  queueTemplate?: string;
  queueCount?: number;
  queueIntervalSeconds?: number;
  createdAt: number;
};

const ROOT_DIR = process.cwd();
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "3333");
const USE_HTTPS = process.env.HTTPS === "1";
const SSL_KEY_PATH = process.env.SSL_KEY ?? "";
const SSL_CERT_PATH = process.env.SSL_CERT ?? "";
const ENABLE_COMMAND_LLM = process.env.ENABLE_COMMAND_LLM === "1";
const ENABLE_HTTP_LLM = process.env.ENABLE_HTTP_LLM === "1";
const MCP_SERVER_DEV = process.env.MCP_SERVER_DEV === "1";
const G4F_API_URL = process.env.G4F_API_URL ?? "http://127.0.0.1:1337";
const G4F_STARTUP_TIMEOUT_MS = Number(
  process.env.G4F_STARTUP_TIMEOUT_MS ?? "0"
);
const G4F_VERSION = "v6.9.3";
const G4F_RELEASE_BASE = `https://github.com/xtekky/gpt4free/releases/download/${G4F_VERSION}`;

// `tsc` does not copy static assets into `dist/`, so serve the UI directly from `src/`.
const PUBLIC_DIR = path.join(ROOT_DIR, "src", "gui", "public");
const MCP_SERVER_PATH = path.join(ROOT_DIR, "dist", "server.js");
const MCP_SERVER_SRC_PATH = path.join(ROOT_DIR, "src", "server.ts");

let extensionQueue: ExtensionQueueItem | null = null;

function json(
  res: http.ServerResponse,
  statusCode: number,
  payload: JsonRecord
): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(
  res: http.ServerResponse,
  statusCode: number,
  body: string
): void {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  text(res, 404, "Not found");
}

async function readRequestBody(
  req: http.IncomingMessage,
  limitBytes = 1_000_000
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(
  req: http.IncomingMessage,
  limitBytes = 1_000_000
): Promise<JsonRecord> {
  const raw = await readRequestBody(req, limitBytes);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object");
  }
  return parsed as JsonRecord;
}

async function proxyPost(
  url: string,
  body: JsonRecord,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const requester = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = requester.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (res) => {
        let resData = "";
        res.on("data", (chunk) => {
          resData += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(resData);
            resolve({ status: res.statusCode || 200, data: parsed });
          } catch {
            resolve({
              status: res.statusCode || 200,
              data: { error: resData },
            });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function fetchWithRedirects(
  url: string,
  redirectsLeft = 3,
  limitBytes = 15_000_000
): Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }> {
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const requester = isHttps ? https : http;

  return await new Promise((resolve, reject) => {
    const req = requester.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "gen-video-prompt-gui",
          Accept: "image/*,*/*;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = res.headers.location;
          res.resume();
          if (!location) {
            reject(new Error("Redirect missing location header"));
            return;
          }
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects while fetching image"));
            return;
          }
          const nextUrl = new URL(location, url).toString();
          fetchWithRedirects(nextUrl, redirectsLeft - 1, limitBytes)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status} from ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limitBytes) {
            res.destroy();
            reject(new Error("Image too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asObject(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function normalizePromptMode(raw: string): string | undefined {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return undefined;
  if (cleaned === "auto") return "auto";
  if (cleaned === "story" || cleaned === "storytelling") return "story";
  if (cleaned === "meme" || cleaned === "funny" || cleaned === "viral")
    return "meme";
  if (cleaned === "documentary" || cleaned === "doc" || cleaned === "docu")
    return "documentary";
  if (cleaned === "history" || cleaned === "historical") return "history";
  return undefined;
}

function safePathJoin(baseDir: string, urlPathname: string): string | null {
  const decoded = decodeURIComponent(urlPathname);
  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(baseDir, rel);
  if (
    !abs.startsWith(path.resolve(baseDir) + path.sep) &&
    abs !== path.resolve(baseDir)
  ) {
    return null;
  }
  return abs;
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function createMcpClient(): {
  request<T>(fn: (client: Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
} {
  const transport = new StdioClientTransport({
    command: "node",
    args: MCP_SERVER_DEV
      ? ["--import", "tsx", MCP_SERVER_SRC_PATH]
      : [MCP_SERVER_PATH],
    cwd: ROOT_DIR,
    stderr: "inherit",
  });

  const client = new Client({ name: "gen-video-prompt-gui", version: "0.0.0" });
  const connected = client.connect(transport);

  let queue = Promise.resolve<void>(undefined);

  const request = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      await connected;
      return await fn(client);
    });
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return await next;
  };

  const close = async (): Promise<void> => {
    await connected.catch(() => undefined);
    await client.close().catch(() => undefined);
  };

  return { request, close };
}

function buildCodexArgs(
  model: string | undefined,
  sessionMode: string | undefined,
  imagePaths: string[]
): string[] {
  const args: string[] = ["exec"];
  if (model) {
    args.push("-m", model);
  }
  args.push("--color", "never");
  if (sessionMode === "resume_last") {
    args.push("resume", "--last");
    for (const imagePath of imagePaths) {
      args.push("-i", imagePath);
    }
    args.push("--", "-");
    return args;
  }
  for (const imagePath of imagePaths) {
    args.push("-i", imagePath);
  }
  args.push("--", "-");
  return args;
}

function resolveCliCommand(command: string): string {
  if (process.platform !== "win32") return command;
  if (command === "agent") {
    const resolved =
      tryResolveWindowsCliCommand("agent") ??
      tryResolveWindowsCliCommand("cursor-agent") ??
      tryResolveWindowsCliCommand("cursor");
    if (resolved) return resolved;
    throw new Error(
      "Cursor Agent not found. Install Cursor CLI or set CURSOR_AGENT_BIN/CURSOR_BIN."
    );
  }
  if (!WINDOWS_CLI_COMMANDS.has(command)) return command;
  return resolveWindowsCliCommand(command);
}

function resolveWindowsExecutable(candidate: string): string {
  if (!candidate) return "";
  const ext = path.extname(candidate);
  if (ext) return fsSync.existsSync(candidate) ? candidate : "";
  const withCmd = `${candidate}.cmd`;
  if (fsSync.existsSync(withCmd)) return withCmd;
  const withExe = `${candidate}.exe`;
  if (fsSync.existsSync(withExe)) return withExe;
  const withBat = `${candidate}.bat`;
  if (fsSync.existsSync(withBat)) return withBat;
  if (fsSync.existsSync(candidate)) return candidate;
  return "";
}

function resolveWindowsCliCommand(command: string): string {
  const resolved = tryResolveWindowsCliCommand(command);
  if (resolved) return resolved;
  const envVar = WINDOWS_CLI_ENV[command];
  const message = envVar
    ? `${command} CLI not found. Install it or set ${envVar} to the executable path.`
    : `${command} CLI not found. Install it or add it to PATH.`;
  throw new Error(message);
}

function tryResolveWindowsCliCommand(command: string): string | null {
  const envVar = WINDOWS_CLI_ENV[command];
  const envPath = envVar ? process.env[envVar] : "";
  if (envPath) {
    const resolved = resolveWindowsExecutable(envPath);
    if (resolved) return resolved;
    return envPath;
  }

  const whereResult = spawnSync("where", [command], { encoding: "utf8" });
  if (whereResult.status === 0 && whereResult.stdout) {
    const first = whereResult.stdout.split(/\r?\n/).find(Boolean);
    const resolved = first ? resolveWindowsExecutable(first) : "";
    if (resolved) return resolved;
  }

  const env = process.env;
  const npmBin = env.APPDATA ? path.join(env.APPDATA, "npm") : "";
  const isCursorRelated =
    command === "cursor" || command === "cursor-agent" || command === "agent";
  const candidates = uniqueStrings([
    npmBin ? path.join(npmBin, `${command}.cmd`) : "",
    npmBin ? path.join(npmBin, `${command}.exe`) : "",
    npmBin ? path.join(npmBin, `${command}.bat`) : "",
    isCursorRelated
      ? path.join(env.LOCALAPPDATA || "", "Programs", "Cursor", "Cursor.exe")
      : "",
    isCursorRelated
      ? path.join(env.LOCALAPPDATA || "", "Programs", "cursor", "cursor.exe")
      : "",
    isCursorRelated
      ? path.join(env.LOCALAPPDATA || "", "Cursor", "Cursor.exe")
      : "",
    isCursorRelated
      ? path.join(env.PROGRAMFILES || "", "Cursor", "Cursor.exe")
      : "",
    isCursorRelated
      ? path.join(env["ProgramFiles(x86)"] || "", "Cursor", "Cursor.exe")
      : "",
  ]);

  const found = candidates.find(
    (candidate) => candidate && fsSync.existsSync(candidate)
  );
  if (found) return found;
  return null;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== "win32") return false;
  return /\.(cmd|bat)$/i.test(command);
}

const WINDOWS_CLI_COMMANDS = new Set(["codex", "gemini", "copilot", "cursor"]);
const WINDOWS_CLI_ENV: Record<string, string> = {
  codex: "CODEX_BIN",
  gemini: "GEMINI_BIN",
  copilot: "COPILOT_BIN",
  cursor: "CURSOR_BIN",
  agent: "CURSOR_AGENT_BIN",
};

function diagnoseCliCommand(command: string): {
  command: string;
  ok: boolean;
  resolved?: string;
  error?: string;
} {
  if (process.platform === "win32") {
    try {
      const resolved = resolveCliCommand(command);
      return { command, ok: true, resolved };
    } catch (error) {
      return {
        command,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const whichResult = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (whichResult.status === 0 && whichResult.stdout) {
    const resolved = whichResult.stdout.split(/\r?\n/).find(Boolean);
    if (resolved) return { command, ok: true, resolved };
  }
  return {
    command,
    ok: false,
    error: `${command} CLI not found in PATH.`,
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function buildGeminiArgs(model: string | undefined): string[] {
  const args: string[] = [];
  if (model) {
    args.push("--model", model);
  }
  return args;
}

function buildCopilotArgs(): string[] {
  // --no-auto-update to avoid EPERM on config.json
  return ["-s", "--yolo", "--no-auto-update", "--prompt"];
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}

function extensionForVideoMime(mime: string): string {
  switch (mime) {
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    case "video/webm":
      return ".webm";
    case "video/x-matroska":
      return ".mkv";
    default:
      return ".mp4";
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stripDataUrl(raw: string): string {
  const index = raw.indexOf("base64,");
  return index >= 0 ? raw.slice(index + 7) : raw;
}

function escapeConcatPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

async function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  const ffmpegPath = await resolveFfmpegPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      cwd: ROOT_DIR,
      env: process.env,
    });

    let stderr = Buffer.alloc(0);
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      const code =
        err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (code === "ENOENT") {
        reject(
          new Error(
            "ffmpeg not found. Place a bundled binary in bin/ffmpeg or set FFMPEG_PATH to your ffmpeg executable."
          )
        );
        return;
      }
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        const signalInfo = signal ? `, signal ${signal}` : "";
        reject(
          new Error(
            `ffmpeg failed${signalInfo}: ${
              stderr.toString("utf8") || "no stderr"
            }`
          )
        );
        return;
      }
      resolve();
    });
  });
}

async function resolveBundledFfmpegPath(): Promise<string | null> {
  const baseDir = path.join(ROOT_DIR, "bin", "ffmpeg");
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(path.join(baseDir, "darwin-arm64", "ffmpeg"));
    candidates.push(path.join(baseDir, "darwin-x64", "ffmpeg"));
  } else if (process.platform === "win32") {
    candidates.push(path.join(baseDir, "win32-x64", "ffmpeg.exe"));
  }
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep checking
    }
  }
  return null;
}

async function resolveFfmpegPath(): Promise<string> {
  const override = process.env.FFMPEG_PATH;
  if (override) return override;
  const bundled = await resolveBundledFfmpegPath();
  return bundled ?? "ffmpeg";
}

type G4fAsset = {
  name: string;
  sha256?: string;
  archive?: "zip";
};

const G4F_ASSETS: Record<string, G4fAsset> = {
  "darwin-arm64": {
    name: "g4f-macos-v6.9.3-arm64",
  },
  "linux-arm64": {
    name: "g4f-linux-v6.9.3-arm64",
    sha256:
      "fb014881a9ccc58718367d78f0d251ee7846315ad892fb2c759b14dc64f4c3e5",
  },
  "linux-x64": {
    name: "g4f-linux-v6.9.3-x64",
    sha256:
      "612ce5e94a1936cd2b1269d3379a57d55144517925bca402fc1765a8dbf172aa",
  },
  "win32-x64": {
    name: "g4f-windows-v6.9.3-x64.zip",
    archive: "zip",
  },
};

let g4fProcess: ReturnType<typeof spawn> | null = null;
let g4fStartupPromise: Promise<void> | null = null;

function splitArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getG4fPlatformKey(): string {
  if (process.platform === "darwin") {
    return `darwin-${process.arch}`;
  }
  if (process.platform === "linux") {
    return `linux-${process.arch}`;
  }
  if (process.platform === "win32") {
    return "win32-x64";
  }
  return `${process.platform}-${process.arch}`;
}

function getG4fBinaryName(): string {
  return process.platform === "win32" ? "g4f.exe" : "g4f";
}

function getG4fBinaryPath(platformKey: string): string {
  return path.join(
    ROOT_DIR,
    "bin",
    "gpt4free",
    platformKey,
    getG4fBinaryName()
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

async function downloadToFile(
  url: string,
  dest: string,
  redirectsLeft = 5
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (
        status >= 300 &&
        status < 400 &&
        res.headers.location &&
        res.headers.location.length > 0
      ) {
        if (redirectsLeft <= 0) {
          reject(new Error("Too many redirects while downloading gpt4free."));
          res.resume();
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        downloadToFile(nextUrl, dest, redirectsLeft - 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (status !== 200) {
        reject(new Error(`Download failed with status ${status}`));
        res.resume();
        return;
      }
      const fileStream = fsSync.createWriteStream(dest);
      pipeline(res, fileStream).then(resolve).catch(reject);
    });
    request.on("error", reject);
  });
}

async function runPowerShell(
  args: string[],
  timeoutMs = 60_000
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT_DIR,
      env: process.env,
    });
    let stderr = Buffer.alloc(0);
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        const signalInfo = signal ? `, signal ${signal}` : "";
        reject(
          new Error(
            `PowerShell failed${signalInfo}: ${
              stderr.toString("utf8") || "no stderr"
            }`
          )
        );
        return;
      }
      resolve();
    });
  });
}

async function extractZipWindows(zipPath: string, outDir: string): Promise<void> {
  await runPowerShell([
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${outDir}" -Force`,
  ]);
}

async function findExecutable(
  dir: string,
  targetExt: string
): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findExecutable(entryPath, targetExt);
      if (found) return found;
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(targetExt)) {
      return entryPath;
    }
  }
  return null;
}

async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    if (err && err.code === "EXDEV") {
      await fs.copyFile(src, dest);
      await fs.unlink(src);
      return;
    }
    throw err;
  }
}

async function downloadG4fBinary(): Promise<string> {
  const platformKey = getG4fPlatformKey();
  const asset = G4F_ASSETS[platformKey];
  if (!asset) {
    throw new Error(
      `Unsupported platform for gpt4free download: ${platformKey}`
    );
  }
  const targetDir = path.join(ROOT_DIR, "bin", "gpt4free", platformKey);
  const targetPath = getG4fBinaryPath(platformKey);
  if (await fileExists(targetPath)) {
    return targetPath;
  }
  await fs.mkdir(targetDir, { recursive: true });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "g4f-download-"));
  try {
    const downloadPath = path.join(tmpDir, asset.name);
    await downloadToFile(`${G4F_RELEASE_BASE}/${asset.name}`, downloadPath);
    if (asset.sha256) {
      const digest = await sha256File(downloadPath);
      if (digest !== asset.sha256) {
        throw new Error(
          `SHA256 mismatch for ${asset.name}. Expected ${asset.sha256} but got ${digest}.`
        );
      }
    }
    if (asset.archive === "zip") {
      const extractDir = path.join(tmpDir, "extract");
      await fs.mkdir(extractDir, { recursive: true });
      await extractZipWindows(downloadPath, extractDir);
      const exePath = await findExecutable(extractDir, ".exe");
      if (!exePath) {
        throw new Error("No executable found in gpt4free zip archive.");
      }
      await moveFile(exePath, targetPath);
    } else {
      await moveFile(downloadPath, targetPath);
      await fs.chmod(targetPath, 0o755);
    }
    return targetPath;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function resolveG4fPath(): Promise<string> {
  const override = process.env.G4F_PATH;
  if (override) return override;
  return await downloadG4fBinary();
}

function buildOpenAiUrl(baseUrl: string, endpoint: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/v1")) {
    return `${base}${endpoint}`;
  }
  return `${base}/v1${endpoint}`;
}

async function fetchStatus(url: string): Promise<number> {
  const urlObj = new URL(url);
  const requester = urlObj.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    const req = requester.request(urlObj, { method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("error", reject);
    req.end();
  });
}

async function isG4fServerHealthy(): Promise<boolean> {
  try {
    const status = await fetchStatus(buildOpenAiUrl(G4F_API_URL, "/models"));
    return status >= 200 && status < 500;
  } catch {
    return false;
  }
}

async function ensureG4fServerReady(): Promise<void> {
  if (await isG4fServerHealthy()) return;
  throw new Error(
    "gpt4free server is not running. Click Connect to download and start it."
  );
}

async function startG4fServer(): Promise<void> {
  if (await isG4fServerHealthy()) return;
  if (!g4fStartupPromise) {
    g4fStartupPromise = (async () => {
      const g4fPath = await resolveG4fPath();
      const args = splitArgs(process.env.G4F_ARGS);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(g4fPath, args, {
          stdio: ["ignore", "ignore", "pipe"],
          cwd: ROOT_DIR,
          env: process.env,
        });
        g4fProcess = child;
        child.on("error", (err) => {
          g4fProcess = null;
          g4fStartupPromise = null;
          reject(err);
        });
        child.on("exit", () => {
          g4fProcess = null;
          g4fStartupPromise = null;
        });
        resolve();
      });

      const deadline =
        G4F_STARTUP_TIMEOUT_MS > 0
          ? Date.now() + G4F_STARTUP_TIMEOUT_MS
          : null;
      while (!deadline || Date.now() < deadline) {
        if (await isG4fServerHealthy()) return;
        if (!g4fProcess) {
          throw new Error("gpt4free process exited before it became ready.");
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(
        "Timed out waiting for gpt4free to start. Set G4F_STARTUP_TIMEOUT_MS=0 to wait indefinitely."
      );
    })();
  }
  try {
    await g4fStartupPromise;
  } catch (err) {
    g4fStartupPromise = null;
    throw err;
  }
}

async function runCommandLlm(params: {
  command: string;
  args: string[];
  input: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<string> {
  const timeoutMs = params.timeoutMs ?? 60_000;
  const maxOutputBytes = params.maxOutputBytes ?? 2_000_000;

  return await new Promise((resolve, reject) => {
    const useShell = shouldUseShell(params.command);
    const child = spawn(params.command, params.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: ROOT_DIR,
      env: process.env,
      shell: useShell,
    });

    let killReason = "";
    const killTimer = setTimeout(() => {
      killReason = `Timeout after ${timeoutMs}ms`;
      child.kill("SIGKILL");
    }, timeoutMs);

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);

    const onData = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
      if (stdout.length > maxOutputBytes || stderr.length > maxOutputBytes) {
        killReason = `Output exceeded ${maxOutputBytes} bytes`;
        child.kill("SIGKILL");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk));

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        const signalInfo = signal ? `, signal ${signal}` : "";
        const reason = killReason ? `\n\nreason:\n${killReason}` : "";
        const stderrText = stderr.toString("utf8").trim();
        const stdoutText = stdout.toString("utf8").trim();
        const stdoutInfo = stdoutText ? `\n\nstdout:\n${stdoutText}` : "";
        reject(
          new Error(
            `LLM command failed (exit ${code}${signalInfo}).\n\nstderr:\n${stderrText}${stdoutInfo}${reason}`
          )
        );
        return;
      }
      resolve(stdout.toString("utf8").trim());
    });

    child.stdin.end(params.input);
  });
}

async function runOpenAiCompatible(params: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 60_000
  );
  try {
    const base = params.baseUrl.replace(/\/+$/, "");
    const url = base.endsWith("/v1")
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (params.apiKey) {
      headers.authorization = `Bearer ${params.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: params.prompt },
        ],
        temperature: 0.8,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
    }

    const json = JSON.parse(text) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(
        "OpenAI-compatible response missing choices[0].message.content"
      );
    }
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function runOllama(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 60_000
  );
  try {
    const base = params.baseUrl.replace(/\/+$/, "");
    const url = `${base}/api/generate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}\n${text}`);
    }

    const json = JSON.parse(text) as any;
    const response = json?.response;
    if (typeof response !== "string" || !response.trim()) {
      throw new Error("Ollama response missing response text");
    }
    return response.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  try {
    await fs.stat(MCP_SERVER_PATH);
  } catch {
    throw new Error(
      `Missing built MCP server at ${MCP_SERVER_PATH}. Run: npm run build`
    );
  }

  const mcp = createMcpClient();

  const requestHandler = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    try {
      const method = req.method ?? "GET";
      const scheme = USE_HTTPS ? "https" : "http";
      const url = new URL(req.url ?? "/", `${scheme}://${HOST}:${PORT}`);

      if (method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/prompts") {
        const result = await mcp.request((c) => c.listPrompts());
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method === "GET" && url.pathname === "/api/image-proxy") {
        const target = url.searchParams.get("url") ?? "";
        if (!target) {
          json(res, 400, { ok: false, error: "Missing url parameter" });
          return;
        }
        let targetUrl: URL;
        try {
          targetUrl = new URL(target);
        } catch {
          json(res, 400, { ok: false, error: "Invalid url parameter" });
          return;
        }
        if (!["http:", "https:"].includes(targetUrl.protocol)) {
          json(res, 400, {
            ok: false,
            error: "Only http/https URLs are allowed",
          });
          return;
        }
        try {
          const result = await fetchWithRedirects(targetUrl.toString());
          const contentType =
            typeof result.headers["content-type"] === "string"
              ? result.headers["content-type"]
              : "application/octet-stream";
          res.writeHead(200, {
            "content-type": contentType,
            "cache-control": "no-store",
          });
          res.end(result.body);
        } catch (err: any) {
          json(res, 502, {
            ok: false,
            error: err && err.message ? err.message : "Fetch failed",
          });
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/prompts/get") {
        const body = await readJson(req);
        const name = asString(body.name) ?? "";
        const args = asObject(body.arguments);
        if (!name) {
          json(res, 400, { ok: false, error: "Missing prompt name" });
          return;
        }
        const result = await mcp.request((c) =>
          c.getPrompt({ name, arguments: args as Record<string, string> })
        );
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method === "POST" && url.pathname === "/api/generate") {
        const body = await readJson(req, 20_000_000);
        const story = asString(body.story) ?? "";
        if (!story) {
          json(res, 400, { ok: false, error: "Missing story" });
          return;
        }

        const provider = asString(body.provider) ?? "none";
        const rawMode = asString(body.mode);
        const mode = rawMode ? normalizePromptMode(rawMode) : undefined;
        if (rawMode && !mode) {
          json(res, 400, {
            ok: false,
            error: `Unknown mode: ${rawMode}. Supported: auto, story, meme, documentary, history.`,
          });
          return;
        }
        const totalSeconds = Number(asString(body.duration_seconds));
        const partSeconds = Number(asString(body.part_length_seconds));
        if (
          Number.isFinite(partSeconds) &&
          Number.isFinite(totalSeconds) &&
          partSeconds >= totalSeconds
        ) {
          json(res, 400, {
            ok: false,
            error: "Part length must be less than total duration.",
          });
          return;
        }
        const rawImages = Array.isArray(body.images) ? body.images : [];
        const images = rawImages.filter(
          (img) => img && typeof img === "object"
        ) as JsonRecord[];
        const uploadedFiles: string[] = [];

        if (images.length > 0 && provider !== "command") {
          json(res, 400, {
            ok: false,
            error: "Images are only supported with Codex CLI.",
          });
          return;
        }

        const promptTemplate = await mcp.request((c) =>
          c.getPrompt({
            name: "structured_video_prompt",
            arguments: {
              story,
              ...(mode ? { mode } : {}),
              ...(asString(body.duration_seconds)
                ? { duration_seconds: asString(body.duration_seconds)! }
                : {}),
              ...(asString(body.part_length_seconds)
                ? { part_length_seconds: asString(body.part_length_seconds)! }
                : {}),
              ...(asString(body.resolution)
                ? { resolution: asString(body.resolution)! }
                : {}),
              ...(asString(body.aspect_ratio)
                ? { aspect_ratio: asString(body.aspect_ratio)! }
                : {}),
              ...(asString(body.style) ? { style: asString(body.style)! } : {}),
              ...(asString(body.camera)
                ? { camera: asString(body.camera)! }
                : {}),
              ...(asString(body.lighting)
                ? { lighting: asString(body.lighting)! }
                : {}),
              ...(asString(body.quality)
                ? { quality: asString(body.quality)! }
                : {}),
              ...(asString(body.action_beats)
                ? { action_beats: asString(body.action_beats)! }
                : {}),
              ...(asString(body.audio) ? { audio: asString(body.audio)! } : {}),
            },
          })
        );

        const first = (promptTemplate as any)?.messages?.[0]?.content;
        const templateText =
          first && first.type === "text" && typeof first.text === "string"
            ? first.text
            : "";
        if (!templateText) {
          json(res, 500, {
            ok: false,
            error: "Failed to build prompt template",
          });
          return;
        }

        const instruction = [
          "You are a prompt writer. Fill in the missing fields and output ONLY the final structured prompt sections.",
          "Do not include '(unspecified)'. If unknown, infer plausible specifics.",
          "If Part length (seconds) is provided, split into multiple parts and label with time ranges.",
          "If Part length is NOT provided, output a single Part 1 covering the full Duration.",
          "Return exactly these sections for each part:",
          "Part 1 (start–end s):",
          "Prompt:",
          "Scene:",
          "Style:",
          "Camera:",
          "Lighting:",
          "Action beats:",
          "Quality:",
          "Audio (optional):",
          "",
          "Repeat the Part block for each segment when Part length is provided.",
          "",
          "Template + constraints:",
          templateText,
          "",
        ].join("\n");

        if (provider === "none") {
          json(res, 200, { ok: true, mode: "template", text: templateText });
          return;
        }

        if (provider === "command") {
          if (!ENABLE_COMMAND_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "Command LLM is disabled. Start with ENABLE_COMMAND_LLM=1 (e.g. ENABLE_COMMAND_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }

          const command = asString(body.command) ?? "";
          const args = Array.isArray(body.args)
            ? body.args.filter((v) => typeof v === "string")
            : [];
          if (!command) {
            json(res, 400, {
              ok: false,
              error: "Missing command for provider=command",
            });
            return;
          }
          if (args.length > 0) {
            json(res, 400, {
              ok: false,
              error: "Args are disabled for security.",
            });
            return;
          }
          if (images.length > 0 && command !== "codex") {
            json(res, 400, {
              ok: false,
              error: "Images are only supported with Codex CLI.",
            });
            return;
          }

          try {
            if (images.length > 0) {
              const uploadDir = path.join(ROOT_DIR, "tmp", "uploads");
              await fs.mkdir(uploadDir, { recursive: true });
              let totalBytes = 0;
              const maxBytes = 10 * 1024 * 1024;
              for (const image of images) {
                const data = asString(image.data) ?? "";
                if (!data) {
                  json(res, 400, { ok: false, error: "Invalid image data." });
                  return;
                }
                const mime = asString(image.type) ?? "";
                const buffer = Buffer.from(data, "base64");
                totalBytes += buffer.length;
                if (totalBytes > maxBytes) {
                  json(res, 400, {
                    ok: false,
                    error: "Total image size exceeds 10MB.",
                  });
                  return;
                }
                const filename = `prompt-${Date.now()}-${Math.random()
                  .toString(16)
                  .slice(2)}${extensionForMime(mime)}`;
                const filePath = path.join(uploadDir, filename);
                await fs.writeFile(filePath, buffer);
                uploadedFiles.push(filePath);
              }
            }

            const codexModel = asString(body.codex_model);
            const codexSession = asString(body.codex_session) ?? "new";
            const geminiModel = asString(body.gemini_model);
            const effectiveArgs =
              command === "codex"
                ? buildCodexArgs(codexModel, codexSession, uploadedFiles)
                : command === "gemini"
                ? buildGeminiArgs(geminiModel)
                : command === "copilot"
                ? [...buildCopilotArgs(), instruction]
                : command === "agent"
                ? []
                : [];

            const resolvedCommand = resolveCliCommand(command);
            const out = await runCommandLlm({
              command: resolvedCommand,
              args: effectiveArgs,
              input: command === "copilot" ? "" : instruction,
              timeoutMs: 120_000,
            });
            json(res, 200, { ok: true, mode: "generated", text: out });
            return;
          } finally {
            await Promise.all(
              uploadedFiles.map((file) =>
                fs.unlink(file).catch(() => undefined)
              )
            );
          }
        }

        if (provider === "ollama") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const ollama = asObject(body.ollama);
          const baseUrl = asString(ollama.base_url) ?? "http://127.0.0.1:11434";
          const model = asString(ollama.model) ?? "";
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=ollama",
            });
            return;
          }
          const out = await runOllama({ baseUrl, model, prompt: instruction });
          json(res, 200, { ok: true, mode: "generated", text: out });
          return;
        }

        if (provider === "openai_compatible") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const openai = asObject(body.openai_compatible);
          const baseUrl = asString(openai.base_url) ?? "";
          const model = asString(openai.model) ?? "";
          const apiKey = asString(openai.api_key);
          if (!baseUrl) {
            json(res, 400, {
              ok: false,
              error: "Missing base_url for provider=openai_compatible",
            });
            return;
          }
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=openai_compatible",
            });
            return;
          }
          const out = await runOpenAiCompatible({
            baseUrl,
            model,
            apiKey,
            prompt: instruction,
          });
          json(res, 200, { ok: true, mode: "generated", text: out });
          return;
        }

        if (provider === "image_gen") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const imageGen = asObject(body.image_gen);
          const baseUrl = asString(imageGen.base_url) ?? "";
          const model = asString(imageGen.model) ?? "";
          const apiKey = asString(imageGen.api_key);
          if (!baseUrl) {
            json(res, 400, {
              ok: false,
              error: "Missing base_url for provider=image_gen",
            });
            return;
          }
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=image_gen",
            });
            return;
          }
          const out = await runOpenAiCompatible({
            baseUrl,
            model,
            apiKey,
            prompt: instruction,
          });
          json(res, 200, { ok: true, mode: "generated", text: out });
          return;
        }

        if (provider === "puter") {
          json(res, 400, {
            ok: false,
            error:
              "Puter.js provider must be handled on the client side. Check your GUI configuration.",
          });
          return;
        }

        if (provider === "gpt4free") {
          const gpt4free = asObject(body.gpt4free);
          const model = asString(gpt4free.model) || undefined;
          try {
            await ensureG4fServerReady();
            const response = await proxyPost(
              buildOpenAiUrl(G4F_API_URL, "/chat/completions"),
              {
                model: model || "gpt-4o",
                messages: [
                  { role: "system", content: "You are a helpful assistant." },
                  { role: "user", content: instruction },
                ],
              }
            );
            const out = response.data?.choices?.[0]?.message?.content ?? "";
            json(res, 200, { ok: true, mode: "generated", text: out });
          } catch (err: any) {
            json(res, 500, { ok: false, error: err.message });
          }
          return;
        }

        json(res, 400, { ok: false, error: `Unknown provider: ${provider}` });
        return;
      }

      if (method === "POST" && url.pathname === "/api/merge-videos") {
        const body = await readJson(req, 200_000_000);
        const rawFiles = Array.isArray(body.files) ? body.files : [];
        if (!rawFiles.length) {
          json(res, 400, { ok: false, error: "No video files provided." });
          return;
        }
        const tmpDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "gen-video-merge-")
        );
        const filePaths: string[] = [];
        try {
          for (let index = 0; index < rawFiles.length; index += 1) {
            const file = rawFiles[index];
            const name = asString(file && file.name) ?? `part-${index + 1}`;
            const type = asString(file && file.type) ?? "video/mp4";
            const data = asString(file && file.data) ?? "";
            if (!data) {
              json(res, 400, { ok: false, error: `Missing data for ${name}.` });
              return;
            }
            const baseName = sanitizeFileName(
              path.parse(name).name || `part-${index + 1}`
            );
            const ext = extensionForVideoMime(type);
            const fileName = `${String(index + 1).padStart(
              2,
              "0"
            )}-${baseName}${ext}`;
            const filePath = path.join(tmpDir, fileName);
            const buffer = Buffer.from(stripDataUrl(data), "base64");
            await fs.writeFile(filePath, buffer);
            filePaths.push(filePath);
          }

          const listPath = path.join(tmpDir, "inputs.txt");
          const listBody = filePaths
            .map((p) => `file '${escapeConcatPath(p)}'`)
            .join("\n");
          await fs.writeFile(listPath, listBody);

          const outputPath = path.join(tmpDir, "merged.mp4");
          await runFfmpeg([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listPath,
            "-c",
            "copy",
            outputPath,
          ]);
          const merged = await fs.readFile(outputPath);
          json(res, 200, {
            ok: true,
            file: {
              name: "merged.mp4",
              type: "video/mp4",
              data: merged.toString("base64"),
            },
          });
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true });
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/generate-image") {
        const body = await readJson(req, 1_000_000);
        const prompt = asString(body.prompt) ?? "";
        if (!prompt) {
          json(res, 400, { ok: false, error: "Missing prompt" });
          return;
        }

        const config = asObject(body.config);
        const provider = asString(config.provider);
        const baseUrl = asString(config.base_url);
        const model = asString(config.model);
        const apiKey = asString(config.api_key);
        const size = asString(config.size) ?? "1024x1024";

        if (provider === "gpt4free") {
          try {
            await ensureG4fServerReady();
            const response = await proxyPost(
              buildOpenAiUrl(G4F_API_URL, "/images/generations"),
              {
                model: model || "flux-2-pro",
                prompt,
              }
            );
            const imageData = response.data?.data?.[0] ?? {};
            const imageUrl =
              asString(imageData.url) ??
              (asString(imageData.b64_json)
                ? `data:image/png;base64,${imageData.b64_json}`
                : "");
            json(res, 200, { ok: true, url: imageUrl });
          } catch (err: any) {
            json(res, 500, { ok: false, error: err.message });
          }
          return;
        }

        if (!baseUrl) {
          json(res, 400, {
            ok: false,
            error: "Missing Antigravity Tools Base URL",
          });
          return;
        }

        try {
          const base = baseUrl.replace(/\/+$/, "");
          const fullUrl = base.endsWith("/v1")
            ? `${base}/chat/completions`
            : `${base}/v1/chat/completions`;

          const payload: any = {
            model: model || "gemini-3-pro-image",
            messages: [{ role: "user", content: prompt }],
          };

          if (size) {
            payload.extra_body = { size };
          }

          const headers: Record<string, string> = {};
          if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
          }

          const result = await proxyPost(fullUrl, payload, headers);
          json(res, result.status, result.data);
        } catch (err: any) {
          json(res, 500, { ok: false, error: err.message });
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(req, 20_000_000);
        const prompt = asString(body.prompt) ?? "";
        if (!prompt) {
          json(res, 400, { ok: false, error: "Missing prompt" });
          return;
        }

        const provider = asString(body.provider) ?? "none";
        const rawImages = Array.isArray(body.images) ? body.images : [];
        const images = rawImages.filter(
          (img) => img && typeof img === "object"
        ) as JsonRecord[];
        const uploadedFiles: string[] = [];

        if (provider === "none") {
          json(res, 400, {
            ok: false,
            error: "Provider is set to template only",
          });
          return;
        }

        if (images.length > 0 && provider !== "command") {
          json(res, 400, {
            ok: false,
            error: "Images are only supported with Codex CLI.",
          });
          return;
        }

        if (provider === "command") {
          if (!ENABLE_COMMAND_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "Command LLM is disabled. Start with ENABLE_COMMAND_LLM=1 (e.g. ENABLE_COMMAND_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }

          const command = asString(body.command) ?? "";
          const args = Array.isArray(body.args)
            ? body.args.filter((v) => typeof v === "string")
            : [];
          if (!command) {
            json(res, 400, {
              ok: false,
              error: "Missing command for provider=command",
            });
            return;
          }
          if (args.length > 0) {
            json(res, 400, {
              ok: false,
              error: "Args are disabled for security.",
            });
            return;
          }

          if (images.length > 0 && command !== "codex") {
            json(res, 400, {
              ok: false,
              error: "Images are only supported with Codex CLI.",
            });
            return;
          }

          try {
            if (images.length > 0) {
              const uploadDir = path.join(ROOT_DIR, "tmp", "uploads");
              await fs.mkdir(uploadDir, { recursive: true });
              let totalBytes = 0;
              const maxBytes = 10 * 1024 * 1024;
              for (const image of images) {
                const data = asString(image.data) ?? "";
                if (!data) {
                  json(res, 400, { ok: false, error: "Invalid image data." });
                  return;
                }
                const mime = asString(image.type) ?? "";
                const buffer = Buffer.from(data, "base64");
                totalBytes += buffer.length;
                if (totalBytes > maxBytes) {
                  json(res, 400, {
                    ok: false,
                    error: "Total image size exceeds 10MB.",
                  });
                  return;
                }
                const filename = `chat-${Date.now()}-${Math.random()
                  .toString(16)
                  .slice(2)}${extensionForMime(mime)}`;
                const filePath = path.join(uploadDir, filename);
                await fs.writeFile(filePath, buffer);
                uploadedFiles.push(filePath);
              }
            }

            const codexModel = asString(body.codex_model);
            const codexSession = asString(body.codex_session) ?? "new";
            const geminiModel = asString(body.gemini_model);
            const effectiveArgs =
              command === "codex"
                ? buildCodexArgs(codexModel, codexSession, uploadedFiles)
                : command === "gemini"
                ? buildGeminiArgs(geminiModel)
                : command === "copilot"
                ? buildCopilotArgs()
                : command === "agent"
                ? []
                : [];

            const resolvedCommand = resolveCliCommand(command);
            const out = await runCommandLlm({
              command: resolvedCommand,
              args: effectiveArgs,
              input: prompt,
            });
            json(res, 200, { ok: true, mode: "chat", text: out });
            return;
          } finally {
            await Promise.all(
              uploadedFiles.map((file) =>
                fs.unlink(file).catch(() => undefined)
              )
            );
          }
        }

        if (provider === "ollama") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const ollama = asObject(body.ollama);
          const baseUrl = asString(ollama.base_url) ?? "";
          const model = asString(ollama.model) ?? "";
          if (!baseUrl) {
            json(res, 400, {
              ok: false,
              error: "Missing base_url for provider=ollama",
            });
            return;
          }
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=ollama",
            });
            return;
          }
          const out = await runOllama({ baseUrl, model, prompt });
          json(res, 200, { ok: true, mode: "chat", text: out });
          return;
        }

        if (provider === "openai_compatible") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const openai = asObject(body.openai_compatible);
          const baseUrl = asString(openai.base_url) ?? "";
          const model = asString(openai.model) ?? "";
          const apiKey = asString(openai.api_key);
          if (!baseUrl) {
            json(res, 400, {
              ok: false,
              error: "Missing base_url for provider=openai_compatible",
            });
            return;
          }
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=openai_compatible",
            });
            return;
          }
          const out = await runOpenAiCompatible({
            baseUrl,
            model,
            apiKey,
            prompt,
          });
          json(res, 200, { ok: true, mode: "chat", text: out });
          return;
        }

        if (provider === "image_gen") {
          if (!ENABLE_HTTP_LLM) {
            json(res, 400, {
              ok: false,
              error:
                "HTTP LLM is disabled. Start with ENABLE_HTTP_LLM=1 (e.g. ENABLE_HTTP_LLM=1 PORT=3333 npm run gui).",
            });
            return;
          }
          const imageGen = asObject(body.image_gen);
          const baseUrl = asString(imageGen.base_url) ?? "";
          const model = asString(imageGen.model) ?? "";
          const apiKey = asString(imageGen.api_key);
          if (!baseUrl) {
            json(res, 400, {
              ok: false,
              error: "Missing base_url for provider=image_gen",
            });
            return;
          }
          if (!model) {
            json(res, 400, {
              ok: false,
              error: "Missing model for provider=image_gen",
            });
            return;
          }
          const out = await runOpenAiCompatible({
            baseUrl,
            model,
            apiKey,
            prompt,
          });
          json(res, 200, { ok: true, mode: "chat", text: out });
          return;
        }

        if (provider === "puter") {
          json(res, 400, {
            ok: false,
            error:
              "Puter.js provider must be handled on the client side. Check your GUI configuration.",
          });
          return;
        }

        if (provider === "gpt4free") {
          const gpt4free = asObject(body.gpt4free);
          const model = asString(gpt4free.model) || undefined;
          try {
            await ensureG4fServerReady();
            const response = await proxyPost(
              buildOpenAiUrl(G4F_API_URL, "/chat/completions"),
              {
                model: model || "gpt-4o",
                messages: [{ role: "user", content: prompt }],
              }
            );
            const out = response.data?.choices?.[0]?.message?.content ?? "";
            json(res, 200, { ok: true, mode: "chat", text: out });
          } catch (err: any) {
            json(res, 500, { ok: false, error: err.message });
          }
          return;
        }

        json(res, 400, { ok: false, error: `Unknown provider: ${provider}` });
        return;
      }

      if (method === "POST" && url.pathname === "/api/gpt4free/connect") {
        try {
          await startG4fServer();
          json(res, 200, { ok: true });
        } catch (err: any) {
          json(res, 500, { ok: false, error: err.message });
        }
        return;
      }

      if (method === "GET" && url.pathname === "/api/tools") {
        const result = await mcp.request((c) => c.listTools());
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method === "POST" && url.pathname === "/api/extension/queue") {
        const body = await readJson(req);
        const prompt = asString(body.prompt) ?? "";
        if (!prompt) {
          json(res, 400, { ok: false, error: "Missing prompt." });
          return;
        }
        const queueTemplate = asString(body.queue_template);
        const queueCountRaw = body.queue_count;
        const queueIntervalRaw = body.queue_interval_seconds;
        const queueCount = Number.isFinite(Number(queueCountRaw))
          ? Number(queueCountRaw)
          : undefined;
        const queueIntervalSeconds = Number.isFinite(Number(queueIntervalRaw))
          ? Number(queueIntervalRaw)
          : undefined;
        const item: ExtensionQueueItem = {
          id: crypto.randomUUID(),
          prompt,
          queueTemplate,
          queueCount:
            typeof queueCount === "number" && queueCount > 0
              ? queueCount
              : undefined,
          queueIntervalSeconds:
            typeof queueIntervalSeconds === "number" &&
            queueIntervalSeconds >= 0
              ? queueIntervalSeconds
              : undefined,
          createdAt: Date.now(),
        };
        extensionQueue = item;
        json(res, 200, { ok: true, id: item.id });
        return;
      }

      if (method === "GET" && url.pathname === "/api/extension/queue/next") {
        if (!extensionQueue) {
          json(res, 200, { ok: true, item: null });
          return;
        }
        const item = extensionQueue;
        extensionQueue = null;
        json(res, 200, { ok: true, item });
        return;
      }

      if (method === "GET" && url.pathname === "/api/cli/diagnostics") {
        const commands = ["codex", "gemini", "copilot", "cursor", "agent"];
        const diagnostics = commands.map((command) =>
          diagnoseCliCommand(command)
        );
        json(res, 200, { ok: true, diagnostics });
        return;
      }

      if (method === "POST" && url.pathname === "/api/tools/call") {
        const body = await readJson(req);
        const name = asString(body.name) ?? "";
        const args = asObject(body.arguments);
        if (!name) {
          json(res, 400, { ok: false, error: "Missing tool name" });
          return;
        }
        const result = await mcp.request((c) =>
          c.callTool({ name, arguments: args as Record<string, unknown> })
        );
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method === "GET" && url.pathname === "/api/resources") {
        const result = await mcp.request((c) => c.listResources());
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method === "GET" && url.pathname === "/api/resources/read") {
        const uri = url.searchParams.get("uri") ?? "";
        if (!uri) {
          json(res, 400, { ok: false, error: "Missing uri query param" });
          return;
        }
        const result = await mcp.request((c) => c.readResource({ uri }));
        json(res, 200, result as unknown as JsonRecord);
        return;
      }

      if (method !== "GET") {
        notFound(res);
        return;
      }

      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = safePathJoin(PUBLIC_DIR, pathname);
      if (!filePath) {
        notFound(res);
        return;
      }

      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        "content-type": contentTypeFor(filePath),
        "cache-control": "no-store",
      });
      res.end(content);
    } catch (error) {
      json(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  let server: http.Server | https.Server;
  if (USE_HTTPS) {
    if (!SSL_KEY_PATH || !SSL_CERT_PATH) {
      throw new Error(
        "HTTPS=1 requires SSL_KEY and SSL_CERT environment variables."
      );
    }
    const [key, cert] = await Promise.all([
      fs.readFile(SSL_KEY_PATH),
      fs.readFile(SSL_CERT_PATH),
    ]);
    server = https.createServer({ key, cert }, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  const shutdown = async (): Promise<void> => {
    await mcp.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, HOST, resolve);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "EPERM") {
      throw new Error(
        [
          `Cannot listen on ${
            USE_HTTPS ? "https" : "http"
          }://${HOST}:${PORT} (EPERM).`,
          "This usually means your environment blocks binding to local TCP ports (sandbox/restrictions).",
          "Try running from a normal terminal session, or pick a different port:",
          "  PORT=8080 npm run gui",
          "",
          `Original error: ${message}`,
        ].join("\n")
      );
    }
    throw new Error(
      `Failed to start GUI server on ${
        USE_HTTPS ? "https" : "http"
      }://${HOST}:${PORT}: ${message}`
    );
  }
  // eslint-disable-next-line no-console
  const address = server.address();
  const boundPort =
    address && typeof address === "object" && "port" in address
      ? Number(address.port)
      : PORT;
  console.log(
    `GUI running: ${USE_HTTPS ? "https" : "http"}://${HOST}:${boundPort}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
