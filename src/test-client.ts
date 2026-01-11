import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type CliArgs = {
  prompt: string;
  promptName: string;
  mode?: string;
  durationSeconds?: string;
  resolution?: string;
  aspectRatio?: string;
  style?: string;
  camera?: string;
  lighting?: string;
  quality?: string;
  actionBeats?: string;
  audio?: string;
};

function usage(): string {
  return [
    "Usage:",
    "  npx tsx src/test-client.ts --prompt \"...\" [--name structured_video_prompt]",
    "",
    "Optional args:",
    "  --mode <auto|story|meme>",
    "  --duration <seconds>",
    "  --resolution <WxH>",
    "  --aspect-ratio <text>",
    "  --style <text>",
    "  --camera <text>",
    "  --lighting <text>",
    "  --quality <text>",
    "  --action-beats <text>",
    "  --audio <text>",
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    const value = argv[idx + 1];
    if (!value || value.startsWith("--")) return undefined;
    return value;
  };

  const prompt = get("--prompt") ?? "";
  if (!prompt.trim()) {
    throw new Error(`Missing required --prompt.\n\n${usage()}`);
  }

  return {
    prompt,
    promptName: get("--name") ?? "structured_video_prompt",
    mode: get("--mode"),
    durationSeconds: get("--duration"),
    resolution: get("--resolution"),
    aspectRatio: get("--aspect-ratio"),
    style: get("--style"),
    camera: get("--camera"),
    lighting: get("--lighting"),
    quality: get("--quality"),
    actionBeats: get("--action-beats"),
    audio: get("--audio"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--loader", "tsx", "src/server.ts"],
    cwd: process.cwd(),
    stderr: "inherit",
  });

  const client = new Client({ name: "gen-video-prompt-test-client", version: "0.0.0" });
  await client.connect(transport);

  const promptArgs: Record<string, string> = { story: args.prompt };
  const addIf = (key: string, value: string | undefined): void => {
    if (value && value.trim()) {
      promptArgs[key] = value.trim();
    }
  };
  addIf("mode", args.mode);
  addIf("duration_seconds", args.durationSeconds);
  addIf("resolution", args.resolution);
  addIf("aspect_ratio", args.aspectRatio);
  addIf("style", args.style);
  addIf("camera", args.camera);
  addIf("lighting", args.lighting);
  addIf("quality", args.quality);
  addIf("action_beats", args.actionBeats);
  addIf("audio", args.audio);

  const result = await client.getPrompt({
    name: args.promptName,
    arguments: promptArgs,
  });

  await client.close();

  const first = result.messages?.[0];
  const text = first?.content?.type === "text" ? first.content.text : "";
  process.stdout.write(text ? `${text.trim()}\n` : "(no prompt text returned)\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
