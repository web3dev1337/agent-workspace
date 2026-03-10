#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const path = require("path");

const host = process.env.SITE_HOST || "127.0.0.1";
const port = Number.parseInt(process.env.SITE_PORT || "4173", 10);
const siteRoot = path.join(__dirname, "..", "site");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function getMimeType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(String(requestUrl || "/").split("?")[0]);
  const safePath = pathname.replace(/^\/+/, "");
  const candidatePath = path.normalize(path.join(siteRoot, safePath || "index.html"));

  if (!candidatePath.startsWith(siteRoot)) {
    return null;
  }

  return candidatePath;
}

function sendFile(filePath, requestMethod, response) {
  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const actualPath = stats.isDirectory() ? path.join(filePath, "index.html") : filePath;

    fs.readFile(actualPath, (readError, contents) => {
      if (readError) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Length": contents.length,
        "Content-Type": getMimeType(actualPath),
        "Cache-Control": "no-store"
      });

      if (requestMethod === "HEAD") {
        response.end();
        return;
      }

      response.end(contents);
    });
  });
}

const server = http.createServer((request, response) => {
  if (!request.url) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      "Allow": "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("Method not allowed");
    return;
  }

  const requestPath = resolveRequestPath(request.url);
  if (!requestPath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  sendFile(requestPath, request.method, response);
});

server.listen(port, host, () => {
  process.stdout.write(`Previewing site at http://${host}:${port}\n`);
});
