/**
 * Turns uploaded files into model input:
 *  - images → base64 parts (Gemini vision)
 *  - PDFs   → extracted text; if the PDF is scanned (no text), the raw PDF goes to Gemini for OCR
 *  - text/code files → inlined as text
 */
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids pdf-parse debug-mode bug

const MAX_TEXT_CHARS = 60000;
const TEXT_TYPES = /^(text\/|application\/(json|javascript|xml|x-sh|x-python|sql))/;
const TEXT_EXT = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|c|cpp|cs|go|rb|php|html|css|sql|xml|yml|yaml|sh)$/i;

async function processFiles(files = []) {
  const textBlocks = [];
  const images = [];
  const meta = [];

  for (const f of files) {
    meta.push({ name: f.originalname, mimeType: f.mimetype, size: f.size });

    if (f.mimetype.startsWith('image/')) {
      images.push({ mimeType: f.mimetype, data: f.buffer.toString('base64') });
    } else if (f.mimetype === 'application/pdf') {
      let text = '';
      try { text = (await pdfParse(f.buffer)).text || ''; } catch { text = ''; }
      if (text.trim().length > 50) {
        textBlocks.push(`--- FILE: ${f.originalname} (PDF) ---\n${text.slice(0, MAX_TEXT_CHARS)}`);
      } else {
        // scanned PDF → let Gemini OCR it
        images.push({ mimeType: 'application/pdf', data: f.buffer.toString('base64') });
      }
    } else if (TEXT_TYPES.test(f.mimetype) || TEXT_EXT.test(f.originalname)) {
      textBlocks.push(`--- FILE: ${f.originalname} ---\n${f.buffer.toString('utf8').slice(0, MAX_TEXT_CHARS)}`);
    }
  }

  return { text: textBlocks.join('\n\n'), images, meta };
}

module.exports = { processFiles };
