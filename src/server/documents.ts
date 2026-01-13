import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import pdf from "pdf-parse";

import { DATA_DIR, DOC_SCHEME } from "./config.js";
import type { DocInfo, DocType } from "./types.js";

const PDF_CACHE = new Map<string, string>();

function normalizeSnippet(input: string, maxLen: number): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

async function listDocPaths(): Promise<string[]> {
  return fg(["**/*.md", "**/*.pdf", "**/*.txt"], {
    cwd: DATA_DIR,
    dot: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  });
}

async function getMarkdownTitleAndInfo(absPath: string): Promise<{ title: string; info: string }> {
  const content = await fs.readFile(absPath, "utf8");
  const lines = content.split(/\r?\n/);
  const heading = lines.find((line: string) => line.trim().startsWith("#"));
  const title = heading ? heading.replace(/^#+\s*/, "").trim() : path.basename(absPath, ".md");
  const snippetSource = lines
    .filter((line: string) => line.trim() && !line.trim().startsWith("#"))
    .join(" ");
  const info = normalizeSnippet(snippetSource || content, 240) || "Markdown document.";
  return { title, info };
}

async function getTextTitleAndInfo(absPath: string): Promise<{ title: string; info: string }> {
  const content = await fs.readFile(absPath, "utf8");
  const title = path.basename(absPath, ".txt");
  const info = normalizeSnippet(content, 240) || "Text document.";
  return { title, info };
}

async function getPdfInfo(absPath: string): Promise<{ title: string; info: string }> {
  const stat = await fs.stat(absPath);
  const sizeKb = Math.max(1, Math.round(stat.size / 1024));
  const title = path.basename(absPath, ".pdf");
  const info = `PDF document, ${sizeKb} KB.`;
  return { title, info };
}

async function getPdfText(absPath: string): Promise<string> {
  const cached = PDF_CACHE.get(absPath);
  if (cached) {
    return cached;
  }
  const data = await fs.readFile(absPath);
  const parsed = await pdf(data);
  const text = parsed.text?.trim() || "";
  PDF_CACHE.set(absPath, text);
  return text;
}

export function toDocUri(id: string): string {
  return `${DOC_SCHEME}${encodeURIComponent(id)}`;
}

export function fromDocUri(uri: string): string | null {
  if (!uri.startsWith(DOC_SCHEME)) {
    return null;
  }
  const encoded = uri.slice(DOC_SCHEME.length);
  return decodeURIComponent(encoded);
}

export async function getDocInfo(id: string): Promise<DocInfo> {
  const absPath = path.join(DATA_DIR, id);
  const ext = path.extname(id).toLowerCase();
  const type: DocType =
    ext === ".pdf" ? "pdf" : ext === ".txt" ? "text" : "markdown";
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

export async function listDocs(): Promise<DocInfo[]> {
  const paths = await listDocPaths();
  const docs = await Promise.all(paths.map((id) => getDocInfo(id)));
  return docs.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getDocContent(doc: DocInfo): Promise<string> {
  if (doc.type === "markdown" || doc.type === "text") {
    return fs.readFile(doc.absPath, "utf8");
  }
  return getPdfText(doc.absPath);
}
