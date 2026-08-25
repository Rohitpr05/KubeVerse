// RFC 9562 UUIDv7: 48-bit ms timestamp + version/variant bits + random.
// Node's crypto.randomUUID() only produces v4, so KubeVerse generates its own
// time-ordered identifiers for installations, projects, and sessions.
import { randomBytes } from 'node:crypto';

export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f); // variant 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidv7(value: string): boolean {
  return UUIDV7_PATTERN.test(value);
}
