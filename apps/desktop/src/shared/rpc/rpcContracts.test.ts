import { describe, expect, it } from "vitest";
import {
  collectTsContracts,
  compareContracts,
  loadPythonSchemas,
  type OperationSchema,
  type TsContract,
} from "../../../scripts/check-rpc-types.mjs";

const itemSchema = {
  type: "object",
  properties: { page: { type: "integer" }, label: { type: "string" } },
  required: ["page"],
};

const schemas: Record<string, OperationSchema> = {
  "demo.run": {
    params: {
      type: "object",
      properties: {
        path: { type: "string" },
        password: { anyOf: [{ type: "string" }, { type: "null" }] },
        items: { type: "array", items: { $ref: "#/$defs/Item" } },
      },
      required: ["path"],
      $defs: { Item: itemSchema },
    },
    result: {
      type: "object",
      properties: { output: { type: "string" }, count: { type: "integer" } },
    },
  },
};

function contract(params: TsContract["params"], result: TsContract["result"], method = "demo.run"): TsContract {
  return { method, location: "demo.ts:1", params, result };
}

const matchingParams = {
  fields: {
    path: { optional: false, nested: null },
    password: { optional: true, nested: null },
    items: {
      optional: true,
      nested: { fields: { page: { optional: false, nested: null }, label: { optional: true, nested: null } } },
    },
  },
};
const matchingResult = { fields: { output: { optional: false, nested: null }, count: { optional: false, nested: null } } };

describe("compareContracts", () => {
  it("accepts TypeScript types that mirror the sidecar models", () => {
    expect(compareContracts([contract(matchingParams, matchingResult)], schemas)).toEqual([]);
  });

  it("reports unknown, wrongly optional and nested drift", () => {
    const params = {
      fields: {
        path: { optional: true, nested: null },
        stray: { optional: true, nested: null },
        items: { optional: true, nested: { fields: { pages: { optional: false, nested: null } } } },
      },
    };
    const result = { fields: { output: { optional: false, nested: null }, extra: { optional: false, nested: null } } };
    const problems = compareContracts([contract(params, result)], schemas);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("params.path: required by the sidecar but optional"),
        expect.stringContaining("params.stray: sent by the UI but not a sidecar parameter"),
        expect.stringContaining("params.items.pages: sent by the UI"),
        expect.stringContaining("params.items.page: required by the sidecar but missing"),
        expect.stringContaining("result.extra: read by the UI but never returned"),
        expect.stringContaining("result.count: returned by the sidecar but missing"),
      ]),
    );
    expect(problems).toHaveLength(6);
  });

  it("reports calls to operations the sidecar does not register", () => {
    expect(compareContracts([contract(matchingParams, null, "demo.missing")], schemas)).toEqual([
      "demo.missing (demo.ts:1): no sidecar operation with this name",
    ]);
  });
});

describe("rpc types against the sidecar", () => {
  it("finds no drift between shared/rpc calls and the registered pydantic models", () => {
    const contracts = collectTsContracts();
    expect(contracts.length).toBeGreaterThan(100);
    expect(compareContracts(contracts, loadPythonSchemas())).toEqual([]);
  }, 120_000);
});
