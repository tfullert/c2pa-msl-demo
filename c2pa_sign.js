const fs = require("fs");
const koffi = require("koffi");
const path = require("path");

function applyMslEnv() {
  process.env.C2PA_SIGNING_SERVICE_URL = process.env.MSL_SIGNING_URL;
  process.env.C2PA_API_KEY = process.env.MSL_API_KEY;
  if (process.env.C2PA_SKIP_SSL_VALIDATION == null) {
    process.env.C2PA_SKIP_SSL_VALIDATION = "false";
  }
  if (process.env.SKIP_C2PA_PUBLIC_TRUST_LIST_CHECK == null) {
    process.env.SKIP_C2PA_PUBLIC_TRUST_LIST_CHECK = "false";
  }
  if (!process.env.C2PA_CLAIM_GENERATOR_NAME) {
    process.env.C2PA_CLAIM_GENERATOR_NAME =
      "DigiCert Content Trust Manager";
  }
}

applyMslEnv();

const DEFAULT_ACTIONS = {
  "c2pa.edited": {
    software: "Example Editor", version: "1.0",
    time: "2026-08-21T06:00:00Z"
  },
  "c2pa.resized": {
    software: "Example Resizer", version: "2.0",
    time: "2026-08-21T06:01:00Z"
  }
};

const DEFAULT_METADATA = {
  isNewCreation: true,
  createdWithAi: true,
  editedWithAi: false,
  digitalSourceType:
    "http://cv.iptc.org/newscodes/digitalsourcetype/" +
    "trainedAlgorithmicMedia",
  includeExifMetadata: true,
  aiInference: "constrained",
  aiInferenceConstraintsInfo: "Internal evaluation only.",
  generativeAiTraining: "constrained",
  generativeAiTrainingConstraintsInfo: "Written permission required.",
  dataMiningAndAnalytics: "constrained",
  dataMiningAndAnalyticsConstraintsInfo: "Contract terms apply.",
  nonGenerativeAiTraining: "constrained",
  nonGenerativeAiTrainingConstraintsInfo: "Written permission required.",
  aiDisclosure: {
    modelType: "c2pa.types.model",
    modelName: "Acme Creative Studio v3.2",
    modelIdentifier: "https://ai.acme.com/models/creative-studio/v3.2",
    contentProfile: {
      humanOversightLevel: "human_validated"
    },
    scientificDomain: ["cs.CV", "cs.LG"],
    metadata: {
      provider: "Acme Corporation",
      deploymentEnvironment: "Production",
      modelVersion: "3.2.1"
    }
  }
};

const REQUIRED_ENV = ["MSL_SIGNING_URL", "MSL_API_KEY", "MSL_ACCOUNT_ID"];

function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function resolveLibPath() {
  if (process.env.C2PA_LIB_PATH) {
    return path.resolve(process.env.C2PA_LIB_PATH);
  }
  return path.resolve(__dirname, "rust_binary", "libc2pa_rust.so");
}

const Result = koffi.struct("C2paSignedResult", {
  signed_data: "void *", signed_data_len: "size_t",
  manifest_id: "char *", manifest_json: "char *",
  error_message: "char *", error_code: "int32_t",
  output_path: "char *"
});

const libPath = resolveLibPath();
if (!fs.existsSync(libPath)) {
  throw new Error("C2PA native library not found: " + libPath);
}

const lib = koffi.load(libPath);
const ResultPtr = koffi.pointer(Result);
const sign = lib.func("c2pa_sign_content_from_path", ResultPtr,
  ["str","str","str","str","str","str","str","str","str","str"]);
const release = lib.func("c2pa_free_result", "void", [ResultPtr]);

function jsonArg(value, fallback) {
  if (value == null) return JSON.stringify(fallback);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function signMediaFromPath(options) {
  const inputPath = options.inputPath;
  const outputPath = options.outputPath;
  const filename = options.filename;
  const roles = options.roles || "creator,contributor,publisher";
  const tsaUrl = options.tsaUrl || "http://timestamp.digicert.com";
  const accountId = options.accountId || process.env.MSL_ACCOUNT_ID;
  const userId = options.userId || process.env.MSL_USER_ID || null;
  const actions = jsonArg(options.actions, DEFAULT_ACTIONS);
  const metadata = jsonArg(options.metadata, DEFAULT_METADATA);
  const traceId = options.traceId || "550e8400-e29b-41d4-a716-446655440000";

  if (!inputPath || !outputPath || !filename) {
    throw new Error("inputPath, outputPath, and filename are required");
  }
  if (!accountId) {
    throw new Error("MSL_ACCOUNT_ID is required");
  }

  const p = sign(
    inputPath,
    outputPath,
    filename,
    roles,
    tsaUrl,
    accountId,
    userId,
    actions,
    metadata,
    traceId
  );

  if (!p) throw new Error("MSL returned NULL");

  try {
    const r = koffi.decode(p, Result);
    const errorCode = r.error_code;
    const errorMessage = r.error_message ? String(r.error_message) : null;
    const signedPath = r.output_path ? String(r.output_path) : null;
    const manifestId = r.manifest_id ? String(r.manifest_id) : null;
    const manifestJson = r.manifest_json ? String(r.manifest_json) : null;

    if (errorCode !== 0) {
      const err = new Error(String(errorCode) + ": " +
        (errorMessage || "Unknown error"));
      err.code = errorCode;
      throw err;
    }

    let manifestTitle;
    try {
      if (manifestJson) manifestTitle = JSON.parse(manifestJson).title;
    } catch (_) {}

    return {
      outputPath: signedPath,
      manifestId,
      manifestJson,
      manifestTitle
    };
  } finally {
    release(p);
  }
}

module.exports = {
  applyMslEnv,
  signMediaFromPath,
  missingEnv,
  REQUIRED_ENV,
  DEFAULT_ACTIONS,
  DEFAULT_METADATA,
  resolveLibPath
};
