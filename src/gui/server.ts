import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type JsonRecord = Record<string, unknown>;

const ROOT_DIR = process.cwd();
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "3333");
const ENABLE_COMMAND_LLM = process.env.ENABLE_COMMAND_LLM === "1";
const ENABLE_HTTP_LLM = process.env.ENABLE_HTTP_LLM === "1";
const MCP_SERVER_DEV = process.env.MCP_SERVER_DEV === "1";

// `tsc` does not copy static assets into `dist/`, so serve the UI directly from `src/`.
const PUBLIC_DIR = path.join(ROOT_DIR, "src", "gui", "public");
const MCP_SERVER_PATH = path.join(ROOT_DIR, "dist", "server.js");
const MCP_SERVER_SRC_PATH = path.join(ROOT_DIR, "src", "server.ts");

function json(res: http.ServerResponse, statusCode: number, payload: JsonRecord): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function text(res: http.ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  text(res, 404, "Not found");
}

async function readRequestBody(req: http.IncomingMessage, limitBytes = 1_000_000): Promise<string> {
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

async function readJson(req: http.IncomingMessage, limitBytes = 1_000_000): Promise<JsonRecord> {
  const raw = await readRequestBody(req, limitBytes);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object");
  }
  return parsed as JsonRecord;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asObject(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function safePathJoin(baseDir: string, urlPathname: string): string | null {
  const decoded = decodeURIComponent(urlPathname);
  const rel = decoded.replace(/^\/+/, "");
  const abs = path.resolve(baseDir, rel);
  if (!abs.startsWith(path.resolve(baseDir) + path.sep) && abs !== path.resolve(baseDir)) {
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
    args: MCP_SERVER_DEV ? ["--loader", "tsx", MCP_SERVER_SRC_PATH] : [MCP_SERVER_PATH],
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
    const child = spawn(params.command, params.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: ROOT_DIR,
      env: process.env,
    });

    const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);

    const onData = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
      if (stdout.length > maxOutputBytes || stderr.length > maxOutputBytes) {
        child.kill("SIGKILL");
      }
    };

    child.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk));

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        reject(
          new Error(
            `LLM command failed (exit ${code}).\n\nstderr:\n${stderr.toString("utf8").trim()}`
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
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);
  try {
    const base = params.baseUrl.replace(/\/+$/, "");
    const url = `${base}/v1/chat/completions`;
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
      throw new Error("OpenAI-compatible response missing choices[0].message.content");
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
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);
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
    throw new Error(`Missing built MCP server at ${MCP_SERVER_PATH}. Run: npm run build`);
  }

  const mcp = createMcpClient();

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

      if (method === "GET" && url.pathname === "/api/health") {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/prompts") {
        const result = await mcp.request((c) => c.listPrompts());
        json(res, 200, result as unknown as JsonRecord);
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
        const mode = asString(body.mode);
        const totalSeconds = Number(asString(body.duration_seconds));
        const partSeconds = Number(asString(body.part_length_seconds));
        if (
          Number.isFinite(partSeconds) &&
          Number.isFinite(totalSeconds) &&
          partSeconds >= totalSeconds
        ) {
          json(res, 400, { ok: false, error: "Part length must be less than total duration." });
          return;
        }
        const rawImages = Array.isArray(body.images) ? body.images : [];
        const images = rawImages.filter((img) => img && typeof img === "object") as JsonRecord[];
        const uploadedFiles: string[] = [];

        if (images.length > 0 && provider !== "command") {
          json(res, 400, { ok: false, error: "Images are only supported with Codex CLI." });
          return;
        }

        const promptTemplate = await mcp.request((c) =>
          c.getPrompt({
            name: "structured_video_prompt",
            arguments: {
              story,
              ...(mode ? { mode } : {}),
              ...(asString(body.duration_seconds) ? { duration_seconds: asString(body.duration_seconds)! } : {}),
              ...(asString(body.part_length_seconds)
                ? { part_length_seconds: asString(body.part_length_seconds)! }
                : {}),
              ...(asString(body.resolution) ? { resolution: asString(body.resolution)! } : {}),
              ...(asString(body.aspect_ratio) ? { aspect_ratio: asString(body.aspect_ratio)! } : {}),
              ...(asString(body.style) ? { style: asString(body.style)! } : {}),
              ...(asString(body.camera) ? { camera: asString(body.camera)! } : {}),
              ...(asString(body.lighting) ? { lighting: asString(body.lighting)! } : {}),
              ...(asString(body.quality) ? { quality: asString(body.quality)! } : {}),
              ...(asString(body.action_beats) ? { action_beats: asString(body.action_beats)! } : {}),
              ...(asString(body.audio) ? { audio: asString(body.audio)! } : {}),
            },
          })
        );

        const first = (promptTemplate as any)?.messages?.[0]?.content;
        const templateText =
          first && first.type === "text" && typeof first.text === "string" ? first.text : "";
        if (!templateText) {
          json(res, 500, { ok: false, error: "Failed to build prompt template" });
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
          const args = Array.isArray(body.args) ? body.args.filter((v) => typeof v === "string") : [];
          if (!command) {
            json(res, 400, { ok: false, error: "Missing command for provider=command" });
            return;
          }
          if (args.length > 0) {
            json(res, 400, { ok: false, error: "Args are disabled for security." });
            return;
          }
          if (images.length > 0 && command !== "codex") {
            json(res, 400, { ok: false, error: "Images are only supported with Codex CLI." });
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
                  json(res, 400, { ok: false, error: "Total image size exceeds 10MB." });
                  return;
                }
                const filename = `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}${extensionForMime(
                  mime
                )}`;
                const filePath = path.join(uploadDir, filename);
                await fs.writeFile(filePath, buffer);
                uploadedFiles.push(filePath);
              }
            }

            const codexModel = asString(body.codex_model);
            const codexSession = asString(body.codex_session) ?? "new";
            const effectiveArgs =
              command === "codex" ? buildCodexArgs(codexModel, codexSession, uploadedFiles) : [];

            const out = await runCommandLlm({ command, args: effectiveArgs, input: instruction });
            json(res, 200, { ok: true, mode: "generated", text: out });
            return;
          } finally {
            await Promise.all(uploadedFiles.map((file) => fs.unlink(file).catch(() => undefined)));
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
          const baseUrl = asString(body.base_url) ?? "http://127.0.0.1:11434";
          const model = asString(body.model) ?? "";
          if (!model) {
            json(res, 400, { ok: false, error: "Missing model for provider=ollama" });
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
          const baseUrl = asString(body.base_url) ?? "";
          const model = asString(body.model) ?? "";
          const apiKey = asString(body.api_key);
          if (!baseUrl) {
            json(res, 400, { ok: false, error: "Missing base_url for provider=openai_compatible" });
            return;
          }
          if (!model) {
            json(res, 400, { ok: false, error: "Missing model for provider=openai_compatible" });
            return;
          }
          const out = await runOpenAiCompatible({ baseUrl, model, apiKey, prompt: instruction });
          json(res, 200, { ok: true, mode: "generated", text: out });
          return;
        }

        json(res, 400, { ok: false, error: `Unknown provider: ${provider}` });
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
        const images = rawImages.filter((img) => img && typeof img === "object") as JsonRecord[];
        const uploadedFiles: string[] = [];

        if (provider === "none") {
          json(res, 400, { ok: false, error: "Provider is set to template only" });
          return;
        }

        if (images.length > 0 && provider !== "command") {
          json(res, 400, { ok: false, error: "Images are only supported with Codex CLI." });
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
          const args = Array.isArray(body.args) ? body.args.filter((v) => typeof v === "string") : [];
          if (!command) {
            json(res, 400, { ok: false, error: "Missing command for provider=command" });
            return;
          }
          if (args.length > 0) {
            json(res, 400, { ok: false, error: "Args are disabled for security." });
            return;
          }

          if (images.length > 0 && command !== "codex") {
            json(res, 400, { ok: false, error: "Images are only supported with Codex CLI." });
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
                  json(res, 400, { ok: false, error: "Total image size exceeds 10MB." });
                  return;
                }
                const filename = `chat-${Date.now()}-${Math.random().toString(16).slice(2)}${extensionForMime(
                  mime
                )}`;
                const filePath = path.join(uploadDir, filename);
                await fs.writeFile(filePath, buffer);
                uploadedFiles.push(filePath);
              }
            }

            const codexModel = asString(body.codex_model);
            const codexSession = asString(body.codex_session) ?? "new";
            const effectiveArgs =
              command === "codex" ? buildCodexArgs(codexModel, codexSession, uploadedFiles) : [];

            const out = await runCommandLlm({ command, args: effectiveArgs, input: prompt });
            json(res, 200, { ok: true, mode: "chat", text: out });
            return;
          } finally {
            await Promise.all(uploadedFiles.map((file) => fs.unlink(file).catch(() => undefined)));
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
            json(res, 400, { ok: false, error: "Missing base_url for provider=ollama" });
            return;
          }
          if (!model) {
            json(res, 400, { ok: false, error: "Missing model for provider=ollama" });
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
            json(res, 400, { ok: false, error: "Missing base_url for provider=openai_compatible" });
            return;
          }
          if (!model) {
            json(res, 400, { ok: false, error: "Missing model for provider=openai_compatible" });
            return;
          }
          const out = await runOpenAiCompatible({ baseUrl, model, apiKey, prompt });
          json(res, 200, { ok: true, mode: "chat", text: out });
          return;
        }

        json(res, 400, { ok: false, error: `Unknown provider: ${provider}` });
        return;
      }

      if (method === "GET" && url.pathname === "/api/tools") {
        const result = await mcp.request((c) => c.listTools());
        json(res, 200, result as unknown as JsonRecord);
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
      res.writeHead(200, { "content-type": contentTypeFor(filePath), "cache-control": "no-store" });
      res.end(content);
    } catch (error) {
      json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

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
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EPERM") {
      throw new Error(
        [
          `Cannot listen on http://${HOST}:${PORT} (EPERM).`,
          "This usually means your environment blocks binding to local TCP ports (sandbox/restrictions).",
          "Try running from a normal terminal session, or pick a different port:",
          "  PORT=8080 npm run gui",
          "",
          `Original error: ${message}`,
        ].join("\n")
      );
    }
    throw new Error(`Failed to start GUI server on http://${HOST}:${PORT}: ${message}`);
  }
  // eslint-disable-next-line no-console
  const address = server.address();
  const boundPort =
    address && typeof address === "object" && "port" in address ? Number(address.port) : PORT;
  console.log(`GUI running: http://${HOST}:${boundPort}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
