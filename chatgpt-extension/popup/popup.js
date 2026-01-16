let chatAbortController = null;

document.addEventListener("DOMContentLoaded", async () => {
  await restoreChatState();
  loadGallery();

  document
    .getElementById("downloadAll")
    .addEventListener("click", downloadAllAsZip);
  document.getElementById("clearAll").addEventListener("click", clearAll);
  document.getElementById("sendChat").addEventListener("click", sendChat);
  document.getElementById("abortChat").addEventListener("click", abortChat);
  document
    .getElementById("sendToPrompt")
    .addEventListener("click", sendToPrompt);

  const chatPrompt = document.getElementById("chatPrompt");
  chatPrompt.addEventListener("input", () => {
    saveChatState({ prompt: chatPrompt.value });
  });
});

async function loadGallery() {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];

  const gallery = document.getElementById("gallery");

  if (images.length === 0) {
    gallery.innerHTML =
      '<p class="empty-message">No images yet. Use the buttons on ChatGPT to generate images!</p>';
    return;
  }

  gallery.innerHTML = images
    .map(
      (img, index) => `
    <div class="gallery-item" data-index="${index}">
      <img src="${img.dataUrl}" alt="${img.preset}">
      <span class="label">${img.preset}</span>
      <button class="delete-btn" data-index="${index}">&times;</button>
    </div>
  `
    )
    .join("");

  gallery.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteImage(parseInt(btn.dataset.index));
    });
  });
}

async function deleteImage(index) {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];
  images.splice(index, 1);
  await chrome.storage.local.set({ generatedImages: images });
  loadGallery();
  showStatus("Image deleted");
}

async function clearAll() {
  if (confirm("Delete all images?")) {
    await chrome.storage.local.set({ generatedImages: [] });
    loadGallery();
    showStatus("All images cleared");
  }
}

async function downloadAllAsZip() {
  const result = await chrome.storage.local.get(["generatedImages"]);
  const images = result.generatedImages || [];

  if (images.length === 0) {
    showStatus("No images to download");
    return;
  }

  showStatus("Creating ZIP...");

  try {
    const zip = new JSZip();

    images.forEach((img, index) => {
      const base64Data = img.dataUrl.split(",")[1];
      const ext = img.mimeType?.includes("jpeg") ? "jpg" : "png";
      zip.file(`${img.preset}_${index + 1}.${ext}`, base64Data, {
        base64: true,
      });
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "generated-images.zip";
    a.click();

    URL.revokeObjectURL(url);
    showStatus("ZIP downloaded!");
  } catch (error) {
    console.error("ZIP error:", error);
    showStatus("Error creating ZIP");
  }
}

function showStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  setTimeout(() => {
    status.textContent = "";
  }, 3000);
}

async function sendChat() {
  const promptInput = document.getElementById("chatPrompt");
  const chatOutput = document.getElementById("chatOutput");
  const abortButton = document.getElementById("abortChat");
  const prompt = promptInput.value.trim();

  if (!prompt) {
    showStatus("Enter a prompt first");
    return;
  }

  showStatus("Sending chat...");
  chatOutput.textContent = "";
  saveChatState({ output: "" });
  abortButton.disabled = false;

  const body = {
    prompt,
    provider: "command",
    command: "codex",
    codex_model: "",
    codex_session: "new",
    gemini_model: "",
    ollama: { base_url: "", model: "" },
    openai_compatible: { base_url: "", model: "", api_key: "" },
    puter: { model: "gemini-3-flash-preview" },
    gpt4free: { model: "deepseek" },
    images: [],
  };

  try {
    chatAbortController = new AbortController();
    const response = await fetch("https://localhost:3333/api/chat", {
      headers: {
        accept: "*/*",
        "accept-language": "en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7",
        "content-type": "application/json",
        "sec-ch-ua":
          '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
      method: "POST",
      mode: "cors",
      credentials: "omit",
      signal: chatAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Request failed: ${response.status}${errorText ? ` - ${errorText}` : ""}`
      );
    }

    const data = await response.json().catch(() => null);
    if (data && typeof data.text === "string") {
      chatOutput.textContent = data.text;
      saveChatState({ output: data.text });
    } else {
      chatOutput.textContent = "No response text.";
      saveChatState({ output: chatOutput.textContent });
    }
    showStatus("Chat sent");
  } catch (error) {
    console.error("Chat error:", error);
    showStatus(error.name === "AbortError" ? "Chat aborted" : "Chat failed");
    chatOutput.textContent =
      error.name === "AbortError"
        ? "Chat aborted."
        : "Chat failed. Check console for details.";
    saveChatState({ output: chatOutput.textContent });
  } finally {
    chatAbortController = null;
    abortButton.disabled = true;
  }
}

async function sendToPrompt() {
  const chatOutput = document.getElementById("chatOutput");
  const text = (chatOutput.textContent || "").trim();
  if (!text) {
    showStatus("No output to send");
    return;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab || !tab.id) {
    showStatus("No active tab");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "send-prompt",
      text,
    });
    showStatus("Prompt sent");
  } catch (error) {
    console.error("Send prompt error:", error);
    showStatus("Failed to send");
  }
}

function abortChat() {
  if (chatAbortController) {
    chatAbortController.abort();
  }
}

async function restoreChatState() {
  const { chatPromptValue = "", chatOutputValue = "" } =
    await chrome.storage.local.get(["chatPromptValue", "chatOutputValue"]);
  const chatPrompt = document.getElementById("chatPrompt");
  const chatOutput = document.getElementById("chatOutput");
  chatPrompt.value = chatPromptValue;
  chatOutput.textContent = chatOutputValue;
}

function saveChatState({ prompt, output }) {
  const data = {};
  if (typeof prompt === "string") data.chatPromptValue = prompt;
  if (typeof output === "string") data.chatOutputValue = output;
  if (Object.keys(data).length > 0) {
    chrome.storage.local.set(data);
  }
}
