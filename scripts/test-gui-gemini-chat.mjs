import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson({ port, method, path, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status} ${method} ${path}\n${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response for ${method} ${path}\n${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createGeminiShim() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-cli-"));
  const scriptPath = path.join(dir, "gemini.mjs");
  const wrapperPath = path.join(dir, "gemini");
  const script = [
    'import fs from "node:fs";',
    "const input = fs.readFileSync(0, \"utf8\");",
    "const args = process.argv.slice(2);",
    "let model = \"\";",
    "for (let i = 0; i < args.length; i++) {",
    "  if (args[i] === \"--model\" && args[i + 1]) {",
    "    model = args[i + 1];",
    "  }",
    "}",
    "const text = `ok model=${model}\\n${input}`.trim();",
    "process.stdout.write(text);",
    "",
  ].join("\n");
  await fs.writeFile(scriptPath, script);
  const wrapper = `#!/usr/bin/env sh\nnode "${scriptPath}" "$@"\n`;
  await fs.writeFile(wrapperPath, wrapper);
  await fs.chmod(wrapperPath, 0o755);
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const shim = await createGeminiShim();
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "0",
    ENABLE_COMMAND_LLM: "1",
    PATH: `${shim.dir}:${process.env.PATH || ""}`,
  };
  const child = spawn("node", ["dist/gui/server.js"], {
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));

  const startDeadline = Date.now() + 5000;
  let port = null;
  while (Date.now() < startDeadline) {
    const match = stdout.match(/GUI running: http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      port = Number(match[1]);
      break;
    }
    if (child.exitCode !== null) break;
    await wait(50);
  }

  let skipReason = null;
  if (!port && child.exitCode !== null) {
    const epmatch = /Cannot listen on .* \(EPERM\)/i.test(stderr) || /listen EPERM/i.test(stderr);
    if (epmatch) {
      skipReason = stderr.trim();
    }
  }

  try {
    if (skipReason) {
      console.log("GUI gemini chat test: SKIPPED (environment prevents binding to localhost).");
      console.log(skipReason);
      return;
    }
    assert(port && Number.isFinite(port), `GUI did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

    const chat = await httpJson({
      port,
      method: "POST",
      path: "/api/chat",
      body: JSON.stringify({
        provider: "command",
        command: "gemini",
        gemini_model: "gemini-2.5-pro",
        prompt: "hello gemini",
      }),
    });
    assert(chat.ok === true, "Expected /api/chat ok=true for gemini CLI");
    assert(
      typeof chat.text === "string" && chat.text.includes("model=gemini-2.5-pro"),
      "Expected gemini model to be passed as --model"
    );
    assert(typeof chat.text === "string" && chat.text.includes("hello gemini"), "Expected prompt echoed back");

    console.log("GUI gemini chat test: OK");
  } finally {
    child.kill("SIGTERM");
    await shim.cleanup();
  }
}

main().catch((err) => {
  console.error("GUI gemini chat test: FAILED");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
