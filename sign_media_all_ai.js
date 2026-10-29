const { signMediaFromPath } = require("./c2pa_sign");

const result = signMediaFromPath({
  inputPath: "input/sample.jpeg",
  outputPath: "output/node_all_fields_signed.jpeg",
  filename: "sample.jpeg",
  roles: "creator,contributor,publisher",
  tsaUrl: "http://timestamp.digicert.com",
  traceId: "550e8400-e29b-41d4-a716-446655440000"
});

console.log("Signed file:", result.outputPath);
console.log("Manifest ID:", result.manifestId);
console.log("Manifest title:", result.manifestTitle);
