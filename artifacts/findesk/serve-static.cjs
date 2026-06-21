
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const DIST = path.resolve(__dirname, "dist", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain",
  ".json": "application/json",
  ".xml":  "application/xml",
  ".webmanifest": "application/manifest+json",
};

function serveIndex(res) {
  try {
    const content = fs.readFileSync(path.join(DIST, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  } catch (e) {
    res.writeHead(500);
    res.end("Server error: " + e.message);
  }
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0].split("#")[0];
  const filePath = path.join(DIST, urlPath);

  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  let resolved = filePath;
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) resolved = path.join(resolved, "index.html");
  } catch {
    // File doesn't exist — SPA fallback
    serveIndex(res);
    return;
  }

  // Ensure file is inside DIST (path traversal guard)
  if (!resolved.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    serveIndex(res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FinDesk static server listening on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});
