let chatAbortController = null;
let setActiveTab = () => {};

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  await restoreChatState();
  await restorePromptState();
  loadGallery();

  document
    .getElementById("downloadAll")
    .addEventListener("click", downloadAllAsZip);
  document.getElementById("clearAll").addEventListener("click", clearAll);
  document.getElementById("sendChat").addEventListener("click", sendChat);
  document.getElementById("abortChat").addEventListener("click", abortChat);
  document
    .getElementById("fillPrompt")
    .addEventListener("click", fillPromptWithLlm);
  document
    .getElementById("sendPrompt")
    .addEventListener("click", () => sendPromptMessage("send-prompt"));
  document
    .getElementById("useChatOutput")
    .addEventListener("click", useChatOutputAsPrompt);
  document.getElementById("openApi").addEventListener("click", openApiTab);

  const chatPrompt = document.getElementById("chatPrompt");
  chatPrompt.addEventListener("input", () => {
    saveChatState({ prompt: chatPrompt.value });
  });

  const promptInput = document.getElementById("promptInput");
  promptInput.addEventListener("input", () => {
    savePromptState(promptInput.value);
  });
});

function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".tab-content"));

  const activate = (name) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === name;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    panels.forEach((panel) => {
      const isActive = panel.id === `tab-${name}`;
      panel.classList.toggle("active", isActive);
      panel.dataset.active = isActive ? "true" : "false";
    });

    if (name === "gui") {
      const iframe = document.querySelector("#tab-gui iframe");
      if (iframe && iframe.dataset.src && iframe.src !== iframe.dataset.src) {
        iframe.src = iframe.dataset.src;
      }
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.tab));
  });

  setActiveTab = activate;
  activate("prompt");
}

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
        `Request failed: ${response.status}${
          errorText ? ` - ${errorText}` : ""
        }`
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

async function sendPromptMessage(type) {
  const promptInput = document.getElementById("promptInput");
  const text = (promptInput.value || "").trim();
  if (!text) {
    showStatus("Enter a prompt first");
    return;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  let targetTab = null;
  if (activeTab && isChatGptUrl(activeTab.url)) {
    targetTab = activeTab;
  } else {
    const matchingTabs = await chrome.tabs.query({
      url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    });
    targetTab = matchingTabs[0] || null;
  }

  if (!targetTab || !targetTab.id) {
    showStatus("Open ChatGPT to send prompts");
    return;
  }

  try {
    await chrome.tabs.sendMessage(targetTab.id, {
      type,
      text,
    });
    showStatus(type === "fill-prompt" ? "Prompt filled" : "Prompt sent");
  } catch (error) {
    console.error("Send prompt error:", error);
    showStatus("Refresh ChatGPT tab and try again");
  }
}

async function fillPromptWithLlm() {
  const promptInput = document.getElementById("promptInput");
  const text = (promptInput.value || "").trim();
  if (!text) {
    showStatus("Enter a prompt first");
    return;
  }

  showStatus("Filling prompt...");

  const body = {
    prompt: text,
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
    const response = await fetch("https://localhost:3333/api/chat", {
      headers: {
        accept: "*/*",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      method: "POST",
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Request failed: ${response.status}${
          errorText ? ` - ${errorText}` : ""
        }`
      );
    }

    const data = await response.json().catch(() => null);
    const resultText = data && typeof data.text === "string" ? data.text : "";

    if (!resultText) {
      showStatus("No response text");
      return;
    }

    promptInput.value = resultText;
    savePromptState(resultText);
    showStatus("Prompt filled");
  } catch (error) {
    console.error("Fill prompt error:", error);
    showStatus("Fill failed");
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

async function restorePromptState() {
  const { promptInputValue = "" } = await chrome.storage.local.get([
    "promptInputValue",
  ]);
  const promptInput = document.getElementById("promptInput");
  promptInput.value = promptInputValue;
}

function saveChatState({ prompt, output }) {
  const data = {};
  if (typeof prompt === "string") data.chatPromptValue = prompt;
  if (typeof output === "string") data.chatOutputValue = output;
  if (Object.keys(data).length > 0) {
    chrome.storage.local.set(data);
  }
}

function savePromptState(value) {
  chrome.storage.local.set({ promptInputValue: value });
}

function useChatOutputAsPrompt() {
  const chatOutput = document.getElementById("chatOutput");
  const promptInput = document.getElementById("promptInput");
  const text = (chatOutput.textContent || "").trim();

  if (!text) {
    showStatus("No chat response to use");
    return;
  }

  promptInput.value = text;
  savePromptState(text);
  setActiveTab("prompt");
  promptInput.focus();
  showStatus("Response moved to Prompt");
}

function isChatGptUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("https://chatgpt.com/") ||
    url.startsWith("https://chat.openai.com/")
  );
}

function openApiTab() {
  chrome.tabs.create({ url: "https://localhost:3333/" });
}
