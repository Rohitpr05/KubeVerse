import { openRouterProvider } from './openrouter.js';
import type { AiProvider } from './types.js';

const providers: Record<string, AiProvider> = {
  openrouter: openRouterProvider,
};

export function getProvider(id: string): AiProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown AI provider "${id}".`);
  return provider;
}
