import { $ } from './utils.js';

export const SETTINGS_KEY = "gen-video-prompt.gui.settings.v1";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function applySettings(settings) {
  const set = (id, value) => {
    if (value === undefined || value === null) return;
    const el = $(id);
    if (!el) return;
    el.value = String(value);
  };
  set("provider", settings.provider);
  set(
    "commandPreset",
    settings.commandPreset ||
      (settings.cmd ? (settings.cmd === "codex" ? "codex" : settings.cmd === "gemini" ? "gemini" : "custom") : "codex")
  );
  const codexModel = typeof settings.codexModel === "string" ? settings.codexModel.trim() : "";
  const presetFromModel = codexModel
    ? ["gpt-5.2-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini", "gpt-5.2"].includes(codexModel)
      ? codexModel
      : "custom"
    : "";
  set("codexModelPreset", settings.codexModelPreset || presetFromModel);
  set("codexModel", codexModel);
  set("codexSessionMode", settings.codexSessionMode || "new");
  const geminiModel = typeof settings.geminiModel === "string" ? settings.geminiModel.trim() : "";
  const geminiPresetFromModel = geminiModel
    ? ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"].includes(geminiModel)
      ? geminiModel
      : "custom"
    : "";
  set("geminiModelPreset", settings.geminiModelPreset || geminiPresetFromModel);
  set("geminiModel", geminiModel);
  set("cmd", settings.cmd);
  set("cmdArgs", "");
  set("ollamaBaseUrl", settings.ollamaBaseUrl);
  set("ollamaModel", settings.ollamaModel);
  set("openaiBaseUrl", settings.openaiBaseUrl);
  set("openaiModel", settings.openaiModel);
  set("openaiApiKey", settings.openaiApiKey);
  set("puterModel", settings.puterModel);
  const compressEl = $("compressImages");
  if (compressEl) {
    compressEl.checked = settings.compressImages === true;
  }
}

export function captureSettings() {
  return {
    provider: $("provider").value || "none",
    commandPreset: $("commandPreset").value || "codex",
    codexModelPreset: $("codexModelPreset").value || "",
    codexModel: $("codexModel").value || "",
    codexSessionMode: $("codexSessionMode").value || "new",
    geminiModelPreset: $("geminiModelPreset").value || "",
    geminiModel: $("geminiModel").value || "",
    cmd: $("cmd").value || "",
    cmdArgs: "",
    ollamaBaseUrl: $("ollamaBaseUrl").value || "",
    ollamaModel: $("ollamaModel").value || "",
    openaiBaseUrl: $("openaiBaseUrl").value || "",
    openaiModel: $("openaiModel").value || "",
    openaiApiKey: $("openaiApiKey").value || "",
    puterModel: $("puterModel").value || "",
    compressImages: $("compressImages") ? $("compressImages").checked : false,
  };
}

export function getCommandValue() {
  const preset = $("commandPreset");
  if (preset && preset.value === "codex") return "codex";
  if (preset && preset.value === "gemini") return "gemini";
  if (preset && preset.value === "agent") return "agent";
  return $("cmd").value || "";
}

export function getCodexModelValue() {
  const preset = $("commandPreset");
  if (!preset || preset.value !== "codex") return "";
  const modelPreset = $("codexModelPreset");
  if (!modelPreset) return "";
  if (modelPreset.value === "custom") {
    return ($("codexModel").value || "").trim();
  }
  return (modelPreset.value || "").trim();
}

export function getGeminiModelValue() {
  const preset = $("commandPreset");
  if (!preset || preset.value !== "gemini") return "";
  const modelPreset = $("geminiModelPreset");
  if (!modelPreset) return "";
  if (modelPreset.value === "custom") {
    return ($("geminiModel").value || "").trim();
  }
  return (modelPreset.value || "").trim();
}

export function getCodexSessionMode() {
  const preset = $("commandPreset");
  if (!preset || preset.value !== "codex") return "";
  const mode = $("codexSessionMode");
  return mode ? mode.value || "new" : "new";
}

export function collectLlmConfig() {
  return {
    provider: $("provider").value || "none",
    command: getCommandValue(),
    codex_model: getCodexModelValue(),
    codex_session: getCodexSessionMode(),
    gemini_model: getGeminiModelValue(),
    ollama: {
      base_url: $("ollamaBaseUrl").value || "",
      model: $("ollamaModel").value || "",
    },
    openai_compatible: {
      base_url: $("openaiBaseUrl").value || "",
      model: $("openaiModel").value || "",
      api_key: $("openaiApiKey").value || "",
    },
    puter: {
      model: $("puterModel").value || "gemini-3-flash-preview",
    },
  };
}
