import http from "node:http";
import { spawn } from "node:child_process";

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

async function main() {
  const env = { ...process.env, HOST: "127.0.0.1", PORT: "0" };
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

  try {
    assert(port && Number.isFinite(port), `GUI did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);

    const health = await httpJson({ port, method: "GET", path: "/api/health" });
    assert(health.ok === true, "Expected /api/health ok=true");

    const prompts = await httpJson({ port, method: "GET", path: "/api/prompts" });
    const promptNames = (prompts.prompts ?? []).map((p) => p.name);
    assert(promptNames.includes("structured_video_prompt"), "Missing structured_video_prompt in /api/prompts");

    const promptResult = await httpJson({
      port,
      method: "POST",
      path: "/api/prompts/get",
      body: JSON.stringify({
        name: "structured_video_prompt",
        arguments: {
          mode: "meme",
          story: "Make a funny meme video about a cat trying to act serious in the rain; viral.",
          duration_seconds: "8",
        },
      }),
    });

    const first = promptResult.messages?.[0]?.content;
    const text = first?.type === "text" ? first.text : "";
    assert(typeof text === "string" && text.length > 0, "Expected prompt text in prompts/get result");
    assert(text.includes("Storytelling / virality guidance:"), "Expected guidance block in prompt template");
    assert(text.includes("meme-first"), "Expected meme-first guidance for meme/funny/viral request");
    assert(text.includes("Resolution (API param): 1920x1080"), "Expected default resolution 1920x1080");

    const generateBlocked = await httpJson({
      port,
      method: "POST",
      path: "/api/generate",
      body: JSON.stringify({
        provider: "command",
        command: "echo",
        args: ["hi"],
        story: "test",
      }),
    }).then(
      () => ({ ok: true }),
      (err) => ({ ok: false, err })
    );
    assert(generateBlocked.ok === false, "Expected /api/generate provider=command to be blocked without ENABLE_COMMAND_LLM=1");

    const generateHttpBlocked = await httpJson({
      port,
      method: "POST",
      path: "/api/generate",
      body: JSON.stringify({
        provider: "ollama",
        base_url: "http://127.0.0.1:11434",
        model: "llama3",
        story: "test",
      }),
    }).then(
      () => ({ ok: true }),
      (err) => ({ ok: false, err })
    );
    assert(generateHttpBlocked.ok === false, "Expected /api/generate provider=ollama to be blocked without ENABLE_HTTP_LLM=1");

    console.log("GUI smoke test: OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("GUI smoke test: FAILED");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
