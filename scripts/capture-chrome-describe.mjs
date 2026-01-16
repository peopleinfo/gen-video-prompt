import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { clipboard, Key, keyboard, mouse, Point } from "@nut-tree-fork/nut-js";

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pasteResponseIntoPopup(text) {
  const fallbackText = "cat funny random";
  const finalText = text && text.trim() ? text : fallbackText;
  const inputPoint = new Point(538, 311);
  const buttonPoint = new Point(892, 365);

  await mouse.setPosition(inputPoint);
  await sleep(800);
  await mouse.click();
  await sleep(2000);
  await clipboard.setContent(finalText);
  await sleep(800);
  await mouse.setPosition(buttonPoint);
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
            reject(
              new Error(
                `Invalid JSON response for ${method} ${reqPath}\n${data}`
              )
            );
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
  const url = process.env.TARGET_URL || "https://chatgpt.com/";
  const delayMs = Number(process.env.CAPTURE_DELAY_MS || "2500");
  const port = Number(process.env.PORT || "3333");
  const keepCapture = process.env.KEEP_CAPTURE === "1";
  const region = process.env.CAPTURE_REGION || "";
  const widthRatio = Number(process.env.WIDTH_RATIO || "0.6");

  // const capturePath =
  //   process.env.CAPTURE_PATH ||
  //   path.join(process.cwd(), "tmp", `chrome-capture-${Date.now()}.png`);
  // fs.mkdirSync(path.dirname(capturePath), { recursive: true });

  const applescript = [
    'tell application "Finder" to set b to bounds of window of desktop',
    "set screenWidth to item 3 of b",
    "set screenHeight to item 4 of b",
    `set windowWidth to (screenWidth * ${widthRatio}) as integer`,
    "set leftEdge to ((screenWidth - windowWidth) / 2) as integer",
    "set rightEdge to (leftEdge + windowWidth) as integer",
    'tell application "Google Chrome"',
    "activate",
    "make new window",
    "set bounds of front window to {leftEdge, 0, rightEdge, screenHeight}",
    'set URL of active tab of front window to "' + url + '"',
    "end tell",
  ].join("\n");

  await run("osascript", ["-e", applescript]);
  await sleep(delayMs);

  // const captureArgs = ["-x"];
  // if (region) captureArgs.push("-R", region);
  // captureArgs.push(capturePath);
  // await run("screencapture", captureArgs);

  // const data = fs.readFileSync(capturePath);
  // const images = [
  //   {
  //     name: path.basename(capturePath),
  //     type: "image/png",
  //     data: data.toString("base64"),
  //   },
  // ];
  // const images = [];

  // const payload = {
  //   prompt: "Generate cat random funny",
  //   provider: "command",
  //   command: "codex",
  //   codex_session: process.env.CODEX_SESSION || "new",
  //   ...(process.env.CODEX_MODEL
  //     ? { codex_model: process.env.CODEX_MODEL }
  //     : {}),
  //   images,
  // };

  // const res = await httpJson({
  //   port,
  //   method: "POST",
  //   path: "/api/chat",
  //   body: JSON.stringify(payload),
  // });

  // if (!res || res.ok !== true) {
  //   throw new Error(`Unexpected response: ${JSON.stringify(res, null, 2)}`);
  // }

  // console.log(res.text || "(empty response)");
  console.log("Wait for response...");
  await sleep(10000);
  await pasteResponseIntoPopup("generate cat random funny");

  // if (!keepCapture) {
  //   fs.unlinkSync(capturePath);
  // } else {
  //   console.log(`Saved capture: ${capturePath}`);
  // }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
