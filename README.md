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

- `structured_video_prompt`: generate a structured Sora 2 video prompt with sections for style, camera, lighting, action beats, quality, and audio.
  - Required args: `story`
  - Optional args: `duration_seconds`, `resolution`, `aspect_ratio`, `style`, `camera`, `lighting`, `quality`, `action_beats`, `audio`

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
