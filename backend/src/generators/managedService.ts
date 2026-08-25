// Runtimes with a well-known image get infrastructure manifests generated for
// them but no application source code - they are declared dependencies, not
// custom services (architecture.md example: "Database: MongoDB, port 27017").
export interface ManagedImage {
  image: string;
  port: number;
  volumeMountPath?: string;
  env?: Record<string, string>;
}

const catalog: Record<string, ManagedImage> = {
  mongodb: { image: 'mongo:7', port: 27017, volumeMountPath: '/data/db' },
  redis: { image: 'redis:7-alpine', port: 6379, volumeMountPath: '/data' },
  postgres: { image: 'postgres:16-alpine', port: 5432, volumeMountPath: '/var/lib/postgresql/data', env: { POSTGRES_PASSWORD: 'postgres' } },
  mysql: { image: 'mysql:8', port: 3306, volumeMountPath: '/var/lib/mysql', env: { MYSQL_ROOT_PASSWORD: 'mysql' } },
};

export function isManagedRuntime(runtime: string): boolean {
  return runtime in catalog;
}

export function managedImageFor(runtime: string): ManagedImage | undefined {
  return catalog[runtime];
}
