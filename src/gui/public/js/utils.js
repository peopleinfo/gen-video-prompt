export const $ = (id) => document.getElementById(id);

export function showToast(message, variant = "info") {
  const container = $("toastContainer");
  if (!container || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast${variant === "error" ? " error" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  const hideDelay = 2200;
  const removeDelay = hideDelay + 200;
  setTimeout(() => {
    toast.classList.remove("show");
  }, hideDelay);
  setTimeout(() => {
    toast.remove();
  }, removeDelay);
}

export async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return true;
}

export function escapeHtml(text) {
  return (text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function words(str) {
  const s = (str || "").trim();
  if (!s) return [];
  return s.split(/\s+/g);
}

export function pickValue(selectId, customId) {
  const sel = $(selectId);
  const custom = $(customId);
  const v = sel ? sel.value : "";
  if (!v) return undefined;
  if (v === "custom") {
    const cv = custom ? custom.value.trim() : "";
    return cv ? cv : undefined;
  }
  return v;
}

export async function copyTextWithOptionalImage(text, imageFile) {
  if (!text) return { copied: false, usedImage: false };
  if (!imageFile) {
    await copyToClipboard(text);
    return { copied: true, usedImage: false };
  }
  const canWrite =
    navigator.clipboard?.write && typeof ClipboardItem !== "undefined";
  if (!canWrite) {
    await copyToClipboard(text);
    return { copied: true, usedImage: false };
  }
  const prepared = await normalizeImageForClipboard(imageFile);
  const mimeType = prepared.type || "image/png";
  if (ClipboardItem.supports && !ClipboardItem.supports(mimeType)) {
    await copyToClipboard(text);
    return { copied: true, usedImage: false };
  }
  const safeText = escapeHtml(text).replaceAll("\n", "<br>");
  const html = `<p>${safeText}</p>`;
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
      [mimeType]: prepared,
    }),
  ]);
  return { copied: true, usedImage: true };
}

export async function normalizeImageForClipboard(file) {
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

export function manualCompress(file, quality, maxWidth) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(img.src);
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(img.src);
          if (blob) {
            const compressed = new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressed);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(file);
    };
    img.src = URL.createObjectURL(file);
  });
}

export async function compressImage(file, quality = 0.8, maxWidth = 1280) {
  if (!file.type.startsWith("image/")) return file;

  // Use Compressor.js (extremely lightweight ~10KB and robust)
  if (typeof Compressor !== "undefined") {
    return new Promise((resolve) => {
      new Compressor(file, {
        quality: quality,
        maxWidth: maxWidth,
        success(result) {
          resolve(
            new File([result], file.name, {
              type: result.type,
              lastModified: Date.now(),
            })
          );
        },
        error(err) {
          console.warn("Compressor.js failed, falling back to canvas:", err);
          // Fallback to manual canvas compression
          manualCompress(file, quality, maxWidth).then(resolve);
        },
      });
    });
  }

  return manualCompress(file, quality, maxWidth);
}

export function renderImagesList(inputId, listId) {
  const input = $(inputId);
  const list = $(listId);
  if (!input || !list) return;
  const files = input.files ? Array.from(input.files) : [];
  if (!files.length) {
    list.textContent = "";
    return;
  }
  list.innerHTML = "";
  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.marginTop = "4px";
    const name = document.createElement("span");
    name.style.flex = "1";
    name.style.minWidth = "0";
    const fileName = file.name;
    const maxName = 32;
    const displayName =
      fileName.length > maxName
        ? `${fileName.slice(0, 18)}...${fileName.slice(-8)}`
        : fileName;
    name.textContent = `${displayName} (${Math.round(file.size / 1024)} KB)`;
    name.title = fileName;
    name.style.whiteSpace = "nowrap";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "X";
    remove.title = "Remove";
    remove.setAttribute("aria-label", "Remove image");
    remove.style.marginLeft = "auto";
    remove.style.marginTop = "0";
    remove.style.padding = "2px 8px";
    remove.style.borderColor = "var(--danger)";
    remove.style.background = "rgba(255, 106, 106, 0.2)";
    remove.style.color = "var(--danger)";
    remove.style.fontWeight = "700";
    remove.style.fontSize = "12px";
    remove.style.lineHeight = "1";
    remove.addEventListener("click", () => {
      const dt = new DataTransfer();
      files.forEach((f, i) => {
        if (i !== index) dt.items.add(f);
      });
      input.files = dt.files;
      renderImagesList(inputId, listId);
    });
    row.appendChild(name);
    row.appendChild(remove);
    list.appendChild(row);
  });
}

export function renderFilesList(inputId, listId, removeLabel = "Remove file") {
  const input = $(inputId);
  const list = $(listId);
  if (!input || !list) return;
  const files = input.files ? Array.from(input.files) : [];
  if (!files.length) {
    list.textContent = "";
    return;
  }
  list.innerHTML = "";
  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.marginTop = "4px";
    const name = document.createElement("span");
    name.style.flex = "1";
    name.style.minWidth = "0";
    const fileName = file.name;
    const maxName = 32;
    const displayName =
      fileName.length > maxName
        ? `${fileName.slice(0, 18)}...${fileName.slice(-8)}`
        : fileName;
    name.textContent = `${displayName} (${Math.round(file.size / 1024)} KB)`;
    name.title = fileName;
    name.style.whiteSpace = "nowrap";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "X";
    remove.title = removeLabel;
    remove.setAttribute("aria-label", removeLabel);
    remove.style.marginLeft = "auto";
    remove.style.marginTop = "0";
    remove.style.padding = "2px 8px";
    remove.style.borderColor = "var(--danger)";
    remove.style.background = "rgba(255, 106, 106, 0.2)";
    remove.style.color = "var(--danger)";
    remove.style.fontWeight = "700";
    remove.style.fontSize = "12px";
    remove.style.lineHeight = "1";
    remove.addEventListener("click", () => {
      const dt = new DataTransfer();
      files.forEach((f, i) => {
        if (i !== index) dt.items.add(f);
      });
      input.files = dt.files;
      renderFilesList(inputId, listId, removeLabel);
    });
    row.appendChild(name);
    row.appendChild(remove);
    list.appendChild(row);
  });
}

export function getImageNames(inputId) {
  const input = $(inputId);
  if (!input || !input.files) return [];
  return Array.from(input.files).map((file) => file.name);
}

export async function readImages(inputId) {
  const input = $(inputId);
  if (!input || !input.files || input.files.length === 0) return [];
  const files = Array.from(input.files);
  const maxBytes = 10 * 1024 * 1024;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > maxBytes) {
    throw new Error("Total image size exceeds 10MB.");
  }
  return await Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
              reject(new Error("Failed to read image data."));
              return;
            }
            const comma = result.indexOf(",");
            const data = comma >= 0 ? result.slice(comma + 1) : "";
            if (!data) {
              reject(new Error("Invalid image data."));
              return;
            }
            resolve({ name: file.name, type: file.type, data });
          };
          reader.onerror = () =>
            reject(new Error("Failed to read image file."));
          reader.readAsDataURL(file);
        })
    )
  );
}

export async function readVideos(inputId) {
  const input = $(inputId);
  if (!input || !input.files || input.files.length === 0) return [];
  const files = Array.from(input.files);
  const maxBytes = 200 * 1024 * 1024;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > maxBytes) {
    throw new Error("Total video size exceeds 200MB.");
  }
  return await Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result !== "string") {
              reject(new Error("Failed to read video data."));
              return;
            }
            const comma = result.indexOf(",");
            const data = comma >= 0 ? result.slice(comma + 1) : "";
            if (!data) {
              reject(new Error("Invalid video data."));
              return;
            }
            resolve({ name: file.name, type: file.type, data });
          };
          reader.onerror = () =>
            reject(new Error("Failed to read video file."));
          reader.readAsDataURL(file);
        })
    )
  );
}

export function wireCustom(selectId, customId) {
  const sel = $(selectId);
  const custom = $(customId);
  if (!sel || !custom) return;
  const update = () => {
    custom.style.display = sel.value === "custom" ? "block" : "none";
  };
  sel.addEventListener("change", update);
  update();
}

export async function handleImagePick(inputId, listId) {
  const input = $(inputId);
  if (!input || !input.files) return;
  const compressEl = $("compressImages");
  const doCompress = compressEl ? compressEl.checked : false;
  if (doCompress) {
    const originalFiles = Array.from(input.files);
    const compressedFiles = await Promise.all(
      originalFiles.map((file) => compressImage(file))
    );
    const dt = new DataTransfer();
    compressedFiles.forEach((f) => {
      dt.items.add(f);
    });
    input.files = dt.files;
  }
  renderImagesList(inputId, listId);
}
