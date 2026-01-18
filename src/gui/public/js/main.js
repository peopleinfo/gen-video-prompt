import {
  api,
  callLlm,
  generateImage,
  loadDocs,
  loadPrompts,
  loadTools,
} from "./api.js";
import {
  applyPromptFields,
  assertValidPartLength,
  buildStoryWithImages,
  capturePromptFields,
  clearPromptImages,
  copyImageOnly,
  extractParts,
  getPartLengthSeconds,
  getTotalDurationSeconds,
  outputParts,
  partImageFiles,
  renderPartImageInputs,
  setOutput,
  setOutputImage,
  showOutputLoading,
  updateOutputParts,
} from "./prompts.js";
import {
  applySettings,
  captureSettings,
  collectLlmConfig,
  getCodexModelValue,
  getCodexSessionMode,
  getCommandValue,
  getGeminiModelValue,
  loadSettings,
  saveSettings,
} from "./settings.js";
import { setOutputTab, setTab, setTabDisabled, updateLlmTabs } from "./tabs.js";
import {
  $,
  base64ToBlob,
  compressImage,
  copyTextWithOptionalImage,
  copyToClipboard,
  getImageNames,
  handleImagePick,
  pickValue,
  readImages,
  readVideos,
  renderFilesList,
  renderImagesList,
  showToast,
  wireCustom,
} from "./utils.js";
import {
  getActiveWorkspace,
  loadWorkspaces,
  newWorkspace,
  renderWorkspaceTabs,
  saveWorkspaces,
} from "./workspaces.js";

// State
let llmConnected = false;
let generateAbortController = null;
let mergedVideoUrl = "";
let workspaces = [];
let activeWorkspaceId = "";
let scrapedImageUrls = [];

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const PREVIEW_TEMPLATE = [
  "Part 1 (start–end s):",
  "Prompt: <...>",
  "Scene: <...>",
  "Style: <...>",
  "Camera: <...>",
  "Lighting: <...>",
  "Action beats: <...>",
  "Quality: <...>",
  "Audio (optional): <...>",
  "",
  "Repeat the Part block for each segment when Part length is provided.",
].join("\n");

function parseImageUrlsFromHtml(html) {
  const cleaned = (html || "").trim();
  if (!cleaned) return [];
  const doc = new DOMParser().parseFromString(cleaned, "text/html");
  const urls = [];
  doc.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    if (src) urls.push(src.trim());
  });
  doc
    .querySelectorAll('meta[property="og:image"], meta[name="og:image"]')
    .forEach((meta) => {
      const content = meta.getAttribute("content");
      if (content) urls.push(content.trim());
    });
  const unique = new Set();
  return urls.filter((url) => {
    if (!url || unique.has(url)) return false;
    unique.add(url);
    return true;
  });
}

function renderScrapedImages(urls) {
  scrapedImageUrls = urls;
  const container = $("scrapedImages");
  if (!container) return;
  container.innerHTML = "";
  urls.forEach((url) => {
    const card = document.createElement("label");
    card.className = "image-card";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.url = url;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "Scraped image";
    img.src = url;
    const meta = document.createElement("div");
    meta.className = "image-meta";
    meta.textContent = url;
    checkbox.addEventListener("change", updateScrapeStatus);
    card.appendChild(checkbox);
    card.appendChild(img);
    card.appendChild(meta);
    container.appendChild(card);
  });
  updateScrapeStatus();
}

function updateScrapeStatus() {
  const status = $("scrapeStatus");
  const downloadBtn = $("btnDownloadScrapedZip");
  const selectBtn = $("btnSelectAllScraped");
  const container = $("scrapedImages");
  if (!status || !downloadBtn || !selectBtn || !container) return;
  const checks = Array.from(
    container.querySelectorAll('input[type="checkbox"]')
  );
  const selected = checks.filter((el) => el.checked).length;
  const total = checks.length;
  status.textContent = total
    ? `${selected} of ${total} selected`
    : "No images detected";
  downloadBtn.disabled = selected === 0;
  selectBtn.textContent =
    total > 0 && selected === total ? "Clear selection" : "Select all";
}

function uint16LE(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function uint32LE(value) {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const index = (crc ^ bytes[i]) & 0xff;
    crc = CRC32_TABLE[index] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function guessFileExtension(url, mimeType) {
  const type = (mimeType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  if (type.includes("avif")) return "avif";
  if (url) {
    const clean = url.split("?")[0].split("#")[0];
    const last = clean.split("/").pop();
    if (last && last.includes(".")) {
      return last.split(".").pop().toLowerCase();
    }
  }
  return "png";
}

function guessFileName(url, index, mimeType, usedNames) {
  let base = "";
  if (url) {
    const clean = url.split("?")[0].split("#")[0];
    base = clean.split("/").pop() || "";
  }
  const ext = guessFileExtension(url, mimeType);
  if (!base || !base.includes(".")) {
    base = `image-${index + 1}.${ext}`;
  }
  const safeBase = base.replace(/[^\w.\-]+/g, "-");
  const key = safeBase.toLowerCase();
  const count = usedNames.get(key) || 0;
  usedNames.set(key, count + 1);
  if (count === 0) return safeBase;
  const parts = safeBase.split(".");
  const suffix = `-${count + 1}`;
  if (parts.length === 1) return `${safeBase}${suffix}`;
  return `${parts.slice(0, -1).join(".")}${suffix}.${parts.at(-1)}`;
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const localHeader = concatBytes([
      uint32LE(0x04034b50),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(crc),
      uint32LE(data.length),
      uint32LE(data.length),
      uint16LE(nameBytes.length),
      uint16LE(0),
    ]);
    localParts.push(localHeader, nameBytes, data);
    const centralHeader = concatBytes([
      uint32LE(0x02014b50),
      uint16LE(20),
      uint16LE(20),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(crc),
      uint32LE(data.length),
      uint32LE(data.length),
      uint16LE(nameBytes.length),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint16LE(0),
      uint32LE(0),
      uint32LE(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  });
  const centralSize = centralParts.reduce(
    (sum, part) => sum + part.length,
    0
  );
  const centralOffset = offset;
  const endRecord = concatBytes([
    uint32LE(0x06054b50),
    uint16LE(0),
    uint16LE(0),
    uint16LE(files.length),
    uint16LE(files.length),
    uint32LE(centralSize),
    uint32LE(centralOffset),
    uint16LE(0),
  ]);
  return new Blob([...localParts, ...centralParts, endRecord], {
    type: "application/zip",
  });
}

async function fetchImageBytes(url) {
  const isHttp = /^https?:\/\//i.test(url);
  const fetchUrl = isHttp
    ? `/api/image-proxy?url=${encodeURIComponent(url)}`
    : url;
  const response = await fetch(fetchUrl);
  if (!response.ok || response.type === "opaque") {
    throw new Error(`Failed to fetch image: ${url}`);
  }
  const blob = await response.blob();
  const data = new Uint8Array(await blob.arrayBuffer());
  return { blob, data };
}

function getSelectedScrapeUrls() {
  const container = $("scrapedImages");
  if (!container) return [];
  const selected = Array.from(
    container.querySelectorAll('input[type="checkbox"]:checked')
  );
  return selected.map((el) => el.dataset.url).filter(Boolean);
}

function clearScrapeGallery() {
  const container = $("scrapedImages");
  if (container) container.innerHTML = "";
  scrapedImageUrls = [];
  updateScrapeStatus();
}

async function downloadSelectedScrapeZip() {
  const selected = getSelectedScrapeUrls();
  if (!selected.length) return;
  const status = $("scrapeStatus");
  if (status) status.textContent = "Downloading images...";
  const files = [];
  const failures = [];
  const usedNames = new Map();
  for (let i = 0; i < selected.length; i += 1) {
    const url = selected[i];
    try {
      const { blob, data } = await fetchImageBytes(url);
      const name = guessFileName(url, files.length, blob.type, usedNames);
      files.push({ name, data });
    } catch {
      failures.push(url);
    }
  }
  if (!files.length) {
    showToast("Could not download selected images.", "error");
    if (status) status.textContent = "Download failed (CORS or invalid URLs).";
    return;
  }
  const zipBlob = buildZip(files);
  const zipUrl = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = zipUrl;
  link.download = `scraped-images-${Date.now()}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
  if (failures.length) {
    showToast(`${failures.length} image(s) failed to download.`, "error");
  } else {
    showToast("Downloaded selected images.");
  }
  if (status) {
    status.textContent = failures.length
      ? `${files.length} zipped, ${failures.length} failed`
      : `${files.length} images zipped`;
  }
}

function setLlmStatus(text, isError = false) {
  const el = $("llmStatus");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "error" : "";
}

function setGenerateAbortEnabled(enabled) {
  const btn = $("btnAbort");
  if (!btn) return;
  btn.disabled = !enabled;
}

function clearVideoPreview() {
  const preview = $("videoPreview");
  if (preview) {
    preview.pause();
    preview.removeAttribute("src");
    const wrapper = $("videoPreviewWrapper");
    if (wrapper) wrapper.style.display = "none";
  }
  if (mergedVideoUrl) {
    URL.revokeObjectURL(mergedVideoUrl);
    mergedVideoUrl = "";
  }
}

function saveActiveWorkspaceFields() {
  const ws = getActiveWorkspace(activeWorkspaceId, workspaces);
  if (!ws) return;
  ws.fields = capturePromptFields();
  saveWorkspaces(activeWorkspaceId, workspaces);
}

function saveActiveWorkspaceOutput(text) {
  const ws = getActiveWorkspace(activeWorkspaceId, workspaces);
  if (!ws) return;
  ws.output = text || "";
  saveWorkspaces(activeWorkspaceId, workspaces);
}

function switchWorkspace(id) {
  const current = getActiveWorkspace(activeWorkspaceId, workspaces);
  if (current) current.fields = capturePromptFields();
  activeWorkspaceId = id;
  const next = getActiveWorkspace(activeWorkspaceId, workspaces);
  applyPromptFields(next ? next.fields : {}, setSelectWithCustom);
  clearPromptImages();
  renderWorkspaceTabs(
    activeWorkspaceId,
    workspaces,
    switchWorkspace,
    deleteWorkspace
  );
  if (next && next.output) {
    setOutput(next.output, setOutputTab);
  }
  saveWorkspaces(activeWorkspaceId, workspaces);
}

function deleteWorkspace(id) {
  if (workspaces.length <= 1) return;
  workspaces = workspaces.filter((w) => w.id !== id);
  if (activeWorkspaceId === id) {
    activeWorkspaceId = workspaces[0].id;
  }
  renderWorkspaceTabs(
    activeWorkspaceId,
    workspaces,
    switchWorkspace,
    deleteWorkspace
  );
  applyPromptFields(
    getActiveWorkspace(activeWorkspaceId, workspaces).fields,
    setSelectWithCustom
  );
  clearPromptImages();
  saveWorkspaces(activeWorkspaceId, workspaces);
}

function initWorkspacesState() {
  const stored = loadWorkspaces();
  if (
    stored &&
    Array.isArray(stored.workspaces) &&
    stored.workspaces.length > 0
  ) {
    workspaces = stored.workspaces;
    activeWorkspaceId =
      stored.activeId && workspaces.some((ws) => ws.id === stored.activeId)
        ? stored.activeId
        : workspaces[0].id;
  } else {
    workspaces = [newWorkspace("Workspace 1")];
    activeWorkspaceId = workspaces[0].id;
  }
  renderWorkspaceTabs(
    activeWorkspaceId,
    workspaces,
    switchWorkspace,
    deleteWorkspace
  );
  applyPromptFields(
    getActiveWorkspace(activeWorkspaceId, workspaces).fields,
    setSelectWithCustom
  );
}

function setSelectWithCustom(selectId, customId, value) {
  const sel = $(selectId);
  const custom = $(customId);
  if (!sel || !custom) return;
  const val = value || "";
  const hasOption = Array.from(sel.options).some((opt) => opt.value === val);
  if (!val) {
    sel.value = "";
    custom.value = "";
    custom.style.display = "none";
    return;
  }
  if (hasOption) {
    sel.value = val;
    custom.value = "";
    custom.style.display = "none";
  } else {
    sel.value = "custom";
    custom.value = val;
    custom.style.display = "block";
  }
}

// Event Listeners
$("tab-setup").addEventListener("click", () => setTab("setup"));
$("tab-chat").addEventListener("click", () => setTab("chat"));
$("tab-prompts").addEventListener("click", () => setTab("prompts"));
$("tab-docs").addEventListener("click", () => setTab("docs"));
$("tab-tools").addEventListener("click", () => setTab("tools"));

$("toggleOpenaiApiKey").addEventListener("click", () => {
  const input = $("openaiApiKey");
  const icon = $("eyeIcon");
  if (input.type === "password") {
    input.type = "text";
    icon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;
  } else {
    input.type = "password";
    icon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  }
});

$("tab-preview").addEventListener("click", () => setOutputTab("preview"));
$("tab-output").addEventListener("click", () => setOutputTab("output"));
$("tab-video").addEventListener("click", () => setOutputTab("video"));

$("compressImages").addEventListener("change", (e) => {
  $("compressionSettings").style.display = e.target.checked ? "flex" : "none";
});

$("compressionQuality").addEventListener("input", (e) => {
  $("qualityValue").textContent = e.target.value;
});

$("partSelect").addEventListener("change", async (event) => {
  const value = event.target.value;
  if (!value) return;
  const index = Number(value);
  if (!Number.isFinite(index) || !outputParts[index]) return;
  try {
    const imageFile = partImageFiles.get(index);
    const result = await copyTextWithOptionalImage(
      outputParts[index].text,
      imageFile
    );
    if (result.usedImage) {
      showToast(
        `Copied ${outputParts[index].label || `Part ${index + 1}`} with image.`
      );
    } else {
      showToast(`Copied ${outputParts[index].label || `Part ${index + 1}`}.`);
    }
  } catch {
    showToast("Copy failed.", "error");
  } finally {
    event.target.value = "";
  }
});

$("btnCopyParts").addEventListener("click", async () => {
  if (!outputParts.length) return;
  const text = outputParts.map((part) => part.text).join("\n\n");
  try {
    await copyToClipboard(text);
    showToast("Copied all parts.");
  } catch {
    showToast("Copy failed.", "error");
  }
});

$("btnCopyOutput").addEventListener("click", async () => {
  const text = $("output").textContent || "";
  if (!text) return;
  const btn = $("btnCopyOutput");
  const original = btn.textContent;
  try {
    await copyToClipboard(text);
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = original;
    }, 1200);
  } catch {
    btn.textContent = "Failed";
    setTimeout(() => {
      btn.textContent = original;
    }, 1200);
  }
});

$("btnSendToExtension").addEventListener("click", async () => {
  const text = ($("output").textContent || "").trim();
  if (!text) {
    showToast("No output to send.", "error");
    return;
  }
  try {
    await api("/api/extension/queue", {
      method: "POST",
      body: JSON.stringify({ prompt: text }),
    });
    showToast("Sent to extension.");
  } catch (error) {
    showToast(
      error && error.message ? error.message : "Failed to send to extension.",
      "error"
    );
  }
});

$("btnGetPrompt").addEventListener("click", async () => {
  $("status").textContent = "Loading...";
  try {
    assertValidPartLength();
    const name = $("promptName").value;
    const storyWithImages = buildStoryWithImages(
      $("story").value,
      getImageNames("promptImages")
    );
    const body = {
      name,
      arguments: {
        story: storyWithImages,
        mode: $("mode").value || undefined,
        duration_seconds: getTotalDurationSeconds(),
        part_length_seconds: getPartLengthSeconds(),
        resolution: pickValue("resolution", "resolutionCustom"),
        aspect_ratio: pickValue("aspect", "aspectCustom"),
        style: $("style").value || undefined,
        camera: $("camera").value || undefined,
        lighting: $("lighting").value || undefined,
        action_beats: $("actionBeats").value || undefined,
        quality: $("quality").value || undefined,
        audio: $("audio").value || undefined,
      },
    };

    const data = await api("/api/prompts/get", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const msg =
      (data.messages && data.messages[0] && data.messages[0].content) || null;
    const text =
      msg && msg.type === "text" ? msg.text : JSON.stringify(data, null, 2);
    setOutput(text, setOutputTab);
    saveActiveWorkspaceOutput(text);
    $("status").textContent = "Done.";
  } catch (e) {
    $("status").textContent = "Error.";
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnAbort").addEventListener("click", () => {
  if (!generateAbortController) return;
  generateAbortController.abort();
  generateAbortController = null;
  setGenerateAbortEnabled(false);
  $("status").textContent = "Aborted.";
  setOutput("Aborted.", setOutputTab);
  showToast("Generation aborted.");
});

$("btnGenerate").addEventListener("click", async () => {
  $("status").textContent = "Generating...";
  showOutputLoading("Generating...", setOutputTab);
  if (generateAbortController) {
    generateAbortController.abort();
  }
  generateAbortController = new AbortController();
  setGenerateAbortEnabled(true);
  try {
    assertValidPartLength();
    const provider = $("provider").value || "none";
    const storyWithImages = buildStoryWithImages(
      $("story").value,
      getImageNames("promptImages")
    );
    const payload = {
      provider,
      story: storyWithImages,
      mode: $("mode").value || undefined,
      duration_seconds: getTotalDurationSeconds(),
      part_length_seconds: getPartLengthSeconds(),
      resolution: pickValue("resolution", "resolutionCustom"),
      aspect_ratio: pickValue("aspect", "aspectCustom"),
      style: $("style").value || undefined,
      camera: $("camera").value || undefined,
      lighting: $("lighting").value || undefined,
      action_beats: $("actionBeats").value || undefined,
      quality: $("quality").value || undefined,
      audio: $("audio").value || undefined,
    };

    if (provider === "command") {
      payload.command = getCommandValue();
      payload.codex_model = getCodexModelValue() || undefined;
      payload.codex_session = getCodexSessionMode() || undefined;
      payload.gemini_model = getGeminiModelValue() || undefined;
      if (payload.command === "codex") {
        const images = await readImages("promptImages");
        if (images.length) {
          payload.images = images;
        }
      }
    }
    if (provider === "ollama") {
      payload.base_url = $("ollamaBaseUrl").value || undefined;
      payload.model = $("ollamaModel").value || undefined;
    }
    if (provider === "openai_compatible") {
      payload.base_url = $("openaiBaseUrl").value || undefined;
      payload.model = $("openaiModel").value || undefined;
      payload.api_key = $("openaiApiKey").value || undefined;
    }
    if (provider === "gpt4free") {
      payload.prompt = storyWithImages;
      payload.gpt4free = {
        model: $("gpt4freeModel").value || "deepseek",
        provider: provider || "gpt4free",
      };
    }

    saveSettings(captureSettings());

    if (provider === "puter") {
      const systemPrompt =
        "You are a video prompt engineer. Follow the user instructions precisely.";
      const fullPrompt = `${systemPrompt}\n\n${storyWithImages}`;

      const text = await callLlm(
        fullPrompt,
        (chunk) => {
          // Optionally update UI with streaming chunks if desired
        },
        collectLlmConfig
      );

      const data = { ok: true, text };
      setOutput(data.text, setOutputTab);
      saveActiveWorkspaceOutput(data.text);
      $("status").textContent = "Done.";
      return;
    }

    const data = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: generateAbortController.signal,
    });
    setOutput(data.text || JSON.stringify(data, null, 2), setOutputTab);
    saveActiveWorkspaceOutput(data.text || JSON.stringify(data, null, 2));
    $("status").textContent = "Done.";
  } catch (e) {
    if (e && e.name === "AbortError") {
      $("status").textContent = "Aborted.";
      setOutput("Aborted.", setOutputTab);
    } else {
      $("status").textContent = "Error.";
      setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
    }
  } finally {
    generateAbortController = null;
    setGenerateAbortEnabled(false);
  }
});

$("btnMergeVideos").addEventListener("click", async () => {
  const status = $("videoStatus");
  if (status) status.textContent = "Merging...";
  try {
    const files = await readVideos("videoParts");
    if (!files.length) {
      if (status) status.textContent = "Select video parts first.";
      return;
    }
    clearVideoPreview();
    const data = await api("/api/merge-videos", {
      method: "POST",
      body: JSON.stringify({ files }),
    });
    const file = data && data.file ? data.file : null;
    if (!file || !file.data) {
      throw new Error("Missing merged video data.");
    }
    const mimeType = file.type || "video/mp4";
    const blob = base64ToBlob(file.data, mimeType);
    mergedVideoUrl = URL.createObjectURL(blob);
    const preview = $("videoPreview");
    const wrapper = $("videoPreviewWrapper");
    if (preview) {
      preview.src = mergedVideoUrl;
      if (wrapper) wrapper.style.display = "block";
      preview.load();
    }
    if (status) status.textContent = "Merged.";
  } catch (e) {
    if (status) status.textContent = "Error.";
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnClearVideos").addEventListener("click", () => {
  const input = $("videoParts");
  if (input) input.value = "";
  renderFilesList("videoParts", "videoPartsList", "Remove video");
  const status = $("videoStatus");
  if (status) status.textContent = "";
  clearVideoPreview();
});

$("btnLoadDocs").addEventListener("click", async () => {
  try {
    await loadDocs();
    setOutput("Loaded documents.", setOutputTab);
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnReadDoc").addEventListener("click", async () => {
  try {
    const uri = $("docUri").value;
    const data = await api(
      `/api/resources/read?uri=${encodeURIComponent(uri)}`,
      { method: "GET" }
    );
    const content = data.contents && data.contents[0] ? data.contents[0] : null;
    const text =
      content && content.text
        ? String(content.text)
        : JSON.stringify(data, null, 2);
    setOutput(
      text.slice(0, 20000) +
        (text.length > 20000 ? "\n\n...(truncated)..." : ""),
      setOutputTab
    );
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnLoadTools").addEventListener("click", async () => {
  try {
    await loadTools();
    setOutput("Loaded tools.", setOutputTab);
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnCallTool").addEventListener("click", async () => {
  try {
    const name = $("toolName").value;
    const raw = $("toolArgs").value.trim();
    let args = {};
    if (raw) args = JSON.parse(raw);
    const data = await api("/api/tools/call", {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
    });
    setOutput(JSON.stringify(data, null, 2), setOutputTab);
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnConnect").addEventListener("click", async () => {
  const btn = $("btnConnect");
  if (llmConnected) {
    llmConnected = false;
    updateLlmTabs(llmConnected);
    setLlmStatus("Disconnected.", true);
    btn.textContent = "Connect";
    return;
  }
  try {
    btn.disabled = true;
    btn.textContent = "Checking...";
    setLlmStatus("Checking LLM...");
    const config = collectLlmConfig();
    if (config.provider === "none") {
      setLlmStatus("Select an LLM provider first.", true);
      llmConnected = false;
      updateLlmTabs(llmConnected);
      return;
    }
    if (config.provider === "gpt4free") {
      setLlmStatus("Downloading GPT4Free (if needed)...");
      await api("/api/gpt4free/connect", { method: "POST" });
    }
    if (config.provider === "puter") {
      await puter.ai.chat("Reply with OK.", {
        model: config.puter.model,
      });
    } else {
      await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ prompt: "Reply with OK.", ...config }),
      });
    }
    llmConnected = true;
    setLlmStatus("Connected.");
  } catch (e) {
    llmConnected = false;
    setLlmStatus(e && e.message ? e.message : "Not connected.", true);
  } finally {
    updateLlmTabs(llmConnected);
    btn.disabled = false;
    btn.textContent = llmConnected ? "Disconnect" : "Connect";
  }
});

async function handleChatGenImage() {
  try {
    const prompt = $("chatPrompt").value.trim();
    if (!prompt) {
      setOutput("Enter a prompt for the tool first.", setOutputTab, true);
      return;
    }

    const config = collectLlmConfig();
    const imageConfig = config.image_gen;
    if (config.provider === "gpt4free") {
      imageConfig.provider = "gpt4free";
      imageConfig.model = config.gpt4free.model;
    }
    const isLlm = imageConfig.type === "llm" && config.provider !== "gpt4free";

    showOutputLoading(
      isLlm ? "Running Antigravity Chat..." : "Running Antigravity Tool...",
      setOutputTab
    );

    if (isLlm) {
      let fullText = "";
      setOutput("Running Antigravity Chat...", setOutputTab, false, true);
      await callLlm(
        prompt,
        (part) => {
          fullText += part;
          setOutput(fullText, setOutputTab, false, true);
        },
        () => config
      );
      setOutput(fullText || "(empty response)", setOutputTab);
      showToast("Antigravity Chat run successfully!");
    } else {
      const data = await generateImage(prompt, imageConfig);
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("No image content in response");
      }
      let imageUrl = content.trim();
      const mdMatch = imageUrl.match(/!\[.*?\]\((.*?)\)/);
      if (mdMatch) {
        imageUrl = mdMatch[1];
      }
      setOutputImage(imageUrl, setOutputTab);
      showToast("Antigravity Tool run successfully!");
    }
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
}

async function handlePromptGenImage() {
  try {
    const story = $("story").value.trim();
    if (!story) {
      setOutput("Enter a story first.", setOutputTab, true);
      return;
    }

    const config = collectLlmConfig();
    const imageConfig = config.image_gen;
    if (config.provider === "gpt4free") {
      imageConfig.provider = "gpt4free";
      imageConfig.model = config.gpt4free.model;
    }
    const isLlm = imageConfig.type === "llm" && config.provider !== "gpt4free";

    showOutputLoading(
      isLlm
        ? "Running Antigravity Chat from story..."
        : "Running Antigravity Tool from story...",
      setOutputTab
    );

    if (isLlm) {
      let fullText = "";
      setOutput(
        "Running Antigravity Chat from story...",
        setOutputTab,
        false,
        true
      );
      await callLlm(
        story,
        (part) => {
          fullText += part;
          setOutput(fullText, setOutputTab, false, true);
        },
        () => config
      );
      setOutput(fullText || "(empty response)", setOutputTab);
      showToast("Antigravity Chat run successfully from story!");
    } else {
      const data = await generateImage(story, imageConfig);
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("No image content in response");
      }
      let imageUrl = content.trim();
      const mdMatch = imageUrl.match(/!\[.*?\]\((.*?)\)/);
      if (mdMatch) {
        imageUrl = mdMatch[1];
      }
      setOutputImage(imageUrl, setOutputTab);
      showToast("Antigravity Tool run successfully from story!");
    }
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
}

$("btnChatSend").addEventListener("click", async () => {
  try {
    const prompt = $("chatPrompt").value.trim();
    if (!prompt) {
      setOutput("Enter a message first.", setOutputTab, true);
      return;
    }
    showOutputLoading("Sending...", setOutputTab);

    let fullText = "";
    setOutput("Sending...", setOutputTab, false, true);
    const images = await readImages("chatImages");
    await callLlm(
      prompt,
      (part) => {
        fullText += part;
        setOutput(fullText, setOutputTab, false, true);
      },
      collectLlmConfig,
      images
    );
    setOutput(fullText || "(empty response)", setOutputTab);
  } catch (e) {
    setOutput(e && e.message ? e.message : String(e), setOutputTab, true);
  }
});

$("btnChatGenImage").addEventListener("click", handleChatGenImage);
$("btnPromptGenImage").addEventListener("click", handlePromptGenImage);

$("btnDownloadImage").addEventListener("click", () => {
  const img = $("generatedImage");
  if (!img || !img.src) return;
  const link = document.createElement("a");
  link.href = img.src;
  link.download = `generated-image-${Date.now()}.png`;
  link.click();
});

const scrapeBtn = $("btnScrapeImages");
if (scrapeBtn) {
  scrapeBtn.addEventListener("click", () => {
    const html = $("scrapeHtml").value || "";
    const urls = parseImageUrlsFromHtml(html);
    if (!urls.length) {
      showToast("No images found in HTML.", "error");
    }
    renderScrapedImages(urls);
  });
}

const scrapeRefreshBtn = $("btnRefreshScrape");
if (scrapeRefreshBtn) {
  scrapeRefreshBtn.addEventListener("click", () => {
    const html = $("scrapeHtml").value || "";
    const urls = parseImageUrlsFromHtml(html);
    renderScrapedImages(urls);
  });
}

const scrapeClearBtn = $("btnClearScrape");
if (scrapeClearBtn) {
  scrapeClearBtn.addEventListener("click", () => {
    const input = $("scrapeHtml");
    if (input) input.value = "";
    clearScrapeGallery();
  });
}

const scrapeSelectAllBtn = $("btnSelectAllScraped");
if (scrapeSelectAllBtn) {
  scrapeSelectAllBtn.addEventListener("click", () => {
    const container = $("scrapedImages");
    if (!container) return;
    const checks = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    );
    if (!checks.length) return;
    const allSelected = checks.every((el) => el.checked);
    checks.forEach((el) => {
      el.checked = !allSelected;
    });
    updateScrapeStatus();
  });
}

const scrapeDownloadBtn = $("btnDownloadScrapedZip");
if (scrapeDownloadBtn) {
  scrapeDownloadBtn.addEventListener("click", () => {
    downloadSelectedScrapeZip().catch(() => {
      showToast("Failed to build zip.", "error");
    });
  });
}

// Main Init
(async () => {
  try {
    await api("/api/health", { method: "GET" });
    await loadPrompts();
    initWorkspacesState();
    wireCustom("duration", "durationCustom");
    wireCustom("resolution", "resolutionCustom");
    wireCustom("aspect", "aspectCustom");

    const chatImagesEl = $("chatImages");
    if (chatImagesEl) {
      chatImagesEl.addEventListener("change", () =>
        handleImagePick("chatImages", "chatImagesList")
      );
    }
    const promptImagesEl = $("promptImages");
    if (promptImagesEl) {
      promptImagesEl.addEventListener("change", () =>
        handleImagePick("promptImages", "promptImagesList")
      );
    }
    const videoPartsEl = $("videoParts");
    if (videoPartsEl) {
      videoPartsEl.addEventListener("change", () => {
        renderFilesList("videoParts", "videoPartsList", "Remove video");
        const status = $("videoStatus");
        if (status) status.textContent = "";
        clearVideoPreview();
      });
    }

    const imageGenTypeEl = $("imageGenType");
    if (imageGenTypeEl) {
      const updateImageGenVisibility = (type) => {
        const modelEl = $("imageGenModel");
        const sizeRow = $("imageGenSizeRow");
        if (type === "llm") {
          modelEl.value = modelEl.dataset.defaultLlm || "gemini-3-flash";
          if (sizeRow) sizeRow.style.display = "none";
        } else {
          modelEl.value = modelEl.dataset.defaultImg || "gemini-3-pro-image";
          if (sizeRow) sizeRow.style.display = "block";
        }
      };

      imageGenTypeEl.addEventListener("change", (e) => {
        updateImageGenVisibility(e.target.value);
        saveSettings(captureSettings());
      });

      // Initial visibility based on current value
      updateImageGenVisibility(imageGenTypeEl.value);
    }

    const promptFieldIds = [
      "promptName",
      "story",
      "mode",
      "duration",
      "durationCustom",
      "resolution",
      "resolutionCustom",
      "aspect",
      "aspectCustom",
      "partLengthSeconds",
      "style",
      "camera",
      "lighting",
      "actionBeats",
      "quality",
      "audio",
    ];
    for (const id of promptFieldIds) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener("input", saveActiveWorkspaceFields);
      el.addEventListener("change", saveActiveWorkspaceFields);
    }

    if ($("workspaceTabs")) {
      $("workspaceTabs").addEventListener("dblclick", () => {
        const ws = getActiveWorkspace(activeWorkspaceId, workspaces);
        if (!ws) return;
        const next = prompt("Workspace name:", ws.name);
        if (!next) return;
        ws.name = next.trim();
        renderWorkspaceTabs(
          activeWorkspaceId,
          workspaces,
          switchWorkspace,
          deleteWorkspace
        );
        saveWorkspaces(activeWorkspaceId, workspaces);
      });
    }

    const providerEl = $("provider");
    const cmdEl = $("providerCommand");
    const cmdPresetEl = $("commandPreset");
    const cmdCustomEl = $("commandCustom");
    const codexModelRowEl = $("codexModelRow");
    const codexSessionRowEl = $("codexSessionRow");
    const codexModelPresetEl = $("codexModelPreset");
    const codexModelCustomEl = $("codexModelCustom");
    const codexNewTopicEl = $("btnCodexNewTopic");
    const codexSessionModeEl = $("codexSessionMode");
    const geminiModelRowEl = $("geminiModelRow");
    const geminiModelPresetEl = $("geminiModelPreset");
    const geminiModelCustomEl = $("geminiModelCustom");
    const copilotModelRowEl = $("copilotModelRow");
    const ollamaEl = $("providerOllama");
    const openaiEl = $("providerOpenAi");

    const updateCommandPreset = () => {
      if (
        !cmdPresetEl ||
        !cmdCustomEl ||
        !codexModelRowEl ||
        !codexSessionRowEl ||
        !geminiModelRowEl
      )
        return;
      const isCustom = cmdPresetEl.value === "custom";
      const isCodex = cmdPresetEl.value === "codex";
      const isGemini = cmdPresetEl.value === "gemini";
      const isCopilot = cmdPresetEl.value === "copilot";
      cmdCustomEl.style.display = isCustom ? "block" : "none";
      codexModelRowEl.style.display = isCodex ? "block" : "none";
      codexSessionRowEl.style.display = isCodex ? "block" : "none";
      geminiModelRowEl.style.display = isGemini ? "block" : "none";
      copilotModelRowEl.style.display = isCopilot ? "block" : "none";
      if (isGemini) {
        updateGeminiModelPreset();
      }
    };
    const updateGeminiModelPreset = () => {
      if (!geminiModelPresetEl || !geminiModelCustomEl) return;
      geminiModelCustomEl.style.display =
        geminiModelPresetEl.value === "custom" ? "block" : "none";
    };
    const updateCodexModelPreset = () => {
      if (!codexModelPresetEl || !codexModelCustomEl) return;
      codexModelCustomEl.style.display =
        codexModelPresetEl.value === "custom" ? "block" : "none";
    };
    const updateProvider = () => {
      cmdEl.style.display = providerEl.value === "command" ? "block" : "none";
      ollamaEl.style.display = providerEl.value === "ollama" ? "block" : "none";
      openaiEl.style.display =
        providerEl.value === "openai_compatible" ? "block" : "none";
      if ($("providerImageGen")) {
        $("providerImageGen").style.display =
          providerEl.value === "image_gen" ? "block" : "none";
      }
      $("providerPuter").style.display =
        providerEl.value === "puter" ? "block" : "none";
      if ($("providerGpt4Free")) {
        $("providerGpt4Free").style.display =
          providerEl.value === "gpt4free" ? "block" : "none";
      }
      llmConnected = false;
      updateLlmTabs(llmConnected);
    };

    providerEl.addEventListener("change", updateProvider);

    if ($("toggleImageGenApiKey")) {
      $("toggleImageGenApiKey").addEventListener("click", () => {
        const input = $("imageGenApiKey");
        const icon = $("eyeIconImageGen");
        if (input.type === "password") {
          input.type = "text";
          icon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          `;
        } else {
          input.type = "password";
          icon.innerHTML = `
            <path d="M1 12s4-8 11-8 11-8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          `;
        }
      });
    }
    if (cmdPresetEl)
      cmdPresetEl.addEventListener("change", updateCommandPreset);
    if (codexModelPresetEl)
      codexModelPresetEl.addEventListener("change", updateCodexModelPreset);
    if (geminiModelPresetEl)
      geminiModelPresetEl.addEventListener("change", updateGeminiModelPreset);

    if ($("compressImages")) {
      $("compressImages").addEventListener("change", () =>
        saveSettings(captureSettings())
      );
    }
    if (codexNewTopicEl && codexSessionModeEl) {
      codexNewTopicEl.addEventListener("click", () => {
        codexSessionModeEl.value = "new";
        saveSettings(captureSettings());
      });
    }

    applySettings(loadSettings());
    updateProvider();
    updateCommandPreset();
    updateCodexModelPreset();
    updateGeminiModelPreset();

    const previewEl = $("outputPreview");
    if (previewEl) previewEl.textContent = PREVIEW_TEMPLATE;
    setOutputTab("preview");
    setLlmStatus("Server connected. Click Connect to test LLM.");
    llmConnected = false;
    updateLlmTabs(llmConnected);

    setOutput(
      "Connected. Choose a prompt and click “Get prompt template”.",
      setOutputTab
    );
  } catch (e) {
    llmConnected = false;
    updateLlmTabs(llmConnected);
    setLlmStatus("Not connected.", true);
    setOutput(
      "GUI server is up, but MCP bridge is not ready. Did you run `npm run build`?\n\n" +
        (e && e.message ? e.message : String(e)),
      setOutputTab,
      true
    );
  }
})();
