import { Code2, FileText, Globe, ImagePlus, MessageSquare, PenLine } from 'lucide-react';

/* ───── Modes shown in the sidebar ───── */
export const MODES = [
  { key: 'general', label: 'Chat', icon: MessageSquare, hint: 'Ask anything', color: 'text-blue-500' },
  { key: 'code', label: 'Code Expert', icon: Code2, hint: 'Write, debug and refactor code', color: 'text-emerald-500' },
  { key: 'image', label: 'Image Generator', icon: ImagePlus, hint: 'Describe an image or thumbnail', color: 'text-pink-500' },
  { key: 'document', label: 'Document Analyzer', icon: FileText, hint: 'Upload a PDF or image and ask about it', color: 'text-amber-500' },
  { key: 'url', label: 'Web Analyzer', icon: Globe, hint: 'Paste a link to summarise or analyse', color: 'text-cyan-500' },
  { key: 'writer', label: 'Content Writer', icon: PenLine, hint: 'Blogs, articles and social posts', color: 'text-violet-500' },
];
export const getModeMeta = (key) => MODES.find((m) => m.key === key) || MODES[0];

export const STARTERS = {
  general: ['Explain quantum computing simply', 'Plan a 3-day trip to Cox’s Bazar', 'Write a polite follow-up email'],
  code: ['Build a React login form with validation', 'Fix this bug: TypeError cannot read properties of undefined', 'Write a Python script to rename files in bulk'],
  image: ['YouTube thumbnail: “10 AI tools you need”, neon style', 'Logo concept for a coffee shop, minimal', 'Futuristic Dhaka skyline at night, cinematic'],
  document: ['Summarise the attached PDF', 'Extract all tables as Markdown', 'Read the text in this image'],
  url: ['Summarise https://en.wikipedia.org/wiki/Large_language_model', 'Compare the key points of two articles (paste both links)'],
  writer: ['SEO blog post about remote work', '5 LinkedIn posts for a product launch', 'Instagram captions for a bakery'],
};

/* ───── Code language → file extension ───── */
const EXT = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py',
  html: 'html', css: 'css', scss: 'scss', json: 'json', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp',
  csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', php: 'php', ruby: 'rb', rb: 'rb', swift: 'swift',
  kotlin: 'kt', sql: 'sql', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', yaml: 'yml', yml: 'yml',
  xml: 'xml', markdown: 'md', md: 'md', dart: 'dart', vue: 'vue', dockerfile: 'Dockerfile', text: 'txt',
};
export const extFor = (lang = '') => EXT[lang.toLowerCase()] || 'txt';

/** Tries to read a filename from the first line comment, e.g. "// server.js" */
export function guessFilename(code, lang) {
  const first = (code.split('\n')[0] || '').trim();
  const m = first.match(/^(?:\/\/|#|<!--|\/\*|--)\s*([\w./-]+\.[a-z0-9]+)/i);
  if (m) return m[1].split('/').pop();
  const ext = extFor(lang);
  return ext === 'Dockerfile' ? ext : `code.${ext}`;
}

export function downloadFile(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/* ───── Chat export ───── */
export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title || 'Chat'}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
  for (const m of chat.messages || []) {
    lines.push(m.role === 'user' ? '## 🧑 You' : '## ✨ Assistant', '');
    if (m.content) lines.push(m.content, '');
    for (const img of m.images || []) lines.push(`![image](${img})`, '');
  }
  return lines.join('\n');
}

export function exportChat(chat, format = 'md') {
  const safe = (chat.title || 'chat').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'chat';
  if (format === 'json') {
    downloadFile(JSON.stringify({ title: chat.title, messages: chat.messages }, null, 2), `${safe}.json`, 'application/json');
  } else if (format === 'txt') {
    const txt = (chat.messages || []).map((m) => `${m.role === 'user' ? 'You' : 'AI'}:\n${m.content}\n`).join('\n');
    downloadFile(txt, `${safe}.txt`);
  } else {
    downloadFile(chatToMarkdown(chat), `${safe}.md`, 'text/markdown');
  }
}

/* ───── Split an AI answer into markdown + before/after diff segments ───── */
const DIFF_RE = /```before-([\w+#.-]+)[^\n]*\n([\s\S]*?)```\s*(?:\n[^\n`]*\n)?\s*```after-([\w+#.-]+)[^\n]*\n([\s\S]*?)```/g;

export function segmentContent(content = '') {
  const out = [];
  let last = 0;
  let m;
  DIFF_RE.lastIndex = 0;
  while ((m = DIFF_RE.exec(content))) {
    if (m.index > last) out.push({ type: 'md', text: content.slice(last, m.index) });
    out.push({ type: 'diff', lang: m[3] || m[1], before: m[2].replace(/\n$/, ''), after: m[4].replace(/\n$/, '') });
    last = DIFF_RE.lastIndex;
  }
  if (last < content.length) out.push({ type: 'md', text: content.slice(last) });
  return out;
}

/** Strip markdown for speech synthesis. */
export function plainText(md = '') {
  return md
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function timeAgoGroup(date) {
  const d = new Date(date);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Older';
}

export const formatDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

/* ───── Theme ───── */
export function setTheme(t) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
}
export const currentTheme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');
