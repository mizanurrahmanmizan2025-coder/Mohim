/**
 * Rejects oversized uploads BEFORE they are buffered into memory.
 * multer only limits size per file; a folder upload of many files could otherwise
 * fill the server's RAM. MAX_UPLOAD_TOTAL_MB (default 60) caps the whole request.
 */
const MAX = Number(process.env.MAX_UPLOAD_TOTAL_MB || 60) * 1024 * 1024;

function uploadGuard(req, res, next) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX) {
    return res.status(413).json({ message: `Upload too large — max ${MAX / 1024 / 1024} MB per message. Zip the project or remove large files.` });
  }
  // also count streamed bytes (covers missing / wrong Content-Length)
  let seen = 0;
  req.on('data', (chunk) => {
    seen += chunk.length;
    if (seen > MAX && !res.headersSent) {
      res.status(413).json({ message: `Upload too large — max ${MAX / 1024 / 1024} MB per message.` });
      req.unpipe?.();
      req.destroy();
    }
  });
  next();
}

module.exports = { uploadGuard };
