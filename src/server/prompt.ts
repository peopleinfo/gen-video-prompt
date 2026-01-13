import type { PromptMode } from "./types.js";

export function renderPromptTemplate(
  template: string,
  args: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = args[key];
    return value && value.trim() ? value.trim() : "(unspecified)";
  });
}

export function getPromptArg(
  args: Record<string, string | number> | undefined,
  key: string
): string | undefined {
  const value = args?.[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function looksLikeCategoryRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(category|categories|genre|type of (video|videos)|what (kind|type) of (video|videos))\b/.test(
    cleaned
  );
}

export function looksLikeMemeOrFunnyRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(meme|memes|funny|comedy|comedic|humor|humour|viral)\b/.test(
    cleaned
  );
}

export function looksLikeDocumentaryRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(documentary|docu|nonfiction|interview|talking head|b-?roll|voice\s?over|narration|archival|verit[ée])\b/.test(
    cleaned
  );
}

export function looksLikeHistoryRequest(text: string): boolean {
  const cleaned = text.toLowerCase();
  return /\b(history|historical|period piece|antiquity|ancient|medieval|renaissance|victorian|ww1|ww2|world war|roman|egypt|ottoman|dynasty|century)\b/.test(
    cleaned
  );
}

export function getPromptMode(story: string, rawMode?: string): PromptMode {
  const cleaned = (rawMode ?? "").trim().toLowerCase();
  if (cleaned === "story" || cleaned === "storytelling") return "story";
  if (cleaned === "meme" || cleaned === "funny" || cleaned === "viral")
    return "meme";
  if (cleaned === "documentary" || cleaned === "doc" || cleaned === "docu")
    return "documentary";
  if (cleaned === "history" || cleaned === "historical") return "history";
  if (cleaned === "auto" || cleaned === "") return "auto";
  if (looksLikeMemeOrFunnyRequest(story)) return "meme";
  if (looksLikeDocumentaryRequest(story)) return "documentary";
  if (looksLikeHistoryRequest(story)) return "history";
  return "auto";
}

export function getStorytellingGuidance(
  story: string,
  mode: PromptMode
): string {
  const effectiveMode =
    mode === "auto"
      ? looksLikeMemeOrFunnyRequest(story)
        ? "meme"
        : looksLikeDocumentaryRequest(story)
        ? "documentary"
        : looksLikeHistoryRequest(story)
        ? "history"
        : "story"
      : mode;
  if (effectiveMode === "meme") {
    return [
      "- Make it meme-first: immediate hook in the first 1–2 seconds.",
      "- Build a simple setup → twist → punchline/payoff that reads without dialogue.",
      "- Include 1 clear 'freeze-frame' meme moment (strong silhouette/pose/reaction) suitable for captions.",
      "- Keep beats readable: exaggerate reactions, visual contrast, and timing.",
      "- End on a loopable final beat (clean cut back to the opening vibe).",
    ].join("\n");
  }

  if (effectiveMode === "documentary") {
    return [
      "- Use a documentary structure: hook → context → evidence/sequence → takeaway.",
      "- Favor observable details and real-world constraints; avoid magical coincidences unless requested.",
      "- Mix visual language: establishing shots, b-roll inserts, and 1–2 interview/talking-head moments.",
      "- Add documentary devices where helpful: on-screen lower-thirds, dates/locations, archival-style inserts.",
      "- Keep beats information-dense and visually explanatory (show causes and effects).",
    ].join("\n");
  }

  if (effectiveMode === "history") {
    return [
      "- Anchor the scene with time/place (year, region) and make period accuracy visible (wardrobe, props, architecture).",
      "- Avoid anachronisms; prefer era-appropriate materials, signage, and technology.",
      "- Tell a clear historical arc: setup → conflict/change → consequence, with a concrete moment of turning.",
      "- Use cinematic history language: maps/diagrams, archival documents, or tableau-style reenactment beats if fitting.",
      "- End with a strong historical image or implication that invites reflection/replay.",
    ].join("\n");
  }

  return [
    "- Default to storytelling: hook → escalation → payoff within the duration.",
    "- Establish stakes and intent quickly through visible actions and consequences.",
    "- Give the scene a clear turning point (reveal, discovery, change in environment).",
    "- End with a satisfying resolution or cliffhanger that invites replay.",
  ].join("\n");
}
