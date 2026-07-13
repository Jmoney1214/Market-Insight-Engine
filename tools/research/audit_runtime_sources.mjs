#!/usr/bin/env node
import { access, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWED_CLASSIFICATIONS = new Set(["TEST_ONLY", "REPLAY_ONLY", "UI_DONOR"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".superpowers",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const DEFAULT_LIVE_ENTRYPOINTS = [
  "artifacts/api-server/src/app.ts",
  "artifacts/desk/src/main.tsx",
  "artifacts/mcp-gateway/src/index.ts",
];
const DEFAULT_REPLAY_ENTRYPOINTS = ["artifacts/api-server/src/routes/copilot/replay.ts"];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function isFile(file) {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

async function walk(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

function normalizeRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isDiscoveredAsset(relative) {
  return (
    /(^|\/)(fixtures?|mocks?|mockup(?:-sandbox)?|demo)(\/|\.|$)/i.test(relative) ||
    /(^|\/)mockProvider\.[^.]+$/i.test(relative) ||
    relative.startsWith("attached_assets/")
  );
}

async function resolveSourceFile(candidate) {
  const variants = [candidate];
  if (path.extname(candidate)) {
    const withoutExtension = candidate.slice(0, -path.extname(candidate).length);
    variants.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`, `${withoutExtension}.mjs`);
  } else {
    variants.push(`${candidate}.ts`, `${candidate}.tsx`, `${candidate}.mjs`);
  }
  variants.push(path.join(candidate, "index.ts"), path.join(candidate, "index.tsx"));
  for (const variant of variants) {
    if (await isFile(variant)) return variant;
  }
  return null;
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const staticPattern = /\b(?:import|export)\s+(?!type\b)(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']/g;
  const dynamicPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function workspaceSpecifierParts(specifier) {
  if (!specifier.startsWith("@workspace/")) return null;
  const parts = specifier.split("/");
  return {
    packageName: parts.slice(0, 2).join("/"),
    subpath: parts.slice(2).join("/"),
  };
}

function conditionalExportTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(conditionalExportTargets);
  if (!value || typeof value !== "object") return [];

  const priority = [
    "source",
    "development",
    "import",
    "default",
    "types",
    "require",
  ];
  const keys = Object.keys(value);
  const orderedKeys = [
    ...priority.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !priority.includes(key)),
  ];
  return orderedKeys.flatMap((key) => conditionalExportTargets(value[key]));
}

function workspaceExportTargets(manifest, subpath) {
  const exportsField = manifest.exports;
  const key = subpath ? `./${subpath}` : ".";

  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return subpath ? [] : conditionalExportTargets(exportsField);
  }

  if (exportsField && typeof exportsField === "object") {
    const keys = Object.keys(exportsField);
    const subpathMap = keys.some((exportKey) => exportKey.startsWith("."));
    if (!subpathMap) return subpath ? [] : conditionalExportTargets(exportsField);
    if (Object.hasOwn(exportsField, key)) return conditionalExportTargets(exportsField[key]);

    for (const exportKey of keys) {
      const star = exportKey.indexOf("*");
      if (star === -1) continue;
      const prefix = exportKey.slice(0, star);
      const suffix = exportKey.slice(star + 1);
      if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const match = key.slice(prefix.length, key.length - suffix.length || undefined);
      return conditionalExportTargets(exportsField[exportKey]).map((target) =>
        target.replaceAll("*", match),
      );
    }
    return [];
  }

  if (subpath) return [];
  return [manifest.source, manifest.module, manifest.main, "./src/index.ts"].filter(
    (target) => typeof target === "string",
  );
}

async function discoverWorkspacePackages(files) {
  const packages = new Map();
  for (const manifestPath of files.filter((file) => path.basename(file) === "package.json")) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@workspace/")) continue;
    if (packages.has(manifest.name)) {
      throw new Error(`DUPLICATE_WORKSPACE_PACKAGE: ${manifest.name}`);
    }
    packages.set(manifest.name, {
      manifest,
      packageRoot: path.dirname(manifestPath),
    });
  }
  return packages;
}

async function resolveWorkspaceImport(root, importer, specifier, workspacePackages) {
  const { packageName, subpath } = workspaceSpecifierParts(specifier);
  const workspacePackage = workspacePackages.get(packageName);
  if (workspacePackage) {
    for (const target of workspaceExportTargets(workspacePackage.manifest, subpath)) {
      const candidate = path.resolve(workspacePackage.packageRoot, target);
      const relativeToPackage = path.relative(workspacePackage.packageRoot, candidate);
      if (relativeToPackage.startsWith("..") || path.isAbsolute(relativeToPackage)) continue;
      const resolved = await resolveSourceFile(candidate);
      if (resolved) return resolved;
    }
  }

  throw new Error(
    `UNRESOLVED_WORKSPACE_IMPORT: ${specifier} from ${normalizeRelative(root, importer)}`,
  );
}

async function resolveImport(root, importer, specifier, workspacePackages) {
  if (specifier.startsWith(".")) {
    return resolveSourceFile(path.resolve(path.dirname(importer), specifier));
  }
  if (specifier.startsWith("@/")) {
    return resolveSourceFile(path.join(root, "artifacts/desk/src", specifier.slice(2)));
  }
  if (workspaceSpecifierParts(specifier)) {
    return resolveWorkspaceImport(root, importer, specifier, workspacePackages);
  }
  return null;
}

async function reachableFiles(root, entrypoints, workspacePackages) {
  const queue = [];
  for (const relative of entrypoints) {
    const entry = await resolveSourceFile(path.join(root, relative));
    if (!entry) throw new Error(`MISSING_RUNTIME_ENTRYPOINT: ${relative}`);
    queue.push(entry);
  }
  const visited = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const resolved = await resolveImport(root, file, specifier, workspacePackages);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return visited;
}

function matchingClassification(relative, classifications) {
  return classifications.find((entry) => relative === entry.path || relative.startsWith(`${entry.path}/`));
}

export async function auditRuntimeSources({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  classificationsPath = path.join(root, "tools/research/runtime_source_classifications.json"),
  liveEntrypoints = DEFAULT_LIVE_ENTRYPOINTS,
  replayEntrypoints = DEFAULT_REPLAY_ENTRYPOINTS,
} = {}) {
  const document = JSON.parse(await readFile(classificationsPath, "utf8"));
  if (document.version !== 1 || !Array.isArray(document.assets)) {
    throw new Error("INVALID_RUNTIME_SOURCE_CLASSIFICATIONS: expected version 1 assets array");
  }
  const seen = new Set();
  for (const entry of document.assets) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !ALLOWED_CLASSIFICATIONS.has(entry.classification) ||
      typeof entry.rationale !== "string" ||
      !entry.rationale.trim() ||
      typeof entry.owner !== "string" ||
      !entry.owner.trim()
    ) {
      throw new Error("INVALID_RUNTIME_SOURCE_CLASSIFICATION_ENTRY");
    }
    if (seen.has(entry.path)) throw new Error(`DUPLICATE_RUNTIME_SOURCE_CLASSIFICATION: ${entry.path}`);
    seen.add(entry.path);
    if (!(await exists(path.join(root, entry.path)))) {
      throw new Error(`STALE_RUNTIME_SOURCE_CLASSIFICATION: ${entry.path}`);
    }
  }

  const files = await walk(root);
  const workspacePackages = await discoverWorkspacePackages(files);
  const discovered = files.map((file) => normalizeRelative(root, file)).filter(isDiscoveredAsset);
  for (const relative of discovered) {
    if (!matchingClassification(relative, document.assets)) {
      throw new Error(`UNCLASSIFIED_RUNTIME_SOURCE: ${relative}`);
    }
  }

  const liveReachable = await reachableFiles(root, liveEntrypoints, workspacePackages);
  for (const file of liveReachable) {
    const relative = normalizeRelative(root, file);
    if (matchingClassification(relative, document.assets)) {
      throw new Error(`LIVE_RUNTIME_SOURCE_REACHABLE: ${relative}`);
    }
  }

  const replayReachable = await reachableFiles(root, replayEntrypoints, workspacePackages);
  const replayAssets = [...replayReachable]
    .map((file) => normalizeRelative(root, file))
    .filter((relative) => matchingClassification(relative, document.assets)?.classification === "REPLAY_ONLY");
  if (replayAssets.length > 0) {
    const boundaryText = (
      await Promise.all(replayEntrypoints.map((entry) => readFile(path.join(root, entry), "utf8")))
    ).join("\n");
    if (!boundaryText.includes("caseRevisionId") || !boundaryText.includes("evidenceHash")) {
      throw new Error(`REPLAY_CANONICAL_BOUNDARY_REQUIRED: ${replayAssets.join(", ")}`);
    }
  }

  return {
    classifiedAssets: document.assets.length,
    discoveredAssets: discovered.length,
    inspectedSourceFiles: files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file))).length,
    liveReachableFiles: liveReachable.size,
    replayReachableFiles: replayReachable.size,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const summary = await auditRuntimeSources();
    process.stdout.write(`${JSON.stringify({ status: "ok", ...summary }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
