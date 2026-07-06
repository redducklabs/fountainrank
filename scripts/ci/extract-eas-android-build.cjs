#!/usr/bin/env node

const fs = require("node:fs");

const jsonPath = process.argv[2];

if (!jsonPath) {
  throw new Error("Usage: extract-eas-android-build.cjs <eas-build-json-path>");
}

const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const build = Array.isArray(parsed)
  ? parsed.find((candidate) => candidate?.platform === "ANDROID")
  : parsed;

if (!build || build.platform !== "ANDROID") {
  throw new Error("EAS build JSON did not contain an Android build.");
}

if (build.status !== "FINISHED") {
  throw new Error(
    `Android EAS build did not finish successfully. Status: ${build.status ?? "unknown"}.`,
  );
}

if (!build.id || typeof build.id !== "string") {
  throw new Error("Android EAS build JSON did not contain a build id.");
}

const versionCode = Number(build.appBuildVersion);

if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  throw new Error(
    `Android EAS build JSON did not contain a positive integer appBuildVersion. Got: ${build.appBuildVersion}`,
  );
}

console.log(`build_id=${build.id}`);
console.log(`version_code=${versionCode}`);
