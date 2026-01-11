import fs from "node:fs";
import http from "node:http";
import path from "node:path";

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function httpJson({ port, method, path: reqPath, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: reqPath,
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
            reject(new Error(`HTTP ${status} ${method} ${reqPath}\n${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response for ${method} ${reqPath}\n${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const filePath = process.argv[2] || process.env.IMAGE_PATH;
  if (!filePath) {
    console.error("Usage: node scripts/test-gui-codex-image.mjs /path/to/image");
    console.error("Or set IMAGE_PATH=/path/to/image");
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  const data = fs.readFileSync(absPath);
  const maxBytes = 10 * 1024 * 1024;
  if (data.length > maxBytes) {
    throw new Error("Image exceeds 10MB total size limit.");
  }

  const port = Number(process.env.PORT ?? "3333");
  const body = {
    prompt: "Describe this image in one sentence.",
    provider: "command",
    command: "codex",
    codex_session: process.env.CODEX_SESSION ?? "new",
    ...(process.env.CODEX_MODEL ? { codex_model: process.env.CODEX_MODEL } : {}),
    images: [
      {
        name: path.basename(absPath),
        type: mimeFor(absPath),
        data: data.toString("base64"),
      },
    ],
  };

  const res = await httpJson({
    port,
    method: "POST",
    path: "/api/chat",
    body: JSON.stringify(body),
  });

  if (!res || res.ok !== true) {
    throw new Error(`Unexpected response: ${JSON.stringify(res, null, 2)}`);
  }
  console.log(res.text || "(empty response)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
