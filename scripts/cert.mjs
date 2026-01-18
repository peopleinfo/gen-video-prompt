import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const certDir = join("tmp", "certs");
const keyPath = join(certDir, "gui.key.pem");
const certPath = join(certDir, "gui.cert.pem");

await mkdir(certDir, { recursive: true });

const args = [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-days",
  "365",
  "-subj",
  "/CN=localhost",
];

const child = spawn("openssl", args, { stdio: "inherit" });

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error("openssl not found in PATH. Install OpenSSL and retry.");
  } else {
    console.error(`Failed to run openssl: ${error.message}`);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
});
