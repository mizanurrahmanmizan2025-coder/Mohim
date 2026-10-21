/**
 * utils/officeParser.js — text extraction for .docx, .xlsx, .pptx (Office Open XML).
 * These formats are ZIP archives of XML, so we reuse zipReader — no extra packages.
 */
const { readZip } = require('./zipReader');

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

function open(buffer) {
  const zip = readZip(buffer, { maxEntryBytes: 30 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 });
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const xml = (name) => {
    const e = byName.get(name);
    const b = e && zip.read(e);
    return b ? b.toString('utf8') : '';
  };
  return { zip, xml, names: [...byName.keys()] };
}

/* ───── Word ───── */
function docxText(buffer) {
  const { xml, names } = open(buffer);
  const toText = (x) => decode(
    x.replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tr[^>]*>/g, '')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<[^>]+>/g, '')
  ).replace(/\n{3,}/g, '\n\n').trim();

  const parts = [toText(xml('word/document.xml'))];
  const notes = names.filter((n) => /^word\/(footnotes|endnotes)\.xml$/.test(n)).map((n) => toText(xml(n))).filter(Boolean);
  if (notes.length) parts.push(`--- Notes ---\n${notes.join('\n')}`);
  return parts.join('\n\n');
}

/* ───── PowerPoint ───── */
function pptxText(buffer) {
  const { xml, names } = open(buffer);
  const slides = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return slides.map((n, i) => {
    const x = xml(n).replace(/<\/a:p>/g, '\n');
    const text = decode([...x.matchAll(/<a:t>([\s\S]*?)<\/a:t>|\n/g)].map((m) => (m[1] !== undefined ? m[1] : '\n')).join('')).replace(/\n{2,}/g, '\n').trim();
    const noteFile = `ppt/notesSlides/notesSlide${n.match(/\d+/)[0]}.xml`;
    const notes = decode([...xml(noteFile).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join(' ')).trim();
    return `--- Slide ${i + 1} ---\n${text}${notes ? `\n[Speaker notes] ${notes}` : ''}`;
  }).join('\n\n');
}

/* ───── Excel ───── */
function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function xlsxText(buffer, { maxRowsPerSheet = 500 } = {}) {
  const { xml, names } = open(buffer);
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));

  const wb = xml('xl/workbook.xml');
  const sheetNames = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));
  const sheetFiles = names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  return sheetFiles.map((file, i) => {
    const rows = [];
    let total = 0;
    for (const r of xml(file).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      total += 1;
      if (rows.length >= maxRowsPerSheet) continue;
      const cells = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] || '';
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
        const type = (attrs.match(/t="(\w+)"/) || [])[1];
        let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
        if (type === 's') v = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') v = decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else v = decode(v);
        cells[ref ? colIndex(ref) : cells.length] = v;
      }
      rows.push(Array.from(cells, (v) => csvCell(v ?? '')).join(','));
    }
    const more = total > rows.length ? `\n… ${total - rows.length} more rows not shown` : '';
    return `--- Sheet: ${sheetNames[i] || `Sheet${i + 1}`} (${total} rows) ---\n${rows.join('\n')}${more}`;
  }).join('\n\n');
}

module.exports = { docxText, pptxText, xlsxText };
