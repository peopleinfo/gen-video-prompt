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
import {
  CATEGORY_PROMPT_ARGUMENTS,
  CATEGORY_PROMPT_DESCRIPTION,
  CATEGORY_PROMPT_NAME,
  CATEGORY_PROMPT_TEMPLATE,
  CATEGORY_PROMPT_TITLE,
  PROMPT_ARGUMENTS,
  PROMPT_DESCRIPTION,
  PROMPT_NAME,
  PROMPT_TEMPLATE,
  PROMPT_TITLE,
  SYSTEM_PROMPT,
} from "./server/config.js";
import {
  fromDocUri,
  getDocContent,
  getDocInfo,
  listDocs,
  toDocUri,
} from "./server/documents.js";
import {
  getPromptArg,
  getPromptMode,
  getStorytellingGuidance,
  looksLikeCategoryRequest,
  renderPromptTemplate,
} from "./server/prompt.js";

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
        part_length_seconds: getPromptArg(args, "part_length_seconds"),
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
