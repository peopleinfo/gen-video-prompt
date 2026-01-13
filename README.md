# gen-video-prompt-mcp

MCP server for browsing local Sora 2 prompt docs in `data/`.

## Requirements

- Node.js 18+ recommended

## Install

```bash
npm install
```

## Build and run

```bash
npm run build
npm run start
```

This starts the MCP server over stdio.

## GUI (local)

A small local web UI that spawns the MCP server and lets you call `prompts/get`, browse resources, and run tools.

```bash
npm run gui
```

Then open `http://127.0.0.1:3333`.

Notes:

- This UI only returns MCP prompt templates and document content; it does not run an LLM.
- The GUI uses `node dist/server.js` under the hood, so it requires a successful `npm run build`.

HTTPS (clipboard image support often requires a secure context):

```bash
npm run gui:cert
HTTPS=1 SSL_KEY=tmp/certs/gui.key.pem SSL_CERT=tmp/certs/gui.cert.pem npm run gui
```

## Filling `(unspecified)` with an LLM (optional)

The GUI can fill missing fields by using either:

- A local command (Codex CLI, etc.), or
- An HTTP LLM backend (Ollama HTTP, or any OpenAI-compatible API).

Start the GUI with command execution enabled:

```bash
ENABLE_COMMAND_LLM=1 npm run gui
```

Then in the GUI choose `Fill missing fields -> Local command` and set:

- `Command`: a program that reads the prompt from stdin and prints the answer to stdout.
- `Args`: any arguments your program needs.

Example (Codex CLI): set `Command` to `codex` and choose args that make it read stdin and print the response (depends on your Codex CLI usage).

Enable HTTP LLM backends:

```bash
ENABLE_HTTP_LLM=1 npm run gui
```

Example (Ollama HTTP):

- Provider: `Ollama (HTTP)`
- Base URL: `http://127.0.0.1:11434`
- Model: `llama3`

Example (OpenAI-compatible):

- Provider: `OpenAI-compatible API`
- Base URL: `https://api.openai.com`
- Model: your model name
- API key: your key (stored in browser localStorage)

Enable both:

```bash
npm run gui:all-llm
```

Example (Ollama CLI):

- Command: `ollama`
- Args: `run llama3`

## GUI smoke test

```bash
npm run test:gui
```

## Codex image chat test

Start the GUI with command execution enabled:

```bash
ENABLE_COMMAND_LLM=1 npm run gui
```

Then run:

```bash
IMAGE_PATH=/path/to/image.png npm run test:gui:codex-image
```

Multiple images:

```bash
IMAGE_PATH=/path/to/image1.png,/path/to/image2.jpg npm run test:gui:codex-image
```

Optional:

- `CODEX_MODEL=gpt-5.2-codex` to override the model.
- `CODEX_SESSION=resume_last` to resume the last Codex session.

## Register with Codex MCP

Add a server entry to your Codex MCP config. Example:

```json
{
  "mcpServers": {
    "sora2-prompt-docs": {
      "command": "node",
      "args": ["dist/server.js"],
      "cwd": "/path/to/gen-video-prompt"
    }
  }
}
```

Notes:

- Make sure you run `npm run build` before starting the server.
- If you prefer running from TypeScript, use `npx tsx src/server.ts` instead of `node dist/server.js`.

## What the server exposes

Tools:

- `list_documents`: list all local documents with title, type, and a short description.
- `get_document`: fetch full content by document id (from `list_documents`).

Resources:

- Each document is also exposed as a resource with a `doc://` URI.

Prompts:

- `structured_video_prompt`: generate a structured Sora 2 video prompt with a 3-part prompt (hook → escalation → payoff) plus sections for style, camera, lighting, action beats, quality, and audio.
  - Required args: `story`
  - Optional args: `mode` (`auto`, `story`, `meme`), `duration_seconds`, `resolution`, `aspect_ratio`, `style`, `camera`, `lighting`, `quality`, `action_beats`, `audio`
- `video_category_suggestion`: suggest a popular video category phrase (e.g. "popular funny videos in USA").
  - Required args: `story`

Notes:

- If `structured_video_prompt.story` looks like a request for video categories, it automatically switches to category suggestion mode.

## Example usage

After registering the server in Codex, you can:

- Call `list_documents` to see available prompt docs.
- Call `get_document` with a chosen `id` to retrieve full content.
- Call `prompts/list` to see available prompt templates.
- Call `prompts/get` with `structured_video_prompt` to get a structured prompt skeleton.

Example client call (local test client):

```bash
npx tsx src/test-client.ts --prompt "A sad 15-second story of a stray cat waiting at a bus stop in the rain."
```

## Data location

Put new prompt docs in `data/`. Supported formats:

- `.md`
- `.txt`
- `.pdf`

## Local smoke test (optional)

```bash
node scripts/test-docs.mjs "nature landscape"
```

This reads the local docs and prints a short excerpt from a matching file.

## Useful links

- [Copy Prompts](https://docsbot.ai/prompts/creative)
