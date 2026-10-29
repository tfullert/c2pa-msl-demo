const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const busboy = require("busboy");
const {
  signMediaFromPath,
  missingEnv,
  REQUIRED_ENV
} = require("./c2pa_sign");

const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 32 * 1024 * 1024);

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".pdf": "application/pdf"
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function safeFilename(name) {
  const base = path.basename(String(name || "upload.bin"))
    .replace(/[^\w.\-]+/g, "_");
  return base || "upload.bin";
}

function contentTypeFor(filename) {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ||
    "application/octet-stream";
}

function parseJsonField(raw, fieldName) {
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const error = new Error("Invalid JSON in field \"" + fieldName + "\"");
    error.status = 400;
    throw error;
  }
}

async function withTempDir(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "c2pa-"));
  try {
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function limitStream(maxBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) {
        const err = new Error(
          "Upload exceeds the " + maxBytes +
          " byte limit (Cloud Run default HTTP body is 32MB)"
        );
        err.status = 413;
        cb(err);
        return;
      }
      cb(null, chunk);
    }
  });
}

function parseMultipart(req, destDir) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let bb;
    try {
      bb = busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: MAX_UPLOAD_BYTES,
          fields: 20,
          fieldSize: 1024 * 1024
        }
      });
    } catch (err) {
      err.status = 400;
      fail(err);
      return;
    }

    const fields = {};
    let fileInfo = null;
    let truncated = false;
    const writes = [];

    bb.on("file", (name, file, info) => {
      if (name !== "media" && name !== "file") {
        file.resume();
        return;
      }
      const filename = safeFilename(info.filename);
      const dest = path.join(destDir, "input-" + filename);
      fileInfo = {
        filename,
        mimeType: info.mimeType,
        path: dest
      };
      const ws = fs.createWriteStream(dest);
      file.on("limit", () => { truncated = true; });
      writes.push(pipeline(file, ws));
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("partsLimit", () => {
      const err = new Error("Too many multipart parts");
      err.status = 400;
      fail(err);
    });

    bb.on("filesLimit", () => {
      const err = new Error("Only one media file is allowed");
      err.status = 400;
      fail(err);
    });

    bb.on("error", (err) => {
      err.status = err.status || 400;
      fail(err);
    });

    bb.on("close", async () => {
      try {
        await Promise.all(writes);
        if (truncated) {
          const err = new Error(
            "Upload exceeds the " + MAX_UPLOAD_BYTES +
            " byte limit (Cloud Run default HTTP body is 32MB)"
          );
          err.status = 413;
          fail(err);
          return;
        }
        if (!fileInfo) {
          const err = new Error(
            "Missing media file (multipart field \"media\")"
          );
          err.status = 400;
          fail(err);
          return;
        }
        done({ fields, file: fileInfo });
      } catch (err) {
        fail(err);
      }
    });

    req.pipe(bb);
  });
}

async function saveRawBody(req, destPath) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_UPLOAD_BYTES) {
    const err = new Error(
      "Upload exceeds the " + MAX_UPLOAD_BYTES +
      " byte limit (Cloud Run default HTTP body is 32MB)"
    );
    err.status = 413;
    throw err;
  }
  await pipeline(req, limitStream(MAX_UPLOAD_BYTES), fs.createWriteStream(destPath));
}

let signing = Promise.resolve();
function enqueueSign(fn) {
  const run = signing.then(fn, fn);
  signing = run.then(() => {}, () => {});
  return run;
}

async function handleSign(req, res, url) {
  const missing = missingEnv(REQUIRED_ENV);
  if (missing.length) {
    json(res, 503, {
      error: "Signing is not configured",
      missing
    });
    return;
  }

  await withTempDir(async (dir) => {
    const type = String(req.headers["content-type"] || "");
    let filename;
    let inputPath;
    let fields = {};

    if (type.startsWith("multipart/form-data")) {
      const parsed = await parseMultipart(req, dir);
      fields = parsed.fields;
      filename = safeFilename(fields.filename || parsed.file.filename);
      inputPath = parsed.file.path;
    } else if (
      type.startsWith("application/octet-stream") ||
      type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.startsWith("audio/") ||
      type.startsWith("application/pdf")
    ) {
      filename = safeFilename(
        req.headers["x-filename"] ||
        url.searchParams.get("filename") ||
        "upload.bin"
      );
      inputPath = path.join(dir, "input-" + filename);
      await saveRawBody(req, inputPath);
    } else {
      const err = new Error(
        "Send multipart/form-data with field \"media\", or a raw media body"
      );
      err.status = 415;
      throw err;
    }

    const stat = await fs.promises.stat(inputPath);
    if (!stat.size) {
      const err = new Error("Uploaded media is empty");
      err.status = 400;
      throw err;
    }

    const outputPath = path.join(dir, "signed-" + filename);
    const result = await enqueueSign(() => signMediaFromPath({
      inputPath,
      outputPath,
      filename,
      roles: fields.roles,
      tsaUrl: fields.tsaUrl || fields.tsa_url,
      actions: parseJsonField(fields.actions, "actions"),
      metadata: parseJsonField(fields.metadata, "metadata"),
      traceId: fields.traceId || fields.trace_id || crypto.randomUUID()
    }));

    const signed = await fs.promises.readFile(result.outputPath || outputPath);
    const headers = {
      "content-type": contentTypeFor(filename),
      "content-length": signed.length,
      "content-disposition":
        "attachment; filename=\"signed-" + filename + "\"",
      "cache-control": "no-store"
    };
    if (result.manifestId) headers["x-c2pa-manifest-id"] = result.manifestId;
    if (result.manifestTitle) {
      headers["x-c2pa-manifest-title"] = encodeURIComponent(result.manifestTitle);
    }
    res.writeHead(200, headers);
    res.end(signed);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  try {
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      const missing = missingEnv(REQUIRED_ENV);
      json(res, 200, {
        ok: true,
        signingConfigured: missing.length === 0
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/sign") {
      await handleSign(req, res, url);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    const status = err.status || 500;
    console.error(err);
    if (!res.headersSent) {
      json(res, status, { error: err.message || "Internal error" });
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const missing = missingEnv(REQUIRED_ENV);
  console.log("c2pa-msl listening on 0.0.0.0:" + PORT);
  if (missing.length) {
    console.warn("Missing " + missing.join(", ") + "; POST /sign will return 503");
  }
});
