// The Normalized Architecture Model (NAM): the canonical, versioned, validated
// representation KubeVerse's generators consume. The AI compiler only ever
// produces a *proposal* against this schema — this validator, not the model's
// raw output, is the source of truth (KUBEVERSE_MASTER_SPEC.md, "AI architecture
// compiler and execution safety").
import { z } from 'zod';

export const serviceTypeSchema = z.enum(['frontend', 'backend', 'worker', 'gateway', 'database', 'cache', 'other']);
export const runtimeSchema = z.enum(['node', 'mongodb', 'redis', 'postgres', 'mysql']);
export const protocolSchema = z.enum(['http', 'tcp']);

// OpenRouter/OpenAI structured-output "strict" mode requires every object's
// `required` array to list *every* key in `properties` — an optional or
// defaulted field must be represented as nullable instead of simply omitted
// from `required`. providers/openrouter.ts's zodToJsonSchema call uses
// `target: 'openAi'`, which performs exactly that transformation when it
// builds the JSON Schema document (see zod-to-json-schema's
// `forceOptionalIntoNullable`, dist/cjs/parsers/object.js). That transformation
// only affects the *generated JSON Schema document* though — it does not
// change the Zod validator itself. So every field that becomes nullable on
// the wire must *also* independently accept `null` here, or a real strict-mode
// response using its own new allowance (explicit `null` instead of omitting
// the field) would fail our validation. These two helpers add that `null`
// handling and normalize it the same way as an omitted field, so the resulting
// ArchitectureSpec/ServiceSpec contract — what the generators and frontend
// consume — is completely unchanged either way.
function withDefault<T extends z.ZodTypeAny>(schema: T, defaultValue: z.infer<T>) {
  return schema
    .nullable()
    .optional()
    .default(defaultValue)
    .transform((value): z.infer<T> => value ?? defaultValue);
}

function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .nullable()
    .optional()
    .transform((value): z.infer<T> | undefined => value ?? undefined);
}

export const resourceQuantitySchema = z.object({
  cpu: withDefault(z.string(), '250m'),
  memory: withDefault(z.string(), '256Mi'),
});

export const healthCheckSchema = z.object({
  path: withDefault(z.string(), '/health'),
  intervalSeconds: withDefault(z.number().int().positive(), 10),
  timeoutSeconds: withDefault(z.number().int().positive(), 3),
});

export const volumeSchema = z.object({
  name: z.string(),
  mountPath: z.string(),
  sizeGi: withDefault(z.number().positive(), 1),
});

const envEntrySchema = z.object({ key: z.string(), value: z.string() });

function toEnvEntries(value: unknown): unknown {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({ key, value: entryValue }));
  return value;
}

// OpenAI/OpenRouter strict structured outputs cannot express an open-ended
// dictionary — `additionalProperties` must be `false` in strict mode — so the
// wire shape the AI is asked for is an array of {key, value} pairs, which is
// zod-to-json-schema's own documented recommendation for this exact case
// ("OpenAI may not support records in schemas! Try an array of key-value
// pairs instead."). `z.preprocess` normalizes that array — or a plain object,
// which existing internal callers/tests still construct directly — into the
// array shape before validating each entry. zod-to-json-schema's default
// `effectStrategy: 'input'` derives the JSON Schema from a preprocess's
// *inner* schema (ignoring the preprocess function itself), so the schema
// actually sent to OpenRouter only ever shows the array-of-pairs shape.
// `env` still parses to a plain `Record<string, string>` — the same
// ServiceSpec contract the generators and frontend already depend on.
const envSchema = z
  .preprocess(toEnvEntries, z.array(envEntrySchema))
  .transform((entries): Record<string, string> => Object.fromEntries(entries.map((entry): [string, string] => [entry.key, entry.value])));

// mongodb/redis/postgres/mysql speak their own wire protocol, never HTTP -
// there is exactly one physically correct `protocol` for them. Modeling this
// as a hard validation error would make Compile fail every time the AI
// simply omits `protocol` on a database service (the common case, since
// `protocol` defaults to 'http' - a sensible default for the much more
// common `runtime: 'node'` case, but wrong here). Instead this is corrected
// the same way an unset field already is - structurally, not by rejection -
// so it is impossible for a managed runtime to end up with an HTTP probe
// generated against it (generators/kubernetes.ts, generators/nodeService.ts),
// which previously crash-looped the Pod in a live cluster (confirmed: an
// httpGet probe against Redis triggers Redis's own cross-protocol-scripting
// defense and gets the container killed on every liveness check).
const managedRuntimes = new Set<z.infer<typeof runtimeSchema>>(['mongodb', 'redis', 'postgres', 'mysql']);

export const serviceSpecSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'service name must be lowercase kebab-case'),
    type: serviceTypeSchema,
    runtime: runtimeSchema,
    port: z.number().int().min(1).max(65535),
    protocol: withDefault(protocolSchema, 'http'),
    command: optionalNullable(z.string()),
    env: envSchema,
    dependsOn: withDefault(z.array(z.string()), []),
    replicas: withDefault(z.number().int().min(1).max(10), 1),
    resources: withDefault(
      z.object({
        requests: withDefault(resourceQuantitySchema, { cpu: '250m', memory: '256Mi' }),
        limits: withDefault(resourceQuantitySchema, { cpu: '250m', memory: '256Mi' }),
      }),
      { requests: { cpu: '250m', memory: '256Mi' }, limits: { cpu: '250m', memory: '256Mi' } },
    ),
    healthCheck: withDefault(healthCheckSchema, { path: '/health', intervalSeconds: 10, timeoutSeconds: 3 }),
    volume: optionalNullable(volumeSchema),
    expose: withDefault(z.boolean(), false),
  })
  .transform((service) => (managedRuntimes.has(service.runtime) ? { ...service, protocol: 'tcp' as const } : service));

export const trafficEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  description: optionalNullable(z.string()),
});

export const architectureSpecSchema = z
  .object({
    name: z.string().min(1),
    version: withDefault(z.literal(1), 1),
    services: z.array(serviceSpecSchema).min(1),
    traffic: withDefault(z.array(trafficEdgeSchema), []),
  })
  .superRefine((spec, ctx) => {
    const names = new Set<string>();
    for (const service of spec.services) {
      if (names.has(service.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate service name "${service.name}"`, path: ['services'] });
      }
      names.add(service.name);
    }
    for (const service of spec.services) {
      for (const dep of service.dependsOn) {
        if (!names.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `service "${service.name}" depends on unknown service "${dep}"`,
            path: ['services'],
          });
        }
      }
    }
    for (const edge of spec.traffic) {
      if (!names.has(edge.from)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `traffic edge references unknown service "${edge.from}"`, path: ['traffic'] });
      }
      if (!names.has(edge.to)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `traffic edge references unknown service "${edge.to}"`, path: ['traffic'] });
      }
    }
  });

export type ServiceSpec = z.infer<typeof serviceSpecSchema>;
export type ArchitectureSpec = z.infer<typeof architectureSpecSchema>;

export function validateArchitectureSpec(candidate: unknown) {
  return architectureSpecSchema.safeParse(candidate);
}
