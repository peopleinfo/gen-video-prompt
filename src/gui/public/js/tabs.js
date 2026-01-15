import { $, showToast } from './utils.js';

export function isTabDisabled(name) {
  const el = $("tab-" + name);
  return el && el.dataset.disabled === "true";
}

export function setTabDisabled(name, disabled) {
  const el = $("tab-" + name);
  if (!el) return;
  el.dataset.disabled = String(disabled);
  el.setAttribute("aria-disabled", String(disabled));
  if (disabled && el.dataset.active === "true") {
    setTab("setup");
  }
}

export function setTab(active) {
  if (isTabDisabled(active)) {
    showToast("Connect an LLM to use Chat and Prompts.", "error");
    return;
  }
  const views = ["setup", "chat", "prompts", "docs", "tools"];
  for (const v of views) {
    const tabEl = $("tab-" + v);
    const viewEl = $("view-" + v);
    if (tabEl) tabEl.dataset.active = String(v === active);
    if (viewEl) viewEl.style.display = v === active ? "block" : "none";
  }
}

export function setOutputTab(active) {
  const views = ["output", "preview", "video"];
  for (const v of views) {
    const tabEl = $("tab-" + v);
    if (tabEl) tabEl.dataset.active = String(v === active);
  }
  const outputEl = $("output");
  const previewEl = $("outputPreview");
  const videoPanel = $("videoPanel");
  if (outputEl) outputEl.style.display = active === "output" ? "block" : "none";
  if (previewEl) previewEl.style.display = active === "preview" ? "block" : "none";
  if (videoPanel) videoPanel.style.display = active === "video" ? "block" : "none";
  const actions = $("outputActions");
  if (actions) actions.style.display = active === "output" ? "flex" : "none";
}

export function updateLlmTabs(llmConnected) {
  const disabled = !llmConnected;
  setTabDisabled("chat", disabled);
  setTabDisabled("prompts", disabled);
}
