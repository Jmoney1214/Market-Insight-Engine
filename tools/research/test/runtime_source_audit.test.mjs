import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditRuntimeSources } from "../audit_runtime_sources.mjs";

async function fixtureRepo({ entry = 'export const live = true;', asset = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-source-audit-"));
  await mkdir(path.join(root, "src", "fixtures"), { recursive: true });
  await writeFile(path.join(root, "src", "live.ts"), entry);
  if (asset) await writeFile(path.join(root, "src", "fixtures", "data.ts"), "export const value = 1;\n");
  return root;
}

async function writeClassifications(root, assets) {
  const file = path.join(root, "classifications.json");
  await writeFile(file, JSON.stringify({ version: 1, assets }));
  return file;
}

async function writeWorkspacePackage(
  root,
  { name = "@workspace/example", exports = { ".": "./src/index.ts" } } = {},
) {
  const packageRoot = path.join(root, "lib", name.split("/").at(-1));
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name, private: true, type: "module", exports }),
  );
  return packageRoot;
}

const classification = (assetPath, classificationName = "TEST_ONLY") => ({
  path: assetPath,
  classification: classificationName,
  rationale: "Synthetic data for a bounded test.",
  owner: "test-owner",
});

test("accepts a classified asset that is unreachable from LIVE", async () => {
  const root = await fixtureRepo();
  const classificationsPath = await writeClassifications(root, [classification("src/fixtures/data.ts")]);
  const result = await auditRuntimeSources({
    root,
    classificationsPath,
    liveEntrypoints: ["src/live.ts"],
    replayEntrypoints: [],
  });
  assert.equal(result.classifiedAssets, 1);
});

test("rejects an unclassified fixture, mock, or demo asset", async () => {
  const root = await fixtureRepo();
  const classificationsPath = await writeClassifications(root, []);
  await assert.rejects(
    auditRuntimeSources({ root, classificationsPath, liveEntrypoints: ["src/live.ts"], replayEntrypoints: [] }),
    /UNCLASSIFIED_RUNTIME_SOURCE.*src\/fixtures\/data\.ts/,
  );
});

test("rejects stale classification entries", async () => {
  const root = await fixtureRepo({ asset: false });
  const classificationsPath = await writeClassifications(root, [classification("src/fixtures/missing.ts")]);
  await assert.rejects(
    auditRuntimeSources({ root, classificationsPath, liveEntrypoints: ["src/live.ts"], replayEntrypoints: [] }),
    /STALE_RUNTIME_SOURCE_CLASSIFICATION/,
  );
});

test("rejects a classified asset reachable from LIVE", async () => {
  const root = await fixtureRepo({ entry: 'import "./fixtures/data.js";\n' });
  const classificationsPath = await writeClassifications(root, [classification("src/fixtures/data.ts", "REPLAY_ONLY")]);
  await assert.rejects(
    auditRuntimeSources({ root, classificationsPath, liveEntrypoints: ["src/live.ts"], replayEntrypoints: [] }),
    /LIVE_RUNTIME_SOURCE_REACHABLE.*src\/fixtures\/data\.ts/,
  );
});

test("rejects replay fixture reachability without canonical evidence boundary", async () => {
  const root = await fixtureRepo({ entry: 'import "./fixtures/data.js";\n' });
  const classificationsPath = await writeClassifications(root, [classification("src/fixtures/data.ts", "REPLAY_ONLY")]);
  await assert.rejects(
    auditRuntimeSources({
      root,
      classificationsPath,
      liveEntrypoints: [],
      replayEntrypoints: ["src/live.ts"],
    }),
    /REPLAY_CANONICAL_BOUNDARY_REQUIRED/,
  );
});

test("rejects an unknown internal workspace package import", async () => {
  const root = await fixtureRepo({
    entry: 'import "@workspace/does-not-exist";\nexport const live = true;\n',
    asset: false,
  });
  const classificationsPath = await writeClassifications(root, []);

  await assert.rejects(
    auditRuntimeSources({
      root,
      classificationsPath,
      liveEntrypoints: ["src/live.ts"],
      replayEntrypoints: [],
    }),
    /UNRESOLVED_WORKSPACE_IMPORT: @workspace\/does-not-exist/,
  );
});

test("rejects an unexported workspace package subpath", async () => {
  const root = await fixtureRepo({
    entry: 'import "@workspace/example/unlisted";\nexport const live = true;\n',
    asset: false,
  });
  const packageRoot = await writeWorkspacePackage(root);
  await writeFile(
    path.join(packageRoot, "src", "index.ts"),
    "export const value = 1;\n",
  );
  const classificationsPath = await writeClassifications(root, []);

  await assert.rejects(
    auditRuntimeSources({
      root,
      classificationsPath,
      liveEntrypoints: ["src/live.ts"],
      replayEntrypoints: [],
    }),
    /UNRESOLVED_WORKSPACE_IMPORT: @workspace\/example\/unlisted/,
  );
});

test("resolves an exported workspace subpath into the LIVE graph", async () => {
  const root = await fixtureRepo({
    entry: 'import "@workspace/example/runtime";\nexport const live = true;\n',
    asset: false,
  });
  const packageRoot = await writeWorkspacePackage(root, {
    exports: { ".": "./src/index.ts", "./runtime": "./src/runtime.ts" },
  });
  await mkdir(path.join(packageRoot, "src", "fixtures"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "src", "index.ts"),
    "export const value = 1;\n",
  );
  await writeFile(
    path.join(packageRoot, "src", "runtime.ts"),
    'import "./fixtures/data.js";\n',
  );
  await writeFile(
    path.join(packageRoot, "src", "fixtures", "data.ts"),
    "export const value = 1;\n",
  );
  const classificationsPath = await writeClassifications(root, [
    classification("lib/example/src/fixtures/data.ts", "REPLAY_ONLY"),
  ]);

  await assert.rejects(
    auditRuntimeSources({
      root,
      classificationsPath,
      liveEntrypoints: ["src/live.ts"],
      replayEntrypoints: [],
    }),
    /LIVE_RUNTIME_SOURCE_REACHABLE.*lib\/example\/src\/fixtures\/data\.ts/,
  );
});

test("audits the repository source graph without importing application modules", async () => {
  const root = path.resolve(new URL("../../..", import.meta.url).pathname);
  const result = await auditRuntimeSources({ root });
  assert.ok(result.classifiedAssets >= 6);
  assert.ok(result.inspectedSourceFiles > 0);
});
