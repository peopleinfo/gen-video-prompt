export type DocType = "markdown" | "pdf" | "text";
export type PromptMode = "auto" | "story" | "meme" | "documentary" | "history";

export type DocInfo = {
  id: string;
  absPath: string;
  type: DocType;
  title: string;
  info: string;
};
