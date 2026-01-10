import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type DocSummary = {
  id: string;
  title: string;
  type: string;
  info: string;
};

type DocPayload = {
  id: string;
  title: string;
  type: string;
  content: string;
};

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function pickDoc(docs: DocSummary[], query: string): DocSummary | null {
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const promptIndex = args.indexOf("--prompt");
  const promptMode = promptIndex !== -1;
  const query = promptMode
    ? ""
    : args.join(" ").trim() || "nature landscape";
  const promptStory = promptMode
    ? args.slice(promptIndex + 1).join(" ").trim()
    : "";

  const client = new Client({ name: "local-test-client", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  });

  transport.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  await client.connect(transport);

  if (promptMode) {
    const story =
      promptStory ||
      "A sad 15-second story of a stray cat waiting at a bus stop in the rain.";
    const promptsResult = await client.listPrompts();
    const promptName =
      promptsResult.prompts.find((prompt) => prompt.name === "structured_video_prompt")
        ?.name ?? promptsResult.prompts[0]?.name;

    if (!promptName) {
      console.log("No prompts available.");
      await client.close();
      return;
    }

    const promptResult = await client.getPrompt({
      name: promptName,
      arguments: {
        story,
        duration_seconds: "15",
        resolution: "1280x720",
        aspect_ratio: "16:9",
        style: "cinematic realism, muted palette",
        camera: "35mm lens, slow push-in, gentle handheld",
        lighting: "streetlight practicals, soft rain haze",
        quality: "4K, 24fps, clean compression",
        action_beats: "0-5s wait + buses pass, 5-10s curl up, 10-15s ribbon slips",
        audio: "light rain, distant traffic, bus hiss",
      },
    });

    const promptMessage = promptResult.messages[0]?.content;
    if (promptMessage?.type === "text") {
      console.log(`Prompt name: ${promptName}`);
      console.log(promptMessage.text);
    } else {
      console.log(`Prompt name: ${promptName}`);
      console.log("Prompt returned non-text content.");
    }

    await client.close();
    return;
  }

  await client.listTools();
  const docsResult = await client.callTool({
    name: "list_documents",
    arguments: {},
  });

  const docsText = docsResult.content?.[0]?.text ?? "[]";
  const docs = safeJsonParse<DocSummary[]>(docsText, []);
  const doc = pickDoc(docs, query);

  if (!doc) {
    console.log("No documents found in data/.");
    await client.close();
    return;
  }

  const docResult = await client.callTool({
    name: "get_document",
    arguments: { id: doc.id },
  });
  const docText = docResult.content?.[0]?.text ?? "{}";
  const payload = safeJsonParse<DocPayload>(docText, {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    content: "",
  });

  const snippet = payload.content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 12)
    .join("\n");

  console.log(`Query: ${query}`);
  console.log(`Picked: ${payload.title} (${payload.id})`);
  console.log("Sample content:");
  console.log(snippet || "(empty)");

  await client.close();
}

main().catch((error) => {
  console.error("Test client error:", error);
  process.exit(1);
});
