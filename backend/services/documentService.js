/**
 * services/documentService.js — turns any upload into AI-ready context.
 *
 * Supported:
 *   .zip archives and whole folders (webkitdirectory uploads) → directory tree + every text/code
 *        file (line-numbered), junk folders skipped (node_modules, .git, dist, …)
 *   .pdf (text; scanned PDFs → Gemini OCR)   .docx  .xlsx  .pptx   .csv/.tsv   code & text files
 *   images → Gemini vision                   .doc/.xls/.ppt (old binary) → asks for a newer format
 *
 * processFiles(files) → {
 *   text,          aggregated context for the model (≤ MAX_FILE_CONTEXT_CHARS)
 *   images,        [{ mimeType, data }] for vision
 *   meta,          compact attachment list for the chat bubble (folders/zips collapsed)
 *   summary,       one-line description for the live step ("project.zip · 84 files read, 31 skipped")
 *   isProject,     true when a zip/folder/multi-file code upload → code-review instructions added
 * }
 */
const path = require('path');
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids pdf-parse debug-mode bug
const { readZip, safeName } = require('../utils/zipReader');
const { docxText, pptxText, xlsxText } = require('../utils/officeParser');

const MAX_CONTEXT = Number(process.env.MAX_FILE_CONTEXT_CHARS || 300000); // ≈ 75k tokens
const MAX_FILE_CHARS = Number(process.env.MAX_CHARS_PER_FILE || 40000);
const MAX_TREE_LINES = 600;
const MAX_IMAGES = 6;

/* ───────────────────────── classification ───────────────────────── */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit',
  'coverage', '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', 'env', 'vendor', '.idea', '.vscode',
  'target', 'bin', 'obj', '.gradle', 'Pods', '.dart_tool', '.terraform', '.cache', 'tmp', '.turbo', '__MACOSX',
]);
const IGNORE_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|\.DS_Store|Thumbs\.db)$|\.(min\.(js|css)|map)$/i;
const CODE_EXT = new Set(('js jsx ts tsx mjs cjs py java kt kts c h cpp hpp cc hh cs go rb php html htm css scss sass less vue svelte astro '
  + 'sql sh bash zsh fish ps1 bat cmd rs swift dart lua r m mm scala pl pm gradle groovy graphql gql proto tf hcl prisma sol ex exs erl hs clj elm zig nim').split(' '));
const TEXT_EXT = new Set(('json jsonc json5 yml yaml toml ini cfg conf env properties xml md mdx rst txt csv tsv log svg ipynb editorconfig gitignore dockerignore npmrc nvmrc babelrc eslintrc prettierrc').split(' '));
const NAMED_TEXT = /^(dockerfile|makefile|procfile|gemfile|rakefile|license|readme|changelog|\.env\.example|\.gitignore|\.env\.sample|jenkinsfile|vagrantfile)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

const ext = (name) => path.extname(name).slice(1).toLowerCase();
const isIgnoredPath = (p) => p.split('/').some((seg) => IGNORE_DIRS.has(seg)) || IGNORE_FILES.test(p);
const isCode = (p) => CODE_EXT.has(ext(p));
const isTextish = (p) => isCode(p) || TEXT_EXT.has(ext(p)) || NAMED_TEXT.test(path.basename(p));
const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files that explain a project go first, then source, then tests, then data/docs. */
function priority(p) {
  const base = path.basename(p).toLowerCase();
  if (/^readme/.test(base)) return 0;
  if (/^(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|build\.gradle|composer\.json|gemfile|dockerfile|docker-compose\.ya?ml|\.env\.example|tsconfig\.json|vite\.config\.\w+|next\.config\.\w+)$/.test(base)) return 1;
  if (/(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.\w+$/.test(p)) return 4;
  if (isCode(p)) return 2 + Math.min(p.split('/').length, 6) / 10; // shallower files first
  return 5;
}

function withLineNumbers(text) {
  const lines = text.split('\n');
  const w = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(w)}| ${l}`).join('\n');
}

function langOf(p) {
  const e = ext(p);
  return { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', cs: 'csharp', sh: 'bash', yml: 'yaml', md: 'markdown' }[e] || e || 'text';
}

/* ───────────────────────── directory tree ───────────────────────── */
function buildTree(paths, skippedSet) {
  const root = {};
  for (const p of paths) {
    let node = root;
    const parts = p.split('/').filter(Boolean);
    parts.forEach((part, i) => {
      node[part] = node[part] || (i === parts.length - 1 && !p.endsWith('/') ? null : {});
      if (node[part]) node = node[part];
    });
  }
  const lines = [];
  const walk = (node, prefix, base) => {
    const keys = Object.keys(node).sort((a, b) => (node[a] === null) - (node[b] === null) || a.localeCompare(b));
    keys.forEach((k, i) => {
      if (lines.length >= MAX_TREE_LINES) return;
      const last = i === keys.length - 1;
      const full = base ? `${base}/${k}` : k;
      const isDir = node[k] !== null;
      const ignoredDir = isDir && IGNORE_DIRS.has(k);
      const ignoredFile = !isDir && isIgnoredPath(full);
      lines.push(`${prefix}${last ? '└── ' : '├── '}${k}${isDir ? '/' : ''}${ignoredDir || ignoredFile ? '  (skipped)' : skippedSet.has(full) ? '  (not read)' : ''}`);
      if (isDir && !ignoredDir) walk(node[k], `${prefix}${last ? '    ' : '│   '}`, full);
    });
  };
  walk(root, '', '');
  if (lines.length >= MAX_TREE_LINES) lines.push(`… tree truncated (${paths.length} paths total)`);
  return lines.join('\n');
}

/* ───────────────────────── project (zip / folder) ───────────────────────── */
/**
 * items: [{ path, size, read: () => Buffer|null }]  — shared by zip archives and folder uploads
 */
function buildProject(label, items, budget) {
  const textFiles = [];
  const skipped = new Set();
  let skippedCount = 0;
  const images = [];

  for (const it of items) {
    if (it.path.endsWith('/')) continue;
    if (isIgnoredPath(it.path)) { skippedCount += 1; skipped.add(it.path); continue; }
    if (IMAGE_EXT.test(it.path)) {
      if (images.length < MAX_IMAGES && it.size < 4 * 1024 * 1024) images.push(it);
      else skipped.add(it.path);
      continue;
    }
    if (!isTextish(it.path) && it.size > 200 * 1024) { skipped.add(it.path); skippedCount += 1; continue; }
    textFiles.push(it);
  }
  textFiles.sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));

  const blocks = [];
  let used = 0;
  let read = 0;
  let lines = 0;
  const omitted = [];
  for (const f of textFiles) {
    if (used >= budget) { omitted.push(f.path); continue; }
    const buf = f.read();
    if (!buf || looksBinary(buf)) { skipped.add(f.path); skippedCount += 1; continue; }
    let text = buf.toString('utf8').replace(/\r\n/g, '\n');
    const totalLines = text.split('\n').length;
    let note = '';
    if (text.length > MAX_FILE_CHARS) { text = text.slice(0, MAX_FILE_CHARS); note = ` — first ${MAX_FILE_CHARS.toLocaleString()} chars of ${buf.length.toLocaleString()}`; }
    const body = isCode(f.path) || NAMED_TEXT.test(path.basename(f.path)) ? withLineNumbers(text) : text;
    const block = `=== FILE: ${f.path} (${totalLines} lines${note}) ===\n\`\`\`${langOf(f.path)}\n${body}\n\`\`\``;
    if (used + block.length > budget && read > 0) { omitted.push(f.path); continue; }
    blocks.push(block);
    used += block.length;
    read += 1;
    lines += totalLines;
  }
  omitted.forEach((p) => skipped.add(p));

  const tree = buildTree(items.map((i) => i.path), skipped);
  const header = [
    `=== PROJECT: ${label} ===`,
    `${read} files read (${lines.toLocaleString()} lines)${skippedCount ? `, ${skippedCount} skipped (dependencies/build/binary)` : ''}${omitted.length ? `, ${omitted.length} not included — context limit reached` : ''}.`,
    '',
    'Directory structure:',
    tree,
  ].join('\n');
  const omittedNote = omitted.length ? `\n\nFiles not included (context limit): ${omitted.slice(0, 60).join(', ')}${omitted.length > 60 ? ' …' : ''}` : '';

  return {
    text: `${header}\n\n${blocks.join('\n\n')}${omittedNote}`,
    images,
    summary: `${label} · ${read} files read${skippedCount ? `, ${skippedCount} skipped` : ''}${omitted.length ? `, ${omitted.length} over limit` : ''}`,
    count: items.filter((i) => !i.path.endsWith('/')).length,
  };
}

function zipItems(buffer) {
  const zip = readZip(buffer, {
    maxEntries: Number(process.env.ZIP_MAX_ENTRIES || 5000),
    maxEntryBytes: 5 * 1024 * 1024,
    maxTotalBytes: Number(process.env.ZIP_MAX_UNZIPPED_MB || 150) * 1024 * 1024,
  });
  return zip.entries.map((e) => ({ path: e.name, size: e.size, read: () => zip.read(e) }));
}

/* ───────────────────────── single documents ───────────────────────── */
async function parseSingle(f) {
  const name = f.originalname || 'file';
  const e = ext(name);
  const mt = f.mimetype || '';
  const cap = (t) => (t.length > MAX_FILE_CHARS * 2 ? `${t.slice(0, MAX_FILE_CHARS * 2)}\n… (truncated)` : t);

  if (mt.startsWith('image/') || IMAGE_EXT.test(name)) return { image: { mimeType: mt.startsWith('image/') ? mt : `image/${e === 'jpg' ? 'jpeg' : e}`, data: f.buffer.toString('base64') } };

  if (e === 'pdf' || mt === 'application/pdf') {
    let text = '';
    try { text = (await pdfParse(f.buffer)).text || ''; } catch { text = ''; }
    if (text.trim().length > 50) return { text: `=== FILE: ${name} (PDF) ===\n${cap(text)}` };
    return { image: { mimeType: 'application/pdf', data: f.buffer.toString('base64') }, note: 'scanned PDF → OCR' };
  }
  try {
    if (e === 'docx') return { text: `=== FILE: ${name} (Word) ===\n${cap(docxText(f.buffer))}` };
    if (e === 'xlsx') return { text: `=== FILE: ${name} (Excel) ===\n${cap(xlsxText(f.buffer))}` };
    if (e === 'pptx') return { text: `=== FILE: ${name} (PowerPoint) ===\n${cap(pptxText(f.buffer))}` };
  } catch (err) {
    return { text: `[${name}: could not be read — ${err.message}]` };
  }
  if (['doc', 'xls', 'ppt'].includes(e)) {
    return { text: `[${name}: old binary Office format isn't supported — save it as .${e}x or PDF and upload again]` };
  }
  if (e === 'csv' || e === 'tsv') {
    const all = f.buffer.toString('utf8').replace(/\r\n/g, '\n').split('\n');
    const shown = all.slice(0, 2000);
    return { text: `=== FILE: ${name} (${all.length} rows${all.length > shown.length ? `, first ${shown.length} shown` : ''}) ===\n${shown.join('\n')}` };
  }
  if (isTextish(name) || mt.startsWith('text/') || /json|javascript|xml/.test(mt)) {
    if (looksBinary(f.buffer)) return { text: `[${name}: binary file skipped]` };
    const text = f.buffer.toString('utf8').replace(/\r\n/g, '\n');
    const body = isCode(name) ? withLineNumbers(cap(text)) : cap(text);
    return { text: `=== FILE: ${name} (${text.split('\n').length} lines) ===\n\`\`\`${langOf(name)}\n${body}\n\`\`\``, code: isCode(name) };
  }
  if (!looksBinary(f.buffer)) return { text: `=== FILE: ${name} ===\n${cap(f.buffer.toString('utf8'))}` };
  return { text: `[${name}: unsupported file type]` };
}

/* ───────────────────────── public ───────────────────────── */
async function processFiles(files = []) {
  const totalBytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const maxTotal = Number(process.env.MAX_UPLOAD_TOTAL_MB || 60) * 1024 * 1024;
  if (totalBytes > maxTotal) throw Object.assign(new Error(`Upload too large (${kb(totalBytes)}). Max ${kb(maxTotal)} per message.`), { status: 413 });

  const textParts = [];
  const images = [];
  const meta = [];
  const summary = [];
  let isProject = false;
  let budget = MAX_CONTEXT;

  // 1) folder uploads: files whose name contains a path ("my-app/src/index.js")
  const folderFiles = files.filter((f) => (f.originalname || '').includes('/'));
  const singles = files.filter((f) => !(f.originalname || '').includes('/'));
  const folders = new Map();
  for (const f of folderFiles) {
    const p = safeName(f.originalname);
    const top = p.split('/')[0];
    if (!folders.has(top)) folders.set(top, []);
    folders.get(top).push({ path: p, size: f.size, read: () => f.buffer });
  }
  for (const [name, items] of folders) {
    const proj = buildProject(`${name}/ (folder)`, items, budget);
    budget = Math.max(20000, budget - proj.text.length);
    textParts.push(proj.text);
    proj.images.forEach((im) => images.length < MAX_IMAGES && images.push({ mimeType: `image/${ext(im.path).replace('jpg', 'jpeg')}`, data: im.read().toString('base64') }));
    meta.push({ name: `${name}/`, mimeType: 'inode/directory', size: items.reduce((n, i) => n + i.size, 0), count: proj.count });
    summary.push(proj.summary);
    isProject = true;
  }

  // 2) zips and single documents
  let codeFiles = 0;
  for (const f of singles) {
    const name = f.originalname || 'file';
    if (ext(name) === 'zip' || /zip/.test(f.mimetype || '')) {
      try {
        const proj = buildProject(name, zipItems(f.buffer), budget);
        budget = Math.max(20000, budget - proj.text.length);
        textParts.push(proj.text);
        meta.push({ name, mimeType: 'application/zip', size: f.size, count: proj.count });
        summary.push(proj.summary);
        isProject = true;
      } catch (err) {
        textParts.push(`[${name}: ${err.message}]`);
        meta.push({ name, mimeType: 'application/zip', size: f.size });
        summary.push(`${name} · could not open`);
      }
      continue;
    }
    const r = await parseSingle(f);
    if (r.image && images.length < MAX_IMAGES) images.push(r.image);
    if (r.text) textParts.push(r.text);
    if (r.code) codeFiles += 1;
    meta.push({ name, mimeType: f.mimetype, size: f.size });
    summary.push(r.note ? `${name} (${r.note})` : name);
  }
  if (codeFiles >= 2) isProject = true;

  let text = textParts.join('\n\n');
  if (text.length > MAX_CONTEXT + 50000) text = `${text.slice(0, MAX_CONTEXT)}\n… (context limit reached)`;
  return { text, images, meta, summary: summary.join(' · '), isProject };
}

module.exports = { processFiles };
