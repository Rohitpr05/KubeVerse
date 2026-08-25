// The Normalized Architecture Model (NAM): the canonical, versioned, validated
// representation KubeVerse's generators consume. The AI compiler only ever
// produces a *proposal* against this schema — this validator, not the model's
// raw output, is the source of truth (KUBEVERSE_MASTER_SPEC.md, "AI architecture
// compiler and execution safety").
import { z } from 'zod';

export const serviceTypeSchema = z.enum(['frontend', 'backend', 'worker', 'gateway', 'database', 'cache', 'other']);
export const runtimeSchema = z.enum(['node', 'mongodb', 'redis', 'postgres', 'mysql']);
export const protocolSchema = z.enum(['http', 'tcp']);

export const resourceQuantitySchema = z.object({
  cpu: z.string().default('250m'),
  memory: z.string().default('256Mi'),
});

export const healthCheckSchema = z.object({
  path: z.string().default('/health'),
  intervalSeconds: z.number().int().positive().default(10),
  timeoutSeconds: z.number().int().positive().default(3),
});

export const volumeSchema = z.object({
  name: z.string(),
  mountPath: z.string(),
  sizeGi: z.number().positive().default(1),
});

export const serviceSpecSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'service name must be lowercase kebab-case'),
  type: serviceTypeSchema,
  runtime: runtimeSchema,
  port: z.number().int().min(1).max(65535),
  protocol: protocolSchema.default('http'),
  command: z.string().optional(),
  env: z.record(z.string()).default({}),
  dependsOn: z.array(z.string()).default([]),
  replicas: z.number().int().min(1).max(10).default(1),
  resources: z
    .object({
      requests: resourceQuantitySchema.default({}),
      limits: resourceQuantitySchema.default({}),
    })
    .default({}),
  healthCheck: healthCheckSchema.default({}),
  volume: volumeSchema.optional(),
  expose: z.boolean().default(false),
});

export const trafficEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  description: z.string().optional(),
});

export const architectureSpecSchema = z
  .object({
    name: z.string().min(1),
    version: z.literal(1).default(1),
    services: z.array(serviceSpecSchema).min(1),
    traffic: z.array(trafficEdgeSchema).default([]),
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
