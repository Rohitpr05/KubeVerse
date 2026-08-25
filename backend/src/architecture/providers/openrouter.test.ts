import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseJsonSchema } from './openrouter.js';

type JsonSchemaNode = Record<string, unknown>;

const NUMERIC_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const;

// Walks the *exact* schema document exported from openrouter.ts (the same
// object reference passed as response_format.json_schema.schema) and checks
// it against the strict subset of JSON Schema OpenAI/OpenRouter's structured
// outputs actually accept. This exists to catch two real bugs that both
// shipped and both only showed up against the *real* provider, never in a
// reconstruction of the schema:
//
// BUG #1 (fixed by schema.ts's withDefault/optionalNullable + target:
// 'openAi'): an object's `required` didn't list every key in `properties` -
// OpenRouter rejected it with "'required' is required to be supplied and to
// be an array including every key in properties. Missing 'cpu'."
//
// BUG #2 (fixed by strictJsonSchema.ts's toStrictJsonSchema): zod-to-json-schema
// represents `.positive()`/`.gt()`/`.lt()` numeric bounds using JSON Schema
// draft-4's boolean-flag form (`{ minimum: 0, exclusiveMinimum: true }`)
// regardless of the "openAi" target - OpenRouter rejected it with "True is
// not of type 'number'".
//
// Every check below walks the *actual exported object*, not a hand-built
// approximation, so a schema change that reintroduces either bug (or a new
// field that happens to trigger the same zod-to-json-schema gaps) fails here
// before it ever reaches a real OpenRouter request.
function walk(node: unknown, path: string, issues: string[]): void {
  if (!node || typeof node !== 'object') return;
  const schema = node as JsonSchemaNode;

  if ('type' in schema && schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const propertyKeys = Object.keys(schema.properties as JsonSchemaNode);
    const required = schema.required;

    // Check 3: `required`, when present, must be an array of strings.
    if (required !== undefined) {
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
        issues.push(`${path}: "required" must be an array of strings, got ${JSON.stringify(required)}`);
      }
    }
    // Check 1: every property key must appear in `required`.
    const requiredList = Array.isArray(required) ? (required as unknown[]) : [];
    const missing = propertyKeys.filter((key) => !requiredList.includes(key));
    if (missing.length > 0) issues.push(`${path}: required is missing ${JSON.stringify(missing)} (has properties ${JSON.stringify(propertyKeys)}, required ${JSON.stringify(required)})`);

    // Checks 2 & 6: no open-ended dictionaries - additionalProperties must be
    // the literal boolean `false`, never absent, `true`, or a nested schema.
    if (schema.additionalProperties !== false) {
      issues.push(`${path}: additionalProperties must be false in strict mode, got ${JSON.stringify(schema.additionalProperties)}`);
    }

    for (const key of propertyKeys) walk((schema.properties as JsonSchemaNode)[key], `${path}.properties.${key}`, issues);
  }

  // Check 4: numeric JSON Schema keywords must never be booleans (this is
  // the exact shape of BUG #2 - `exclusiveMinimum: true`).
  for (const keyword of NUMERIC_KEYWORDS) {
    if (keyword in schema && typeof schema[keyword] !== 'number') {
      issues.push(`${path}.${keyword}: must be a number, got ${JSON.stringify(schema[keyword])} (${typeof schema[keyword]})`);
    }
  }

  // Check 5: additionalProperties, when it appears at all, must be an actual
  // boolean (covered above for object nodes; this also catches it appearing
  // somewhere unexpected, e.g. under a non-object node).
  if ('additionalProperties' in schema && typeof schema.additionalProperties !== 'boolean') {
    issues.push(`${path}.additionalProperties: must be a boolean, got ${JSON.stringify(schema.additionalProperties)}`);
  }

  if (schema.type === 'array' && schema.items) walk(schema.items, `${path}.items`, issues);

  // Check 8: a node should not mix a nullable-union wrapper with a sibling
  // `type` - every anyOf/oneOf node in this schema is a pure nullable
  // wrapper (see schema.ts's withDefault/optionalNullable), never combined
  // with `enum` (fine to combine with `type`), which would be an ambiguous
  // construct for a strict validator to resolve.
  for (const combinator of ['anyOf', 'oneOf'] as const) {
    const branches = schema[combinator];
    if (Array.isArray(branches)) {
      if ('type' in schema) issues.push(`${path}: has both "${combinator}" and a sibling "type" - ambiguous for strict mode`);
      branches.forEach((branch, index) => walk(branch, `${path}.${combinator}[${index}]`, issues));
    }
  }
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((branch, index) => walk(branch, `${path}.allOf[${index}]`, issues));

  if (schema.definitions && typeof schema.definitions === 'object') {
    for (const [key, value] of Object.entries(schema.definitions as JsonSchemaNode)) walk(value, `${path}.definitions.${key}`, issues);
  }
}

test('the wire schema satisfies the strict JSON Schema subset OpenRouter/OpenAI accept', () => {
  const issues: string[] = [];
  walk(responseJsonSchema, '$', issues);
  assert.deepEqual(issues, []);
});

test('the only $ref in the schema is the root wrapper, and it resolves', () => {
  // Check 7: $refStrategy 'none' inlines every nested reference: the *only*
  // $ref that should exist at all is the top-level `{ $ref, definitions }`
  // wrapper zod-to-json-schema always produces when a `name` is given, and
  // it must point at something that actually exists under `definitions`.
  const refs: string[] = [];
  function collectRefs(node: unknown): void {
    if (Array.isArray(node)) { node.forEach(collectRefs); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as JsonSchemaNode)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collectRefs(value);
    }
  }
  collectRefs(responseJsonSchema);
  assert.deepEqual(refs, ['#/definitions/architecture_spec']);

  const definitions = (responseJsonSchema as JsonSchemaNode).definitions as JsonSchemaNode;
  assert.ok(definitions && 'architecture_spec' in definitions, 'the root $ref must resolve to a real definition');
});

test('the schema is plain serializable JSON (round-trips through JSON.stringify/parse unchanged)', () => {
  const roundTripped = JSON.parse(JSON.stringify(responseJsonSchema));
  assert.deepEqual(roundTripped, responseJsonSchema);
});

test('services[].resources.requests requires both cpu and memory (BUG #1\'s exact reported field)', () => {
  const services = (responseJsonSchema as any).definitions.architecture_spec.properties.services.items;
  const resourcesBranch = services.properties.resources.anyOf[0];
  const requestsBranch = resourcesBranch.properties.requests.anyOf[0];
  assert.deepEqual(requestsBranch.required.sort(), ['cpu', 'memory']);
  assert.deepEqual(Object.keys(requestsBranch.properties).sort(), ['cpu', 'memory']);
});

test('healthCheck.intervalSeconds uses a numeric exclusiveMinimum, never the draft-4 boolean form (BUG #2\'s exact reported field)', () => {
  const services = (responseJsonSchema as any).definitions.architecture_spec.properties.services.items;
  const healthCheckBranch = services.properties.healthCheck.anyOf[0];
  const intervalBranch = healthCheckBranch.properties.intervalSeconds.anyOf[0];
  assert.equal(intervalBranch.exclusiveMinimum, 0);
  assert.equal('minimum' in intervalBranch, false);
});

test('services[].env is advertised as an array of {key, value} pairs, never an open dictionary', () => {
  const services = (responseJsonSchema as any).definitions.architecture_spec.properties.services.items;
  const envSchema = services.properties.env;
  assert.equal(envSchema.type, 'array');
  assert.deepEqual(envSchema.items.required.sort(), ['key', 'value']);
  assert.equal(envSchema.items.additionalProperties, false);
});
