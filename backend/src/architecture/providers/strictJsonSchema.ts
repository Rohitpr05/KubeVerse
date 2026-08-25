// zod-to-json-schema's `target: 'openAi'` fixes the `required`/nullable
// handling OpenAI/OpenRouter's strict structured-output mode needs (every
// property in `properties` must appear in `required`; see schema.ts's
// `withDefault`/`optionalNullable`) - but it does not fix every construct for
// that same strict validator. Zod's non-inclusive numeric bounds
// (`.positive()`, `.negative()`, `.gt()`, `.lt()`) are still translated using
// JSON Schema draft-4's boolean-flag form, e.g.:
//
//   { "type": "integer", "minimum": 0, "exclusiveMinimum": true }
//
// because zod-to-json-schema's number parser only emits the modern numeric
// form (`{ "exclusiveMinimum": 0 }`) when `target: 'jsonSchema7'` is set
// (node_modules/zod-to-json-schema/dist/cjs/parsers/number.js) - "openAi" is
// not one of the targets that branch checks for. OpenAI's schema validator
// requires the modern (draft 2019-09+) form, where `exclusiveMinimum`/
// `exclusiveMaximum` must themselves be the numeric bound, not a boolean -
// this is the literal cause of OpenRouter's "True is not of type 'number'".
//
// This is a small, deterministic, well-understood draft-4 -> 2019-09
// conversion of exactly that one pattern, applied to the final schema
// document right before it's sent. It does not touch anything else, so any
// other field that later uses a non-inclusive numeric bound (`healthCheck`'s
// intervalSeconds/timeoutSeconds and `volume.sizeGi` today) is covered
// automatically rather than requiring every future schema author to remember
// to avoid `.positive()`/`.gt()`/`.lt()`.
export function toStrictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictJsonSchema);
  if (!node || typeof node !== 'object') return node;

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    next[key] = toStrictJsonSchema(value);
  }

  if (next.exclusiveMinimum === true && typeof next.minimum === 'number') {
    next.exclusiveMinimum = next.minimum;
    delete next.minimum;
  } else if (next.exclusiveMinimum === false) {
    delete next.exclusiveMinimum;
  }

  if (next.exclusiveMaximum === true && typeof next.maximum === 'number') {
    next.exclusiveMaximum = next.maximum;
    delete next.maximum;
  } else if (next.exclusiveMaximum === false) {
    delete next.exclusiveMaximum;
  }

  return next;
}
