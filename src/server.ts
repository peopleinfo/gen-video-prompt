import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import pdf from "pdf-parse";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type DocType = "markdown" | "pdf" | "text";
type PromptMode = "auto" | "story" | "meme";

type DocInfo = {
  id: string;
  absPath: string;
  type: DocType;
  title: string;
  info: string;
};

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const DOC_SCHEME = "doc://";
const PDF_CACHE = new Map<string, string>();
const SYSTEM_PROMPT = `
You are a Sora 2 prompt specialist. Use the local prompt guides and produce clear, cinematic video prompts.

Core approach:
- Follow the Five Pillars: subject and character, action and motion, environment and setting, cinematic framing, aesthetic and style.
- Treat Sora as a world simulator: describe physical interactions, materials, light, and motion so the scene is internally consistent.
- Use concrete verbs and visible outcomes. Avoid vague adjectives without visual anchors.
- Default to storytelling: include a clear narrative arc (hook → escalation → payoff) even for short clips, unless the user explicitly asks for something else.
- If the user requests "meme", "funny", "comedy", or "viral", prioritize a fast hook (first 1–2s), a surprising visual twist, and a highly memeable moment that could be captioned.

Output format when drafting a prompt:
1) Prompt: one cohesive paragraph describing the scene.
2) Style: aesthetic, mood, palette, film stock or realism level.
3) Camera: lens, framing, movement, and shot scale.
4) Lighting: key source, time of day, practicals, atmosphere.
5) Action beats: short timeline or beat list for the clip.
6) Quality: resolution, fps, and technical quality notes.
7) Audio (optional): diegetic sound cues if relevant.

Notes:
- Resolution and duration are API parameters. Include recommended values but do not claim they are controlled by text alone.
- Supported durations: 4, 8, 12 seconds (default 4). Resolutions: 1280x720 or 720x1280; Sora 2 Pro also supports 1024x1792 and 1792x1024.
- If the user asks for multiple shots, keep each shot block independent.
`.trim();

const PROMPT_TEMPLATE = `
Create a Sora 2 video prompt from the brief below. Follow the Five Pillars and world-simulator approach.
Use concrete verbs and visible outcomes. If details are missing, add plausible specifics that support the story.

Storytelling / virality guidance:
{{storytelling_guidance}}

Brief:
{{story}}

Include any user constraints:
- Duration (API param): {{duration_seconds}}
- Resolution (API param): {{resolution}}
- Aspect ratio: {{aspect_ratio}}
- Style: {{style}}
- Camera: {{camera}}
- Lighting: {{lighting}}
- Quality: {{quality}}
- Action beats: {{action_beats}}
- Audio: {{audio}}

Output format:
Prompt: one cohesive paragraph describing the scene.
Style: aesthetic, mood, palette, film stock or realism level.
Camera: lens, framing, movement, and shot scale.
Lighting: key source, time of day, practicals, atmosphere.
Action beats: short timeline or beat list for the clip.
Quality: resolution, fps, and technical quality notes.
Audio (optional): diegetic sound cues if relevant.
`.trim();

const PROMPT_NAME = "structured_video_prompt";
const PROMPT_TITLE = "Structured Sora 2 video prompt";
const PROMPT_DESCRIPTION =
  "Generate a cinematic Sora 2 prompt with structured sections (style, camera, lighting, action beats, quality).";

const CATEGORY_PROMPT_NAME = "video_category_suggestion";
const CATEGORY_PROMPT_TITLE = "Video category suggestion";
const CATEGORY_PROMPT_DESCRIPTION =
  "Suggest a popular video category phrased like: 'popular funny videos in USA'.";
const CATEGORY_PROMPT_TEMPLATE = `
The user is asking for video categories (not a Sora prompt).

Task:
- Suggest 1 concise category phrase (NOT a list).
- Use the format: "popular <category> videos in <region>".
- If region is missing, default to USA.
- If the user's preference is unclear, default to "funny".

User request:
{{story}}

Return only the phrase.
`.trim();

const PROMPT_ARGUMENTS = [
  {
    name: "story",
    description: "Short brief or story for the clip.",
    required: true,
  },
  {
    name: "mode",
    description:
      "Prompt mode override: auto (default), story (storytelling), meme (funny/viral/meme).",
  },
  {
    name: "duration_seconds",
    description: "Preferred duration; recommended values are 4, 8, or 12.",
  },
  {
    name: "resolution",
    description: "Preferred resolution (e.g. 1280x720, 720x1280).",
  },
  {
    name: "aspect_ratio",
    description: "Aspect ratio or orientation (e.g. 16:9 landscape).",
  },
  {
    name: "style",
    description: "Aesthetic style or references (e.g. cinematic realism, 65mm).",
  },
  {
    name: "camera",
    description: "Lens, framing, movement, shot scale.",
  },
  {
    name: "lighting",
    description: "Time of day, key light direction, practicals, atmosphere.",
  },
  {
    name: "quality",
    description: "fps, shutter, grain, compression, realism level.",
  },
  {
    name: "action_beats",
    description: "Timeline of actions or beats for the clip.",
  },
  {
    name: "audio",
    description: "Diegetic sound cues or audio notes.",
  },
];

const CATEGORY_PROMPT_ARGUMENTS = [
  {
    name: "story",
    description: "User request, e.g. 'give me categories of videos a user likes'.",
    required: true,
  },
];

function renderPromptTemplate(
  template: string,
  args: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = args[key];
    return value && value.trim() ? value.trim() : "(unspecified)";
  });
}

function getPromptArg(
  args: Record<string, string> | undefined,
  key: string
): string | undefined {
  const value = args?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toDocUri(id: string): string {
  return `${DOC_SCHEME}${encodeURIComponent(id)}`;
}

function fromDocUri(uri: string): string | null {
  if (!uri.startsWith(DOC_SCHEME)) {
    return null;
  }
  const encoded = uri.slice(DOC_SCHEME.length);
  return decodeURIComponent(encoded);
}

function normalizeSnippet(input: string, maxLen: number): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function looksLikeCategoryRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(category|categories|genre|type of (video|videos)|what (kind|type) of (video|videos))\b/.test(
    cleaned
  );
}

function looksLikeMemeOrFunnyRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(meme|memes|funny|comedy|comedic|humor|humour|viral)\b/.test(cleaned);
}

function getPromptMode(story: string, rawMode?: string): PromptMode {
  const cleaned = (rawMode ?? "").trim().toLowerCase();
  if (cleaned === "story" || cleaned === "storytelling") return "story";
  if (cleaned === "meme" || cleaned === "funny" || cleaned === "viral") return "meme";
  if (cleaned === "auto" || cleaned === "") return "auto";
  return looksLikeMemeOrFunnyRequest(story) ? "meme" : "auto";
}

function getStorytellingGuidance(story: string, mode: PromptMode): string {
  const effectiveMode = mode === "auto" ? (looksLikeMemeOrFunnyRequest(story) ? "meme" : "story") : mode;
  if (effectiveMode === "meme") {
    return [
      "- Make it meme-first: immediate hook in the first 1–2 seconds.",
      "- Build a simple setup → twist → punchline/payoff that reads without dialogue.",
      "- Include 1 clear 'freeze-frame' meme moment (strong silhouette/pose/reaction) suitable for captions.",
      "- Keep beats readable: exaggerate reactions, visual contrast, and timing.",
      "- End on a loopable final beat (clean cut back to the opening vibe).",
    ].join("\n");
  }

  return [
    "- Default to storytelling: hook → escalation → payoff within the duration.",
    "- Establish stakes and intent quickly through visible actions and consequences.",
    "- Give the scene a clear turning point (reveal, discovery, change in environment).",
    "- End with a satisfying resolution or cliffhanger that invites replay.",
  ].join("\n");
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

async function getDocInfo(id: string): Promise<DocInfo> {
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

async function listDocs(): Promise<DocInfo[]> {
  const paths = await listDocPaths();
  const docs = await Promise.all(paths.map((id) => getDocInfo(id)));
  return docs.sort((a, b) => a.title.localeCompare(b.title));
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

async function getDocContent(doc: DocInfo): Promise<string> {
  if (doc.type === "markdown" || doc.type === "text") {
    return fs.readFile(doc.absPath, "utf8");
  }
  return getPdfText(doc.absPath);
}

const server = new Server(
  {
    name: "sora2-prompt-docs",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    instructions: SYSTEM_PROMPT,
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_documents",
        description:
          "List all local prompt documents with title, type, and brief info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "get_document",
        description:
          "Get full content for a document by id (from list_documents).",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Document id (relative path).",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
      },
    ],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: PROMPT_NAME,
        title: PROMPT_TITLE,
        description: PROMPT_DESCRIPTION,
        arguments: PROMPT_ARGUMENTS,
      },
      {
        name: CATEGORY_PROMPT_NAME,
        title: CATEGORY_PROMPT_TITLE,
        description: CATEGORY_PROMPT_DESCRIPTION,
        arguments: CATEGORY_PROMPT_ARGUMENTS,
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== PROMPT_NAME && name !== CATEGORY_PROMPT_NAME) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const story = getPromptArg(args, "story") ?? "";
  if (!story) {
    throw new Error("Missing prompt argument: story");
  }

  const mode = getPromptMode(story, getPromptArg(args, "mode"));
  const shouldSuggestCategory =
    name === CATEGORY_PROMPT_NAME || (name === PROMPT_NAME && looksLikeCategoryRequest(story));

  const promptText = shouldSuggestCategory
    ? renderPromptTemplate(CATEGORY_PROMPT_TEMPLATE, { story })
    : renderPromptTemplate(PROMPT_TEMPLATE, {
        story,
        storytelling_guidance: getStorytellingGuidance(story, mode),
        duration_seconds: getPromptArg(args, "duration_seconds"),
        resolution: getPromptArg(args, "resolution") ?? "1920x1080",
        aspect_ratio: getPromptArg(args, "aspect_ratio") ?? "9:16 portrait",
        style: getPromptArg(args, "style"),
        camera: getPromptArg(args, "camera"),
        lighting: getPromptArg(args, "lighting"),
        quality: getPromptArg(args, "quality"),
        action_beats: getPromptArg(args, "action_beats"),
        audio: getPromptArg(args, "audio"),
      });

  return {
    description: shouldSuggestCategory ? CATEGORY_PROMPT_DESCRIPTION : PROMPT_DESCRIPTION,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: promptText,
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_documents") {
    const docs = await listDocs();
    const result = docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      info: doc.info,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "get_document") {
    const id = typeof args?.id === "string" ? args.id : "";
    if (!id) {
      throw new Error("Missing document id.");
    }
    const doc = await getDocInfo(id);
    const content = await getDocContent(doc);
    const payload = {
      id: doc.id,
      title: doc.title,
      type: doc.type,
      content,
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const docs = await listDocs();
  return {
    resources: docs.map((doc) => ({
      uri: toDocUri(doc.id),
      name: doc.title,
      description: `${doc.type}: ${doc.info}`,
      mimeType:
        doc.type === "markdown"
          ? "text/markdown"
          : doc.type === "text"
            ? "text/plain"
            : "application/pdf",
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const id = fromDocUri(request.params.uri);
  if (!id) {
    throw new Error(`Unsupported resource URI: ${request.params.uri}`);
  }
  const doc = await getDocInfo(id);
  const content = await getDocContent(doc);
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType:
          doc.type === "markdown"
            ? "text/markdown"
            : "text/plain",
        text: content,
      },
    ],
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
