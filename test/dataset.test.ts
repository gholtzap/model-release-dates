import assert from "node:assert/strict";
import test from "node:test";

import { dataset } from "../src/data.js";
import { DatasetValidationError, isIsoDate, parseDataset } from "../src/types.js";
import { asArray, asRecord, type JsonRecord } from "./helpers.js";

function validDataset(): JsonRecord {
  return {
    schema_version: 1,
    release_date_definition: "First public developer availability.",
    identifier_type_definition: {
      model: "Named API model.",
      snapshot: "Date-pinned API model.",
      weights: "Downloadable model weights.",
    },
    availability_definition: {
      api: "Official API.",
      weights: "Official weights.",
    },
    researched_at: "2026-07-20",
    models: [
      {
        model: "example/model-1",
        identifier_type: "model",
        availability: ["api"],
        release_date: "2025-01-02",
        confidence: "confirmed",
        sources: [
          {
            publisher: "Example",
            title: "Model 1 release",
            url: "https://example.com/model-1",
            evidence: "Model 1 became publicly available on January 2, 2025.",
          },
        ],
      },
    ],
  };
}

function firstModel(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(candidate["models"])[0]);
}

function firstSource(candidate: JsonRecord): JsonRecord {
  return asRecord(asArray(firstModel(candidate)["sources"])[0]);
}

interface InvalidDatasetCase {
  readonly name: string;
  readonly message: RegExp;
  readonly mutate: (candidate: JsonRecord) => void;
}

function assertInvalid(candidate: unknown, message: RegExp): void {
  assert.throws(
    () => parseDataset(candidate),
    (error: unknown) => error instanceof DatasetValidationError && message.test(error.message),
  );
}

test("the production dataset satisfies the complete runtime contract", () => {
  assert.equal(dataset.schema_version, 1);
  assert.equal(dataset.models.length, 48);
  assert.deepEqual(parseDataset(dataset), dataset);
  assert.equal(new Set(dataset.models.map((model) => model.model)).size, dataset.models.length);
  assert.ok(dataset.models.every((model) => model.sources.length > 0));
});

test("ISO date validation accepts real dates and rejects malformed calendar dates", () => {
  for (const value of ["2024-02-29", "2025-01-01", "2025-12-31"]) {
    assert.equal(isIsoDate(value), true, value);
  }
  for (const value of [
    "2023-02-29",
    "2025-02-30",
    "2025-00-10",
    "2025-13-01",
    "2025-1-01",
    "01-01-2025",
    "",
  ]) {
    assert.equal(isIsoDate(value), false, value);
  }
});

test("a minimal valid dataset is parsed into the public domain types", () => {
  const parsed = parseDataset(validDataset());
  assert.equal(parsed.models[0]?.model, "example/model-1");
  assert.equal(parsed.models[0]?.release_date, "2025-01-02");
  assert.deepEqual(parsed.models[0]?.availability, ["api"]);
});

test("top-level contract violations are rejected", async (context) => {
  assertInvalid(null, /dataset must be an object/);
  assertInvalid([], /dataset must be an object/);

  const cases: readonly InvalidDatasetCase[] = [
    {
      name: "unsupported top-level key",
      message: /dataset.extra is not supported/,
      mutate: (candidate) => {
        candidate["extra"] = true;
      },
    },
    {
      name: "missing top-level key",
      message: /dataset.models is required/,
      mutate: (candidate) => {
        delete candidate["models"];
      },
    },
    {
      name: "unsupported schema version",
      message: /schema_version must be 1/,
      mutate: (candidate) => {
        candidate["schema_version"] = 2;
      },
    },
    {
      name: "invalid research date",
      message: /researched_at must be a real ISO date/,
      mutate: (candidate) => {
        candidate["researched_at"] = "2026-02-30";
      },
    },
    {
      name: "missing models array",
      message: /models must be a non-empty array/,
      mutate: (candidate) => {
        candidate["models"] = "not-an-array";
      },
    },
    {
      name: "empty models array",
      message: /models must be a non-empty array/,
      mutate: (candidate) => {
        candidate["models"] = [];
      },
    },
    {
      name: "missing identifier definition",
      message: /identifier_type_definition.snapshot is required/,
      mutate: (candidate) => {
        delete asRecord(candidate["identifier_type_definition"])["snapshot"];
      },
    },
    {
      name: "unknown availability definition",
      message: /availability_definition.private is not supported/,
      mutate: (candidate) => {
        asRecord(candidate["availability_definition"])["private"] = "Private preview.";
      },
    },
    {
      name: "empty definition",
      message: /availability_definition.api must be a non-empty string/,
      mutate: (candidate) => {
        asRecord(candidate["availability_definition"])["api"] = "";
      },
    },
  ];

  for (const invalidCase of cases) {
    await context.test(invalidCase.name, () => {
      const candidate = validDataset();
      invalidCase.mutate(candidate);
      assertInvalid(candidate, invalidCase.message);
    });
  }
});

test("model identity and enum violations are rejected", async (context) => {
  const cases: readonly InvalidDatasetCase[] = [
    {
      name: "model is not an object",
      message: /models\[0\] must be an object/,
      mutate: (candidate) => {
        asArray(candidate["models"])[0] = null;
      },
    },
    {
      name: "unknown model field",
      message: /models\[0\].extra is not supported/,
      mutate: (candidate) => {
        firstModel(candidate)["extra"] = true;
      },
    },
    {
      name: "missing model field",
      message: /models\[0\].confidence is required/,
      mutate: (candidate) => {
        delete firstModel(candidate)["confidence"];
      },
    },
    {
      name: "empty model ID",
      message: /model must be a non-empty string/,
      mutate: (candidate) => {
        firstModel(candidate)["model"] = "";
      },
    },
    {
      name: "model ID lacks provider",
      message: /must contain one provider\/name separator/,
      mutate: (candidate) => {
        firstModel(candidate)["model"] = "model-1";
      },
    },
    {
      name: "model ID has extra separator",
      message: /must contain one provider\/name separator/,
      mutate: (candidate) => {
        firstModel(candidate)["model"] = "example/team/model-1";
      },
    },
    {
      name: "unsupported identifier type",
      message: /identifier_type is not supported/,
      mutate: (candidate) => {
        firstModel(candidate)["identifier_type"] = "alias";
      },
    },
    {
      name: "availability is empty",
      message: /availability must be a non-empty array/,
      mutate: (candidate) => {
        firstModel(candidate)["availability"] = [];
      },
    },
    {
      name: "unsupported availability",
      message: /availability\[0\] is not supported/,
      mutate: (candidate) => {
        firstModel(candidate)["availability"] = ["private"];
      },
    },
    {
      name: "duplicate availability",
      message: /availability contains duplicates/,
      mutate: (candidate) => {
        firstModel(candidate)["availability"] = ["api", "api"];
      },
    },
    {
      name: "invalid release date",
      message: /release_date must be a real ISO date/,
      mutate: (candidate) => {
        firstModel(candidate)["release_date"] = "2025-02-30";
      },
    },
    {
      name: "unsupported confidence",
      message: /confidence is not supported/,
      mutate: (candidate) => {
        firstModel(candidate)["confidence"] = "probable";
      },
    },
    {
      name: "duplicate model ID",
      message: /duplicate model example\/model-1/,
      mutate: (candidate) => {
        const models = asArray(candidate["models"]);
        models.push(models[0]);
      },
    },
  ];

  for (const invalidCase of cases) {
    await context.test(invalidCase.name, () => {
      const candidate = validDataset();
      invalidCase.mutate(candidate);
      assertInvalid(candidate, invalidCase.message);
    });
  }
});

test("source violations are rejected", async (context) => {
  const cases: readonly InvalidDatasetCase[] = [
    {
      name: "sources are empty",
      message: /sources must be a non-empty array/,
      mutate: (candidate) => {
        firstModel(candidate)["sources"] = [];
      },
    },
    {
      name: "source is not an object",
      message: /sources\[0\] must be an object/,
      mutate: (candidate) => {
        asArray(firstModel(candidate)["sources"])[0] = null;
      },
    },
    {
      name: "source has unknown field",
      message: /sources\[0\].extra is not supported/,
      mutate: (candidate) => {
        firstSource(candidate)["extra"] = true;
      },
    },
    {
      name: "source field is missing",
      message: /sources\[0\].evidence is required/,
      mutate: (candidate) => {
        delete firstSource(candidate)["evidence"];
      },
    },
    {
      name: "publisher is empty",
      message: /publisher must be a non-empty string/,
      mutate: (candidate) => {
        firstSource(candidate)["publisher"] = "";
      },
    },
    {
      name: "URL cannot be parsed",
      message: /url must be a valid URL/,
      mutate: (candidate) => {
        firstSource(candidate)["url"] = "not-a-url";
      },
    },
    {
      name: "URL is not HTTPS",
      message: /url must use HTTPS/,
      mutate: (candidate) => {
        firstSource(candidate)["url"] = "http://example.com/model-1";
      },
    },
  ];

  for (const invalidCase of cases) {
    await context.test(invalidCase.name, () => {
      const candidate = validDataset();
      invalidCase.mutate(candidate);
      assertInvalid(candidate, invalidCase.message);
    });
  }
});
