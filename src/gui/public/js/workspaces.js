import { $ } from './utils.js';

export const WORKSPACE_KEY = "gen-video-prompt.gui.workspaces.v1";

export function newWorkspace(name) {
  return {
    id: `ws_${Math.random().toString(16).slice(2)}`,
    name,
    fields: { duration: "15" },
    output: "",
  };
}

export function loadWorkspaces() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.workspaces)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspaces(activeWorkspaceId, workspaces) {
  try {
    localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({ activeId: activeWorkspaceId, workspaces })
    );
  } catch {}
}

export function getActiveWorkspace(activeWorkspaceId, workspaces) {
  return workspaces.find((ws) => ws.id === activeWorkspaceId) || workspaces[0];
}

export function renderWorkspaceTabs(activeWorkspaceId, workspaces, switchWorkspace, deleteWorkspace) {
  const container = $("workspaceTabs");
  if (!container) return;
  container.innerHTML = "";
  for (const ws of workspaces) {
    const btn = document.createElement("div");
    btn.className = "tab";
    btn.dataset.active = String(ws.id === activeWorkspaceId);
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.gap = "6px";
    const label = document.createElement("span");
    label.textContent = ws.name;
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "x";
    close.title = "Close workspace";
    close.setAttribute("aria-label", "Close workspace");
    close.style.marginTop = "0";
    close.style.padding = "0 6px";
    close.style.borderColor = "var(--border)";
    close.style.background = "rgba(0, 0, 0, 0.35)";
    close.style.color = "var(--muted)";
    close.style.fontWeight = "700";
    close.style.lineHeight = "1.2";
    close.style.fontSize = "12px";
    close.style.display = workspaces.length > 1 ? "inline-flex" : "none";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteWorkspace(ws.id);
    });
    btn.addEventListener("click", () => switchWorkspace(ws.id));
    btn.appendChild(label);
    btn.appendChild(close);
    container.appendChild(btn);
  }
  const addBtn = document.createElement("div");
  addBtn.className = "tab";
  addBtn.dataset.active = "false";
  addBtn.style.display = "inline-flex";
  addBtn.style.alignItems = "center";
  addBtn.style.justifyContent = "center";
  addBtn.style.width = "32px";
  addBtn.style.padding = "8px 0";
  addBtn.textContent = "+";
  addBtn.title = "New workspace";
  addBtn.addEventListener("click", () => {
    const name = `Workspace ${workspaces.length + 1}`;
    const ws = newWorkspace(name);
    workspaces.push(ws);
    switchWorkspace(ws.id);
  });
  container.appendChild(addBtn);
}
