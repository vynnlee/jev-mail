import { validateConfig, type JevMailConfig, type CategoryConfig, type RuntimeMode } from './index.js';

interface LegacyThresholds {
  requires_action?: unknown;
  is_important?: unknown;
  min_confidence?: unknown;
  action_not_required?: unknown;
}

interface LegacyTaxonomy {
  version?: unknown;
  action_label?: unknown;
  review_label?: unknown;
  thresholds?: unknown;
  categories?: unknown;
}

type LegacyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LegacyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertLegacyRecord(value: unknown): asserts value is LegacyTaxonomy {
  if (!isRecord(value)) throw new Error('legacy config: expected a JSON object');
  const allowed = new Set(['version', 'action_label', 'review_label', 'thresholds', 'categories']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`legacy config: unknown property "${key}"`);
  }
}

function legacyNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`legacy config.${path}: expected a finite number`);
  }
  return value;
}

/**
 * Convert the pre-0.2 JSON taxonomy format into the current YAML schema.
 * The returned object is validated by the current strict configuration validator.
 */
export function migrateLegacyConfig(value: unknown, options: { mode?: RuntimeMode } = {}): JevMailConfig {
  assertLegacyRecord(value);
  if (value.version !== undefined && typeof value.version !== 'string' && value.version !== 1) {
    throw new Error('legacy config.version: expected a version string');
  }
  if (typeof value.action_label !== 'string' || !value.action_label.trim()) {
    throw new Error('legacy config.action_label: expected a non-empty string');
  }
  if (typeof value.review_label !== 'string' || !value.review_label.trim()) {
    throw new Error('legacy config.review_label: expected a non-empty string');
  }
  if (!isRecord(value.thresholds)) throw new Error('legacy config.thresholds: expected an object');
  const thresholdKeys = new Set(['requires_action', 'is_important', 'min_confidence', 'action_not_required']);
  for (const key of Object.keys(value.thresholds)) {
    if (!thresholdKeys.has(key)) throw new Error(`legacy config.thresholds: unknown property "${key}"`);
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    throw new Error('legacy config.categories: expected a non-empty array');
  }

  const categories: CategoryConfig[] = value.categories.map((raw, index) => {
    const path = `legacy config.categories[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path}: expected an object`);
    const allowed = new Set(['key', 'label', 'archive', 'description', 'examples']);
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) throw new Error(`${path}: unknown property "${key}"`);
    }
    if (typeof raw.key !== 'string' || typeof raw.label !== 'string' ||
        typeof raw.description !== 'string' || typeof raw.archive !== 'boolean' ||
        !Array.isArray(raw.examples)) {
      throw new Error(`${path}: expected key, label, description, examples, and archive`);
    }
    return {
      key: raw.key,
      label: raw.label,
      description: raw.description,
      examples: raw.examples,
      archive: raw.archive,
    } as CategoryConfig;
  });

  const thresholds = value.thresholds as LegacyThresholds;
  const migrated = {
    version: 1 as const,
    model: 'jev-latest',
    labels: { action: value.action_label, review: value.review_label },
    thresholds: {
      actionRequired: legacyNumber(thresholds.requires_action, 'thresholds.requires_action', 0.55),
      actionNotRequired: legacyNumber(thresholds.action_not_required, 'thresholds.action_not_required', 0.2),
      important: legacyNumber(thresholds.is_important, 'thresholds.is_important', 0.7),
      categoryConfidence: legacyNumber(thresholds.min_confidence, 'thresholds.min_confidence', 0.6),
    },
    categories,
    runtime: {
      batchSize: 10,
      maxScan: 100,
      maxRuntimeSeconds: 240,
      // Preserve the old generator's archive behavior unless the caller opts into label-only.
      mode: options.mode || 'archive',
      intervalMinutes: 5,
    },
  } satisfies JevMailConfig;

  return validateConfig(migrated);
}

export function parseLegacyJsonConfig(text: string, options: { mode?: RuntimeMode } = {}): JevMailConfig {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('legacy config: expected non-empty JSON text');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`legacy config: invalid JSON (${message})`);
  }
  return migrateLegacyConfig(parsed, options);
}
