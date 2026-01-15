import { $ } from "./utils.js";

export async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options && options.headers),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const msg = data && data.error ? data.error : "Request failed";
    throw new Error(msg);
  }
  return data;
}

export async function loadPrompts() {
  const data = await api("/api/prompts", { method: "GET" });
  const select = $("promptName");
  if (!select) return;
  select.innerHTML = "";
  for (const p of data.prompts || []) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = `${p.title || p.name}`;
    select.appendChild(opt);
  }
}

export async function loadTools() {
  const data = await api("/api/tools", { method: "GET" });
  const select = $("toolName");
  if (!select) return;
  select.innerHTML = "";
  for (const t of data.tools || []) {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = `${t.name}`;
    select.appendChild(opt);
  }
}

export async function loadDocs() {
  const data = await api("/api/resources", { method: "GET" });
  const select = $("docUri");
  if (!select) return;
  select.innerHTML = "";
  for (const r of data.resources || []) {
    const opt = document.createElement("option");
    opt.value = r.uri;
    opt.textContent = `${r.name || r.uri}`;
    select.appendChild(opt);
  }
}

export async function callLlm(prompt, onPart, collectLlmConfig, images = []) {
  const config = collectLlmConfig();
  if (config.provider === "puter") {
    try {
      const response = await puter.ai.chat(prompt, {
        model: config.puter.model,
        stream: true,
      });
      let fullText = "";
      for await (const part of response) {
        if (part?.text) {
          fullText += part.text;
          if (onPart) onPart(part.text);
        }
      }
      return fullText;
    } catch (err) {
      console.error("Puter.js error:", err);
      throw err;
    }
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ...config, images }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to call LLM");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    fullText += chunk;
    if (onPart) onPart(chunk);
  }
  return fullText;
}

export async function generateImage(prompt, config) {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, config }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to generate image");
  }
  // The custom endpoint returns an OpenAI-compatible chat response.
  // We expect the image URL or base64 in the content.
  // According to common implementations of such custom models, it might be a URL or a Markdown image.
  return data;
}
