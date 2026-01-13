import path from "node:path";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const DOC_SCHEME = "doc://";

export const SYSTEM_PROMPT = `
You are a Sora 2 prompt specialist. Use the local prompt guides and produce clear, cinematic video prompts.

Core approach:
- Follow the Five Pillars: subject and character, action and motion, environment and setting, cinematic framing, aesthetic and style.
- Treat Sora as a world simulator: describe physical interactions, materials, light, and motion so the scene is internally consistent.
- Use concrete verbs and visible outcomes. Avoid vague adjectives without visual anchors.
- Default to storytelling: include a clear narrative arc (hook → escalation → payoff) even for short clips, unless the user explicitly asks for something else.
- If the user requests "meme", "funny", "comedy", or "viral", prioritize a fast hook (first 1–2s), a surprising visual twist, and a highly memeable moment that could be captioned.

Output format when drafting a prompt:
- If Part length (seconds) is provided, split the story into multiple parts of that length and label them with time ranges (e.g., Part 1 (0–15s), Part 2 (15–30s), ...).
- If Part length is NOT provided, output a single Part 1 covering the full Duration.

Each part must include:
Prompt: the beat for this part.
Scene: location/time, key props, and staging.
Style: aesthetic, mood, palette, film stock or realism level.
Camera: lens, framing, movement, and shot scale.
Lighting: key source, time of day, practicals, atmosphere.
Action beats: short timeline or beat list for this part.
Quality: resolution, fps, and technical quality notes for this part.
Audio (optional): diegetic sound cues if relevant.

Notes:
- Resolution and duration are API parameters. Include recommended values but do not claim they are controlled by text alone.
- Supported durations: 4, 8, 12 seconds (default 4). Resolutions: 1280x720 or 720x1280; Sora 2 Pro also supports 1024x1792 and 1792x1024.
- If Duration is missing, infer a reasonable total from the brief.
- If Part length is provided, compute the number of parts from Duration and Part length.
- Each part should read as its own scene with its own style/camera/lighting; do not apply one global style to all parts.
`.trim();

export const PROMPT_TEMPLATE = `
Create a Sora 2 video prompt from the brief below. Follow the Five Pillars and world-simulator approach.
Use concrete verbs and visible outcomes. If details are missing, add plausible specifics that support the story.

Storytelling / virality guidance:
{{storytelling_guidance}}

Brief:
{{story}}

Include any user constraints:
- Duration (API param): {{duration_seconds}}
- Part length (seconds): {{part_length_seconds}}
- Resolution (API param): {{resolution}}
- Aspect ratio: {{aspect_ratio}}
- Style: {{style}}
- Camera: {{camera}}
- Lighting: {{lighting}}
- Quality: {{quality}}
- Action beats: {{action_beats}}
- Audio: {{audio}}

Output format:
Part 1 (start–end s):
Prompt:
Scene:
Style:
Camera:
Lighting:
Action beats:
Quality:
Audio (optional):

Repeat the Part block for each segment when Part length is provided.
`.trim();

export const PROMPT_NAME = "structured_video_prompt";
export const PROMPT_TITLE = "Structured Sora 2 video prompt";
export const PROMPT_DESCRIPTION =
  "Generate a cinematic Sora 2 prompt split into parts when part length is provided; each part has its own prompt, scene, style, camera, lighting, action beats, quality, and audio.";

export const CATEGORY_PROMPT_NAME = "video_category_suggestion";
export const CATEGORY_PROMPT_TITLE = "Video category suggestion";
export const CATEGORY_PROMPT_DESCRIPTION =
  "Suggest a popular video category phrased like: 'popular funny videos in USA'.";
export const CATEGORY_PROMPT_TEMPLATE = `
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

export const PROMPT_ARGUMENTS = [
  {
    name: "story",
    description: "Short brief or story for the clip.",
    required: true,
  },
  {
    name: "mode",
    description:
      "Prompt mode override: auto (default), story (storytelling), meme (funny/viral/meme), documentary (nonfiction), history (period-accurate historical).",
  },
  {
    name: "duration_seconds",
    description: "Preferred duration; recommended values are 4, 8, or 12.",
  },
  {
    name: "part_length_seconds",
    description: "Seconds per part. If omitted, output a single part.",
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

export const CATEGORY_PROMPT_ARGUMENTS = [
  {
    name: "story",
    description: "User request, e.g. 'give me categories of videos a user likes'.",
    required: true,
  },
];
