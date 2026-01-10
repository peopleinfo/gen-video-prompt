import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import pdf from "pdf-parse";

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");

function normalizeSnippet(input, maxLen) {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

async function listDocPaths() {
  return fg(["**/*.md", "**/*.pdf", "**/*.txt"], {
    cwd: DATA_DIR,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  });
}

async function getMarkdownTitleAndInfo(absPath) {
  const content = await fs.readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);
  const heading = lines.find((line) => line.trim().startsWith("#"));
  const title = heading
    ? heading.replace(/^#+\s*/, "").trim()
    : path.basename(absPath, ".md");
  const snippetSource = lines
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .join(" ");
  const info = normalizeSnippet(snippetSource || content, 240) || "Markdown document.";
  return { title, info };
}

async function getTextTitleAndInfo(absPath) {
  const content = await fs.readFile(absPath, "utf8");
  const title = path.basename(absPath, ".txt");
  const info = normalizeSnippet(content, 240) || "Text document.";
  return { title, info };
}

async function getPdfInfo(absPath) {
  const stat = await fs.stat(absPath);
  const sizeKb = Math.max(1, Math.round(stat.size / 1024));
  const title = path.basename(absPath, ".pdf");
  const info = `PDF document, ${sizeKb} KB.`;
  return { title, info };
}

async function getDocInfo(id) {
  const absPath = path.join(DATA_DIR, id);
  const ext = path.extname(id).toLowerCase();
  const type = ext === ".pdf" ? "pdf" : ext === ".txt" ? "text" : "markdown";
  const meta =
    type === "markdown"
      ? await getMarkdownTitleAndInfo(absPath)
      : type === "text"
        ? await getTextTitleAndInfo(absPath)
        : await getPdfInfo(absPath);
  return {
    id,
    absPath,
    type,
    title: meta.title,
    info: meta.info,
  };
}

async function getPdfText(absPath) {
  const data = await fs.readFile(absPath);
  const parsed = await pdf(data);
  return parsed.text?.trim() || "";
}

async function getDocContent(doc) {
  if (doc.type === "markdown" || doc.type === "text") {
    return fs.readFile(doc.absPath, "utf8");
  }
  return getPdfText(doc.absPath);
}

function pickDoc(docs, query) {
  if (!docs.length) {
    return null;
  }
  if (!query) {
    return docs[0];
  }
  const needle = query.toLowerCase();
  return (
    docs.find((doc) =>
      `${doc.title} ${doc.info} ${doc.id}`.toLowerCase().includes(needle)
    ) ?? docs[0]
  );
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim() || "nature landscape";
  const paths = await listDocPaths();
  const docs = await Promise.all(paths.map((id) => getDocInfo(id)));
  docs.sort((a, b) => a.title.localeCompare(b.title));

  const picked = pickDoc(docs, query);
  if (!picked) {
    console.log("No documents found in data/.");
    return;
  }

  const content = await getDocContent(picked);
  const snippet = content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 12)
    .join("\n");

  console.log(`Query: ${query}`);
  console.log(`Picked: ${picked.title} (${picked.id})`);
  console.log(`Documents available: ${docs.length}`);
  console.log("Sample content:");
  console.log(snippet || "(empty)");
}

main().catch((error) => {
  console.error("Test script error:", error);
  process.exit(1);
});
