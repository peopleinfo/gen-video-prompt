import {
  $,
  compressImage,
  copyTextWithOptionalImage,
  copyToClipboard,
  getImageNames,
  pickValue,
  readImages,
  readVideos,
  renderFilesList,
  renderImagesList,
  showToast,
} from "./utils.js";

export let outputParts = [];
export const partImageFiles = new Map();

export function extractParts(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const parts = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^Part\s+\d+\b/i);
    if (match) {
      if (current) {
        current.text = current.lines.join("\n").trim();
        if (current.text) parts.push(current);
      }
      current = { label: line.trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) {
    current.text = current.lines.join("\n").trim();
    if (current.text) parts.push(current);
  }
  return parts;
}

export async function copyImageOnly(imageFile) {
  if (!imageFile) return false;
  const canWrite =
    navigator.clipboard?.write && typeof ClipboardItem !== "undefined";
  if (!canWrite) return false;
  const prepared = await normalizeImageForClipboard(imageFile);
  const mimeType = prepared.type || "image/png";
  if (ClipboardItem.supports && !ClipboardItem.supports(mimeType)) return false;
  await navigator.clipboard.write([
    new ClipboardItem({
      [mimeType]: prepared,
    }),
  ]);
  return true;
}

async function normalizeImageForClipboard(file) {
  const mimeType = file.type || "image/png";
  if (mimeType === "image/png") return file;
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to render image.");
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode image."));
      }, "image/png");
    });
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to render image.");
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode image."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function renderPartImageInputs() {
  const container = $("partImageInputs");
  if (!container) return;
  container.innerHTML = "";
  if (!outputParts.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  outputParts.forEach((part, index) => {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "4px";
    wrapper.style.minWidth = "160px";
    const label = document.createElement("label");
    const labelText = part.label || `Part ${index + 1}`;
    label.textContent = `${labelText} image`;
    label.style.fontSize = "12px";
    label.style.color = "var(--muted)";
    label.setAttribute("for", `partImage-${index}`);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.id = `partImage-${index}`;
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy image";
    copyButton.style.marginTop = "0";
    copyButton.style.display = "none";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove image";
    removeButton.style.marginTop = "0";
    removeButton.style.display = "none";
    removeButton.style.borderColor = "var(--danger)";
    removeButton.style.background = "rgba(255, 106, 106, 0.2)";
    removeButton.style.color = "var(--danger)";
    input.addEventListener("change", async () => {
      const compressEnabled =
        $("compressImages") && $("compressImages").checked;
      const quality = parseFloat($("compressionQuality").value) || 0.8;
      if (compressEnabled && input.files && input.files.length) {
        const originalFiles = Array.from(input.files);
        const compressedFiles = await Promise.all(
          originalFiles.map((f) => compressImage(f, quality))
        );
        const dt = new DataTransfer();
        compressedFiles.forEach((f) => {
          dt.items.add(f);
        });
        input.files = dt.files;
      }
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (file) {
        partImageFiles.set(index, file);
        copyButton.style.display = "inline-flex";
        removeButton.style.display = "inline-flex";
      } else {
        partImageFiles.delete(index);
        copyButton.style.display = "none";
        removeButton.style.display = "none";
      }
    });
    removeButton.addEventListener("click", () => {
      partImageFiles.delete(index);
      input.value = "";
      copyButton.style.display = "none";
      removeButton.style.display = "none";
      showToast(`Removed ${labelText} image.`);
    });
    copyButton.addEventListener("click", async () => {
      const file = partImageFiles.get(index);
      if (!file) return;
      try {
        if (!window.isSecureContext) {
          showToast("Image copy requires HTTPS (or localhost).", "error");
          return;
        }
        const copied = await copyImageOnly(file);
        if (copied) {
          showToast(`Copied ${labelText} image.`);
        } else {
          showToast("Image copy not supported in this browser.", "error");
        }
      } catch {
        showToast("Copy failed.", "error");
      }
    });
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(copyButton);
    wrapper.appendChild(removeButton);
    container.appendChild(wrapper);
  });
}

export function updateOutputParts(
  text,
  setOutputTab,
  isError = false,
  isLoading = false
) {
  const select = $("partSelect");
  const copyAll = $("btnCopyParts");
  if (!select || !copyAll) return;
  outputParts = [];
  partImageFiles.clear();
  select.innerHTML = "";
  if (isLoading) {
    select.disabled = true;
    copyAll.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Loading parts...";
    select.appendChild(opt);
    renderPartImageInputs();
    return;
  }
  if (isError || !text || !text.trim()) {
    select.disabled = true;
    copyAll.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No parts detected";
    select.appendChild(opt);
    renderPartImageInputs();
    return;
  }
  outputParts = extractParts(text);
  if (!outputParts.length) {
    select.disabled = true;
    copyAll.disabled = true;
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No parts detected";
    select.appendChild(opt);
    renderPartImageInputs();
    return;
  }
  select.disabled = false;
  copyAll.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select part to copy";
  select.appendChild(placeholder);
  outputParts.forEach((part, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = part.label || `Part ${index + 1}`;
    select.appendChild(opt);
  });
  select.value = "";
  renderPartImageInputs();
}

export function setOutput(
  text,
  setOutputTab,
  isError = false,
  isLoading = false
) {
  const el = $("output");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "error" : isLoading ? "loading" : "";
  updateOutputParts(text, setOutputTab, isError, isLoading);
}

export function showOutputLoading(text, setOutputTab) {
  setOutputTab("output");
  setOutput(text, setOutputTab, false, true);
}

export function capturePromptFields() {
  return {
    promptName: $("promptName").value || "",
    story: $("story").value || "",
    mode: $("mode").value || "",
    duration: pickValue("duration", "durationCustom") || "",
    resolution: pickValue("resolution", "resolutionCustom") || "",
    aspect: pickValue("aspect", "aspectCustom") || "",
    partLengthSeconds: $("partLengthSeconds").value || "",
    style: $("style").value || "",
    camera: $("camera").value || "",
    lighting: $("lighting").value || "",
    actionBeats: $("actionBeats").value || "",
    quality: $("quality").value || "",
    audio: $("audio").value || "",
  };
}

export function applyPromptFields(fields, setSelectWithCustom) {
  if (!fields) return;
  const set = (id, value) => {
    if (value === undefined || value === null) return;
    const el = $(id);
    if (!el) return;
    el.value = String(value);
  };
  set("promptName", fields.promptName);
  set("story", fields.story);
  set("mode", fields.mode || "auto");
  setSelectWithCustom("duration", "durationCustom", fields.duration || "15");
  setSelectWithCustom("resolution", "resolutionCustom", fields.resolution);
  setSelectWithCustom("aspect", "aspectCustom", fields.aspect);
  set("partLengthSeconds", fields.partLengthSeconds);
  set("style", fields.style);
  set("camera", fields.camera);
  set("lighting", fields.lighting);
  set("actionBeats", fields.actionBeats);
  set("quality", fields.quality);
  set("audio", fields.audio);
}

export function clearPromptImages() {
  const input = $("promptImages");
  const list = $("promptImagesList");
  if (input) input.value = "";
  if (list) list.textContent = "";
}

export function buildStoryWithImages(story, imageNames) {
  const base = (story || "").trim();
  if (!imageNames || imageNames.length === 0) return base;
  const labels = [
    "Character reference",
    "Start frame reference",
    "End frame reference",
  ];
  const lines = imageNames.map((name, index) => {
    const label = labels[index] || "Additional reference";
    return `- ${label}: ${name}`;
  });
  const header =
    "Image references (use filenames as cues for character/start/end frames):";
  return [base, "", header, ...lines].filter(Boolean).join("\n");
}

export function getTotalDurationSeconds() {
  const raw = pickValue("duration", "durationCustom");
  if (!raw) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export function getPartLengthSeconds() {
  const raw = ($("partLengthSeconds").value || "").trim();
  if (!raw) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export function assertValidPartLength() {
  const total = getTotalDurationSeconds();
  const part = getPartLengthSeconds();
  if (part !== undefined && total !== undefined && part >= total) {
    throw new Error("Part length must be less than total duration.");
  }
}
