export interface CompileOptions {
  model: string;
  apiKey: string;
}

export interface CredentialCheck {
  valid: boolean;
  message?: string;
}

// Bring-your-own-key abstraction so a future provider (OpenAI, Anthropic,
// local Ollama, OpenAI-compatible endpoints) can be added without touching
// the compiler or routes. compileArchitecture returns raw provider text; the
// compiler owns JSON parsing and schema validation, never the provider.
export interface AiProvider {
  id: string;
  compileArchitecture(source: string, options: CompileOptions): Promise<string>;
  validateCredential(apiKey: string): Promise<CredentialCheck>;
}
