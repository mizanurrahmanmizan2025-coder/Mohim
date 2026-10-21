/**
 * Client-side helpers for files and folders before upload.
 * - Folder files are re-wrapped as File objects named with their relative path
 *   ("my-app/src/index.js") so the server can rebuild the directory tree.
 * - Junk folders (node_modules, .git, build output …) are dropped BEFORE upload,
 *   which keeps uploads small and fast.
 */
export const MAX_UPLOAD_MB = 60; // total per message (server: MAX_UPLOAD_TOTAL_MB)
export const MAX_FILE_MB = 25; // per file (server: MAX_UPLOAD_MB)
export const MAX_FOLDER_FILES = 500;

const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '__pycache__',
  '.venv', 'venv', 'vendor', '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle', 'Pods', '.dart_tool', '.cache', '.turbo', '__MACOSX']);
const IGNORE_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store|Thumbs\.db)$|\.(min\.(js|css)|map|exe|dll|so|dylib|mp4|mov|mp3|wav|zip|tar|gz|7z|rar|iso|psd|ai)$/i;

export const ACCEPT_FILES = '.zip,.pdf,.doc,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md,.json,.xml,.yaml,.yml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.kt,.c,.h,.cpp,.cs,.go,.rb,.php,.rs,.swift,.dart,.sql,.sh,.vue,.svelte,image/*';

export const isIgnored = (path) => path.split('/').slice(0, -1).some((seg) => IGNORE_DIRS.has(seg)) || IGNORE_FILE.test(path);

const withPath = (file, path) => new File([file], path, { type: file.type, lastModified: file.lastModified });

/** From an <input webkitdirectory> FileList → { name, files, skipped, size } */
export function folderFromInput(fileList) {
  const all = [...fileList];
  if (!all.length) return null;
  const name = (all[0].webkitRelativePath || all[0].name).split('/')[0];
  const files = [];
  let skipped = 0;
  for (const f of all) {
    const p = f.webkitRelativePath || f.name;
    if (isIgnored(p) || files.length >= MAX_FOLDER_FILES) { skipped += 1; continue; }
    files.push(withPath(f, p));
  }
  return { name, files, skipped, size: files.reduce((n, f) => n + f.size, 0) };
}

/** Reads dropped items; folders are walked recursively. Returns { singles: File[], folders: [...] } */
export async function readDropped(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return { singles: [...(dataTransfer.files || [])], folders: [] };

  const fileOf = (entry) => new Promise((res) => entry.file(res, () => res(null)));
  const readAll = (dir) => new Promise((res) => {
    const reader = dir.createReader();
    const out = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) res(out); else { out.push(...batch); next(); } }, () => res(out));
    next();
  });

  const singles = [];
  const folders = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const f = await fileOf(entry);
      if (f) singles.push(f);
      continue;
    }
    const files = [];
    let skipped = 0;
    const walk = async (dir, prefix) => {
      for (const child of await readAll(dir)) {
        const p = `${prefix}/${child.name}`;
        if (child.isDirectory) {
          if (IGNORE_DIRS.has(child.name)) { skipped += 1; continue; }
          await walk(child, p);
        } else if (files.length < MAX_FOLDER_FILES && !isIgnored(p)) {
          const f = await fileOf(child);
          if (f) files.push(withPath(f, p));
        } else skipped += 1;
      }
    };
    await walk(entry, entry.name);
    folders.push({ name: entry.name, files, skipped, size: files.reduce((n, f) => n + f.size, 0) });
  }
  return { singles, folders };
}

/** Compact attachment list for the chat bubble (a folder = one chip). */
export function summarizeAttachments(files) {
  const out = [];
  const folders = new Map();
  for (const f of files) {
    if (f.name.includes('/')) {
      const top = f.name.split('/')[0];
      const cur = folders.get(top) || { name: `${top}/`, mimeType: 'inode/directory', size: 0, count: 0 };
      cur.size += f.size;
      cur.count += 1;
      folders.set(top, cur);
    } else out.push({ name: f.name, mimeType: f.type, size: f.size });
  }
  return [...folders.values(), ...out];
}

export const formatBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
