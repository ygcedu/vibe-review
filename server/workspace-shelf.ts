import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ShelfEntry } from "../shared/workspace-commit.ts";

function decode(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const code = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[key] ?? entity;
  });
}
function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1], decode(match[2] ?? match[3])]));
}

export async function readIdeShelf(projectDirectory: string): Promise<ShelfEntry[]> {
  const shelfDirectory = join(projectDirectory, ".idea", "shelf");
  let names: string[];
  try { names = await readdir(shelfDirectory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries: ShelfEntry[] = [];
  for (const name of names.filter((name) => name.endsWith(".xml"))) {
    const xml = await readFile(join(shelfDirectory, name), "utf8");
    const root = xml.match(/<changelist\b[^>]*>/)?.[0];
    if (!root) continue;
    const meta = attributes(root);
    if (meta.recycled === "true" || meta.deleted === "true") continue;
    const options = Object.fromEntries([...xml.matchAll(/<option\b[^>]*\/?\s*>/g)].map(([tag]) => {
      const value = attributes(tag);
      return [value.name, value.value];
    }));
    const files: string[] = [];
    if (options.PATH) {
      const patchPath = resolve(projectDirectory, options.PATH.replaceAll("$PROJECT_DIR$", projectDirectory));
      const localPath = relative(projectDirectory, patchPath);
      if (localPath === ".." || localPath.startsWith("../") || isAbsolute(localPath)) throw new Error(`Shelf 补丁路径超出项目目录：${name}`);
      const patch = await readFile(patchPath, "utf8");
      for (const match of patch.matchAll(/^Index: (.+)\r?$/gm)) files.push(match[1].replace(/\r$/, ""));
    }
    for (const [tag] of xml.matchAll(/<binary\b[^>]*>/g)) {
      const binary = attributes(tag);
      const path = binary.AFTER_PATH || binary.BEFORE_PATH;
      if (path) files.push(path);
    }
    const timestamp = Number(meta.date);
    entries.push({ id: `idea:${name}`, ref: "WebStorm Shelf", message: options.DESCRIPTION || meta.name || name,
      date: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : "", files: [...new Set(files)] });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export async function readIdeShelfDiff(projectDirectory: string, entryId: string, path: string): Promise<string> {
  const entry = (await readIdeShelf(projectDirectory)).find((entry) => entry.id === entryId);
  if (!entry || !entry.files.includes(path)) throw new Error("暂存文件已变化，请刷新 Shelf");
  const name = entry.id.slice("idea:".length);
  const xml = await readFile(join(projectDirectory, ".idea", "shelf", name), "utf8");
  const option = [...xml.matchAll(/<option\b[^>]*>/g)].map(([tag]) => attributes(tag)).find((value) => value.name === "PATH");
  if (!option?.value) throw new Error("该暂存文件没有可显示的文本差异");
  const patchPath = resolve(projectDirectory, option.value.replaceAll("$PROJECT_DIR$", projectDirectory));
  const localPath = relative(projectDirectory, patchPath);
  if (localPath === ".." || localPath.startsWith("../") || isAbsolute(localPath)) throw new Error("Shelf 补丁路径超出项目目录");
  const patch = await readFile(patchPath, "utf8");
  const section = patch.split(/^Index: /m).slice(1).find((section) => section.split(/\r?\n/, 1)[0] === path);
  if (!section) throw new Error("该暂存文件没有可显示的文本差异");
  const start = section.search(/^(?:diff --git |--- )/m);
  if (start < 0) throw new Error("该暂存文件没有可显示的文本差异");
  const diff = section.slice(start);
  return diff.startsWith("diff --git ") ? diff : `diff --git a/${path} b/${path}\n${diff}`;
}
