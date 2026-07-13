import { describe, expect, it } from "vitest";

import {
  AgentOutputSchema,
  canonicalJson,
  CandidatePacketDraftSchema,
  CasePartitionSchema,
  CaseStateSchema,
  ConfiguredVersionSnapshotSchema,
  EvidenceGraphSchema,
  EvidenceLinkSchema,
  EvidenceNodeSchema,
  FmpPreflightResultSchema,
  GovernanceDecisionSchema,
  GraderResultSchema,
  hmacCanonical,
  InstrumentClassSchema,
  PrincipalSchema,
  ResearchRunSchema,
  RunStateSchema,
  sha256Canonical,
  SipPreflightResultSchema,
  TraceEventSchema,
  TraceKindSchema,
} from "./index.js";

describe("canonical hashing", () => {
  it("hashes equivalent objects identically", () => {
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(
      sha256Canonical({ a: 1, b: 2 }),
    );
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("orders non-ASCII object keys by UTF-16 code units independent of locale", () => {
    const value = {
      "€": 6,
      "\r": 0,
      "1": 1,
      "😀": 7,
      A: 2,
      é: 5,
      a: 4,
      _: 3,
    };

    // Parsing and then calling Object.keys would move the integer-index key
    // "1" to the front under JavaScript enumeration rules. Inspect the
    // canonical serialization itself so this assertion measures JCS order.
    expect(canonicalJson(value)).toBe(
      '{"\\r":0,"1":1,"A":2,"_":3,"a":4,"é":5,"€":6,"😀":7}',
    );
  });

  it("orders nested object keys while preserving array order", () => {
    expect(
      canonicalJson({ outer: { z: 1, a: 2 }, list: [{ y: 3, x: 4 }, 0] }),
    ).toBe('{"list":[{"x":4,"y":3},0],"outer":{"a":2,"z":1}}');
  });

  it("uses JCS number serialization for finite numbers", () => {
    expect(canonicalJson([-0, 1e30, 0.000001, 1.2345])).toBe(
      "[0,1e+30,0.000001,1.2345]",
    );
  });

  it.each([
    ["undefined", undefined],
    ["function", () => true],
    ["symbol", Symbol("not-json")],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("rejects a root %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it("rejects unsupported values nested in objects and arrays", () => {
    expect(() => canonicalJson({ omittedByJson: undefined })).toThrow(
      TypeError,
    );
    expect(() => canonicalJson([1, undefined])).toThrow(TypeError);
    expect(() => canonicalJson({ nested: Number.NaN })).toThrow(TypeError);
  });

  it("rejects sparse arrays instead of silently treating holes as null", () => {
    const sparse = Array<number>(3);
    sparse[2] = 3;

    expect(() => canonicalJson(sparse)).toThrow(TypeError);
  });

  it.each([
    ["Date", new Date("2026-07-12T00:00:00.000Z")],
    ["Map", new Map([["a", 1]])],
    ["Set", new Set([1])],
    [
      "class instance",
      new (class Example {
        value = 1;
      })(),
    ],
  ])("rejects unsupported %s instances", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it("rejects cycles deterministically", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });

  it("rejects lone UTF-16 surrogates in keys and string values", () => {
    expect(() => canonicalJson("\ud800")).toThrow(TypeError);
    expect(() => canonicalJson({ "\udc00": "value" })).toThrow(TypeError);
  });

  it("does not accept symbol-keyed or accessor-backed object data", () => {
    const symbolKeyed = { visible: true, [Symbol("hidden")]: false };
    const accessorBacked = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });

    expect(() => canonicalJson(symbolKeyed)).toThrow(TypeError);
    expect(() => canonicalJson(accessorBacked)).toThrow(TypeError);
  });

  it("produces stable lowercase SHA-256 and HMAC-SHA-256 digests", () => {
    const first = { b: 2, a: 1 };
    const second = { a: 1, b: 2 };

    expect(sha256Canonical(first)).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(hmacCanonical(first, "decision-key")).toBe(
      hmacCanonical(second, "decision-key"),
    );
    expect(hmacCanonical(first, "decision-key")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("core contracts", () => {
  it("rejects unknown principal fields and illegal run states", () => {
    expect(() =>
      PrincipalSchema.parse({
        kind: "human",
        principalId: "p1",
        subject: "desk",
        scopes: [],
        extra: true,
      }),
    ).toThrow();
    expect(RunStateSchema.safeParse("PUBLISHED").success).toBe(false);
  });

  it("accepts all principal variants and keeps agent bindings mandatory", () => {
    expect(
      PrincipalSchema.parse({
        kind: "agent",
        principalId: "agent-1",
        subject: "catalyst-verifier",
        servicePrincipalId: "research-service",
        manifestId: "catalyst-verifier",
        manifestVersion: "1.0.0",
        scopes: ["tool:primary-source"],
      }).kind,
    ).toBe("agent");
    expect(
      PrincipalSchema.safeParse({
        kind: "agent",
        principalId: "agent-1",
        subject: "catalyst-verifier",
        scopes: [],
      }).success,
    ).toBe(false);
  });
});

const timestamp = "2026-07-12T15:30:00.000Z";
const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const runId = "11111111-1111-4111-8111-111111111111";

describe("run and provider-preflight contracts", () => {
  const sipRealtime = {
    provider: "ALPACA_SIP",
    status: "SIP_REALTIME",
    checkedAt: timestamp,
    endpoint:
      "https://data.alpaca.markets/v2/stocks/SPY/quotes/latest?feed=sip",
    probeSymbol: "SPY",
    httpStatus: 200,
    durationMs: 45,
    attempt: 1,
    responseBodySha256: hash,
    marketTimestamp: timestamp,
    marketSession: {
      session: "REGULAR",
      calendarDate: "2026-07-12",
      evaluatedAt: timestamp,
    },
  };

  it("uses discriminated SIP and task-specific FMP preflight results", () => {
    expect(SipPreflightResultSchema.parse(sipRealtime).status).toBe(
      "SIP_REALTIME",
    );
    expect(
      FmpPreflightResultSchema.parse({
        provider: "FMP",
        status: "NOT_REQUIRED",
        checkedAt: timestamp,
        endpointFamily: null,
        endpoint: null,
        probeSymbol: null,
        httpStatus: null,
        durationMs: 0,
        attempt: 0,
        responseBodySha256: null,
      }).status,
    ).toBe("NOT_REQUIRED");
    expect(
      FmpPreflightResultSchema.safeParse({
        provider: "FMP",
        status: "NOT_REQUIRED",
        checkedAt: timestamp,
        endpointFamily: "profile",
        endpoint:
          "https://financialmodelingprep.com/stable/profile-symbol?symbol=SPY",
        probeSymbol: "SPY",
        httpStatus: 200,
        durationMs: 1,
        attempt: 1,
        responseBodySha256: hash,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown preflight fields", () => {
    expect(
      SipPreflightResultSchema.safeParse({
        ...sipRealtime,
        feedFallback: "iex",
      }).success,
    ).toBe(false);
  });

  it("does not represent a successful provider probe without a successful response", () => {
    expect(
      SipPreflightResultSchema.safeParse({
        ...sipRealtime,
        httpStatus: null,
        responseBodySha256: null,
        marketTimestamp: null,
      }).success,
    ).toBe(false);
    expect(
      FmpPreflightResultSchema.safeParse({
        provider: "FMP",
        status: "AVAILABLE",
        checkedAt: timestamp,
        endpointFamily: "profile",
        endpoint:
          "https://financialmodelingprep.com/stable/profile-symbol?symbol=SPY",
        probeSymbol: "SPY",
        httpStatus: null,
        durationMs: 1,
        attempt: 1,
        responseBodySha256: null,
      }).success,
    ).toBe(false);
  });

  it("keeps workflow state, terminal outcome, and failure reason separate", () => {
    const active = {
      runId,
      idempotencyKey: "research-run-1",
      requestId: "request-1",
      principalId: "research-service",
      seedId: "seed-1",
      parentRunId: null,
      attempt: 1,
      mode: "LIVE",
      state: "RUNNING",
      outcome: null,
      failureReason: null,
      releaseFingerprintSha256: hash,
      inputContractId: "research-seed",
      inputContractVersion: "1.0.0",
      inputSha256: otherHash,
      startedAt: timestamp,
      finishedAt: null,
      rowVersion: 2,
    };

    expect(ResearchRunSchema.parse(active).state).toBe("RUNNING");
    expect(
      ResearchRunSchema.safeParse({
        ...active,
        state: "TERMINAL",
        outcome: null,
        finishedAt: timestamp,
      }).success,
    ).toBe(false);
    expect(
      ResearchRunSchema.safeParse({
        ...active,
        state: "TERMINAL",
        outcome: "BLOCKED",
        finishedAt: timestamp,
        failureReason: null,
      }).success,
    ).toBe(false);
  });
});

describe("version snapshot contracts", () => {
  const configured = {
    snapshotKind: "CONFIGURED",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    runId,
    capturedAt: timestamp,
    gitCommit: "8fde944a0d0eaa78896b4f402f98fd12511a1cb3",
    runtimeVersions: [{ name: "node", version: "20.20.2" }],
    manifest: {
      manifestId: "market-research-lead",
      version: "1.0.0",
      sha256: hash,
    },
    models: [
      {
        provider: "openai",
        requestedModelId: "gpt-snapshot",
        returnedModelPolicy: "EXACT",
        allowedReturnedModelIds: ["gpt-snapshot"],
      },
    ],
    prompt: { artifactId: "lead-prompt", version: "1.0.0", sha256: hash },
    skills: [
      { artifactId: "entity-resolution", version: "1.0.0", sha256: hash },
    ],
    tools: [
      {
        toolId: "market.get_sip_snapshot",
        schemaVersion: "1.0.0",
        implementationVersion: "8fde944",
        schemaSha256: hash,
      },
    ],
    inputContract: { contractId: "seed", version: "1.0.0", sha256: hash },
    outputContract: { contractId: "packet", version: "1.0.0", sha256: hash },
    sourcePolicy: {
      policyId: "source-policy",
      version: "1.0.0",
      sha256: hash,
    },
    entityResolutionPolicy: {
      policyId: "entity-resolution-policy",
      version: "1.0.0",
      sha256: hash,
    },
    releasePolicy: {
      policyId: "release-policy",
      version: "1.0.0",
      sha256: otherHash,
    },
    evalSuite: {
      artifactId: "golden-suite",
      version: "1.0.0",
      sha256: hash,
    },
    priceCatalog: {
      catalogId: "provider-prices",
      version: "1.0.0",
      sha256: hash,
    },
    behaviorConfigHashes: [{ configId: "budgets", sha256: hash }],
    releaseFingerprintSha256: otherHash,
  };

  it("requires every configured model, prompt, skill, tool, contract, and policy version", () => {
    expect(ConfiguredVersionSnapshotSchema.parse(configured).snapshotKind).toBe(
      "CONFIGURED",
    );
    expect(
      ConfiguredVersionSnapshotSchema.safeParse({ ...configured, tools: [] })
        .success,
    ).toBe(false);
    const { sourcePolicy: _sourcePolicy, ...withoutSourcePolicy } = configured;
    expect(
      ConfiguredVersionSnapshotSchema.safeParse(withoutSourcePolicy).success,
    ).toBe(false);
    expect(
      ConfiguredVersionSnapshotSchema.safeParse({ ...configured, extra: true })
        .success,
    ).toBe(false);
  });
});

describe("trace contracts", () => {
  it("enumerates all behaviorally relevant trace kinds", () => {
    expect(TraceKindSchema.options).toEqual(
      expect.arrayContaining([
        "RUN_STATE_CHANGED",
        "PROVIDER_PREFLIGHT",
        "MODEL_CALL_INTENT",
        "MODEL_REQUEST",
        "MODEL_RESPONSE",
        "TOOL_CALL_INTENT",
        "TOOL_REQUEST",
        "TOOL_RESPONSE",
        "RETRY_SCHEDULED",
        "GRADER_RESULT",
        "GATE_RESULT",
      ]),
    );
  });

  it("requires typed payload, timing, cost, usage, principal, and evidence lineage", () => {
    const event = {
      traceEventId: "33333333-3333-4333-8333-333333333333",
      runId,
      sequence: 4,
      traceId: "trace-1",
      spanId: "span-4",
      parentSpanId: "span-3",
      principal: {
        kind: "agent",
        principalId: "lead-agent",
        subject: "market-research-lead",
        servicePrincipalId: "research-service",
        manifestId: "market-research-lead",
        manifestVersion: "1.0.0",
        scopes: ["tool:market-data"],
      },
      versionSnapshotId: "22222222-2222-4222-8222-222222222222",
      kind: "MODEL_RESPONSE",
      attempt: 1,
      status: "SUCCEEDED",
      name: "lead-plan",
      requestedAt: timestamp,
      respondedAt: timestamp,
      durationMs: 120,
      providerRequestId: "request-provider-1",
      callId: "response-1",
      payload: {
        provider: "openai",
        requestedModelId: "gpt-snapshot",
        returnedModelId: "gpt-snapshot",
        providerResponseId: "response-1",
        stopReason: "completed",
        redactedResponseJson: '{"output":"bounded plan"}',
        outputSha256: hash,
      },
      payloadSha256: hash,
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: {
        currency: "USD",
        providerReportedMicroUsd: null,
        computedMicroUsd: 1200,
        priceCatalogVersion: "1.0.0",
      },
      error: null,
      evidenceIds: ["evidence-output-1"],
    };

    expect(TraceEventSchema.parse(event).kind).toBe("MODEL_RESPONSE");
    const {
      redactedResponseJson: _redactedResponseJson,
      ...hashOnlyPayload
    } = event.payload;
    expect(
      TraceEventSchema.safeParse({ ...event, payload: hashOnlyPayload }).success,
    ).toBe(false);
    expect(TraceEventSchema.safeParse({ ...event, payload: {} }).success).toBe(
      false,
    );
    expect(
      TraceEventSchema.safeParse({ ...event, hiddenRetry: true }).success,
    ).toBe(false);
  });
});

describe("evidence and lineage contracts", () => {
  const passage = {
    kind: "PASSAGE",
    evidenceId: "passage-1",
    runId,
    sha256: hash,
    capturedAt: timestamp,
    storageReference: "evidence://passage-1",
    sourceVersionId: "source-1",
    locator: "paragraph:4",
    exactText: "The issuer announced the material event.",
  };

  const claim = {
    kind: "CLAIM",
    evidenceId: "claim-1",
    runId,
    sha256: otherHash,
    capturedAt: timestamp,
    storageReference: "evidence://claim-1",
    claimText: "The issuer announced the material event.",
    material: true,
    authorProvider: "openai",
    authorManifestId: "market-research-lead",
  };

  const supportLink = {
    relation: "SUPPORTS",
    linkId: "link-1",
    runId,
    sourceEvidenceId: "passage-1",
    sourceKind: "PASSAGE",
    targetEvidenceId: "claim-1",
    targetKind: "CLAIM",
    createdAt: timestamp,
  };

  it("uses discriminated immutable evidence nodes and directional links", () => {
    expect(EvidenceNodeSchema.parse(passage).kind).toBe("PASSAGE");
    expect(EvidenceNodeSchema.safeParse({ ...claim, runId: null }).success).toBe(
      false,
    );
    expect(EvidenceLinkSchema.parse(supportLink).relation).toBe("SUPPORTS");
    expect(
      EvidenceLinkSchema.safeParse({
        ...supportLink,
        sourceKind: "CLAIM",
        targetKind: "PASSAGE",
      }).success,
    ).toBe(false);
  });

  it("requires a versioned graph hash and rejects unknown graph fields", () => {
    const graph = {
      runId,
      nodes: [passage, claim],
      links: [supportLink],
      validatorVersion: "1.0.0",
      graphSha256: hash,
    };
    expect(EvidenceGraphSchema.parse(graph).nodes).toHaveLength(2);
    expect(
      EvidenceGraphSchema.safeParse({ ...graph, trusted: true }).success,
    ).toBe(false);
  });
});

describe("evaluation and typed-decision contracts", () => {
  it("uses the exact case states, partitions, and ten instrument classes", () => {
    expect(CaseStateSchema.options).toEqual([
      "CANDIDATE",
      "GRADED",
      "GOLDEN",
      "SUPERSEDED",
    ]);
    expect(CasePartitionSchema.options).toEqual([
      "TRAINING",
      "VALIDATION",
      "HOLDOUT",
      "QUARANTINED",
    ]);
    expect(InstrumentClassSchema.options).toHaveLength(10);
  });

  it("separates deterministic, opposing-model, and human grader results", () => {
    const deterministic = {
      graderKind: "DETERMINISTIC",
      gradeId: "grade-1",
      runId,
      caseRevisionId: "case-1-r1",
      trialSeriesId: "series-1",
      batchOrdinal: 1,
      rubricSha256: hash,
      outputSha256: otherHash,
      completedAt: timestamp,
      verdict: "PASS",
      checks: [
        {
          checkId: "lineage-reconstruction",
          verdict: "PASS",
          critical: true,
          reasonCodes: [],
        },
      ],
    };
    expect(GraderResultSchema.parse(deterministic).graderKind).toBe(
      "DETERMINISTIC",
    );
    expect(
      GraderResultSchema.safeParse({
        graderKind: "OPPOSING_MODEL",
        gradeId: "grade-2",
        runId,
        caseRevisionId: "case-1-r1",
        trialSeriesId: "series-1",
        batchOrdinal: 1,
        rubricSha256: hash,
        outputSha256: otherHash,
        completedAt: timestamp,
        verdict: "PASS",
        graderProvider: "openai",
        authorProvider: "openai",
        graderManifestId: "model-grader-openai",
        graderManifestVersion: "1.0.0",
        providerResponseId: "response-2",
        fieldVerdicts: [],
      }).success,
    ).toBe(false);
  });

  it("requires immutable attestation fields on typed release decisions", () => {
    const decision = {
      decisionType: "RELEASE",
      decisionId: "decision-1",
      verdict: "APPROVE",
      rationale: "All exact release gates passed.",
      subjectId: otherHash,
      subjectSha256: otherHash,
      revision: 1,
      supersedesDecisionId: null,
      humanPrincipalId: "human-1",
      credentialId: "credential-1",
      requestId: "request-1",
      decidedAt: timestamp,
      nonce: "nonce-1",
      attestationKeyId: "decision-key-v1",
      attestationHmacSha256: hash,
      releaseFingerprintSha256: hash,
      releasePolicySha256: otherHash,
      activeSuiteSha256: hash,
      rubricSha256: otherHash,
      trialMatrixSha256: hash,
    };
    expect(GovernanceDecisionSchema.parse(decision).decisionType).toBe(
      "RELEASE",
    );
    expect(
      GovernanceDecisionSchema.safeParse({ ...decision, unsigned: true })
        .success,
    ).toBe(false);
  });
});

describe("agent output and candidate-packet contracts", () => {
  it("uses role-discriminated worker outputs", () => {
    const output = {
      agentRole: "market-research-lead",
      outputId: "output-1",
      runId,
      provider: "openai",
      candidateSeed: {
        seedId: "seed-1",
        symbol: "SPY",
        asOf: timestamp,
        task: "Validate the candidate catalyst.",
        fmpEndpointFamilies: ["profile"],
      },
      planSteps: ["Resolve the security", "Verify the catalyst"],
      draftClaims: [
        {
          claimId: "draft-claim-1",
          text: "A material catalyst may exist.",
          material: true,
          authorProvider: "openai",
        },
      ],
    };
    expect(AgentOutputSchema.parse(output).agentRole).toBe(
      "market-research-lead",
    );
    expect(
      AgentOutputSchema.safeParse({ ...output, published: true }).success,
    ).toBe(false);
  });

  it("keeps candidate packet drafts shadow-only and dependency-complete", () => {
    const packet = {
      packetId: "packet-1",
      runId,
      publicationStatus: "SHADOW",
      title: "SPY catalyst review",
      summary: "No publishable conclusion without complete evidence.",
      materialClaimEvidenceIds: ["claim-1"],
      sourceAuditEvidenceIds: ["audit-1"],
      graphSha256: hash,
      dependencyManifestSha256: otherHash,
      configuredSnapshotId: "22222222-2222-4222-8222-222222222222",
      observedSnapshotId: "44444444-4444-4444-8444-444444444444",
      expiresAt: timestamp,
      unknownFields: ["eventAt"],
      conflictFields: [],
      packetSha256: hash,
    };
    expect(CandidatePacketDraftSchema.parse(packet).publicationStatus).toBe(
      "SHADOW",
    );
    expect(
      CandidatePacketDraftSchema.safeParse({
        ...packet,
        publicationStatus: "PUBLISHABLE",
      }).success,
    ).toBe(false);
  });
});
