// This contract is owned by the orchestration boundary. Downstream services receive only their slice.
const allowedChecks = new Set(['schema', 'required-fields', 'business-rules']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function normalizeEnabledSection(section, defaults) {
  return { ...defaults, ...(section ?? {}) };
}

export function validateProcessRequest(payload) {
  const errors = [];
  addError(errors, isObject(payload), 'Request body must be an object.');
  if (!isObject(payload)) return { valid: false, errors };

  const { document } = payload;
  addError(errors, isObject(document), 'document must be an object.');
  if (isObject(document)) {
    addError(errors, typeof document.name === 'string' && document.name.trim().length > 0, 'document.name must be a non-empty string.');
    addError(errors, typeof document.type === 'string' && document.type.trim().length > 0, 'document.type must be a non-empty string.');
    addError(errors, typeof document.mimeType === 'string' && document.mimeType.trim().length > 0, 'document.mimeType must be a non-empty string.');
    addError(errors, Number.isInteger(document.size) && document.size >= 0, 'document.size must be a non-negative integer.');
  }

  addError(errors, isObject(payload.pipeline), 'pipeline must be an object.');
  if (!isObject(payload.pipeline)) return { valid: false, errors };

  for (const name of ['validation', 'security', 'ocr']) {
    addError(errors, payload.pipeline[name] === undefined || isObject(payload.pipeline[name]), `pipeline.${name} must be an object when provided.`);
  }

  const validation = normalizeEnabledSection(payload.pipeline.validation, { enabled: false, checks: [] });
  const security = normalizeEnabledSection(payload.pipeline.security, { enabled: false, malwareScan: false, deepScan: false });
  const ocr = normalizeEnabledSection(payload.pipeline.ocr, { enabled: false, extractText: true, extractTables: false, languageDetection: false, accuracy: 'normal' });

  for (const [name, section] of Object.entries({ validation, security, ocr })) {
    addError(errors, typeof section.enabled === 'boolean', `pipeline.${name}.enabled must be a boolean.`);
  }
  addError(errors, Array.isArray(validation.checks) && validation.checks.every((check) => allowedChecks.has(check)), 'pipeline.validation.checks contains an unsupported check.');
  addError(errors, typeof security.malwareScan === 'boolean' && typeof security.deepScan === 'boolean', 'pipeline.security scan options must be booleans.');
  addError(errors, !security.deepScan || security.malwareScan, 'pipeline.security.deepScan requires malwareScan=true.');
  addError(errors, typeof ocr.extractText === 'boolean' && typeof ocr.extractTables === 'boolean' && typeof ocr.languageDetection === 'boolean', 'pipeline.ocr extraction options must be booleans.');
  addError(errors, ['normal', 'high'].includes(ocr.accuracy), 'pipeline.ocr.accuracy must be normal or high.');
  addError(errors, !ocr.enabled || ocr.extractText || ocr.extractTables, 'Enabled OCR requires extractText or extractTables.');
  addError(errors, validation.enabled || security.enabled || ocr.enabled, 'At least one pipeline service must be enabled.');

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: {
      document: { name: document.name.trim(), type: document.type.trim(), mimeType: document.mimeType.trim(), size: document.size },
      pipeline: { validation, security, ocr }
    }
  };
}
