import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type RuntimeMode = 'label-only' | 'archive';

/** Reserved Choice key used by Jev when no configured category is a safe fit. */
export const REVIEW_BUCKET_KEY = '__review__';

export interface CategoryConfig {
  key: string;
  label: string;
  description: string;
  examples: string[];
  archive: boolean;
}

export interface JevMailConfig {
  version: 1;
  model: string;
  labels: {
    action: string;
    review: string;
  };
  thresholds: {
    actionRequired: number;
    actionNotRequired: number;
    important: number;
    categoryConfidence: number;
  };
  categories: CategoryConfig[];
  runtime: {
    batchSize: number;
    maxScan: number;
    maxRuntimeSeconds: number;
    mode: RuntimeMode;
    intervalMinutes: number;
  };
}

const RESERVED_LABELS = new Set([
  'INBOX',
  'SPAM',
  'TRASH',
  'SENT',
  'DRAFT',
  'STARRED',
  'IMPORTANT',
  'UNREAD',
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  {
    key: 'pending',
    label: 'Pending',
    archive: true,
    description:
      'Awaiting a reply, package delivery, ticket response, or another external outcome',
    examples: [
      'We received your inquiry and will respond soon',
      'Your order has shipped and is on the way',
    ],
  },
  {
    key: 'receipts',
    label: 'Receipts',
    archive: true,
    description:
      'Financial receipts, payment confirmations, invoices, tickets, bookings, and subscription notices',
    examples: [
      'Your receipt from Acme Inc',
      'Payment confirmation for subscription',
    ],
  },
  {
    key: 'newsletter',
    label: 'Newsletter',
    archive: true,
    description:
      'Editorial content, digests, blogs, product updates, and marketing promotions',
    examples: ['This week in Tech Digest', 'Introducing our new feature v2.0'],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    archive: true,
    description:
      'Automated service notices, verification codes, password resets, security alerts, and repository activity',
    examples: [
      'Your verification code is 582914',
      'Security alert: New login detected',
      '[GitHub] Pull request #123 merged',
    ],
  },
];

export const DEFAULT_CONFIG: JevMailConfig = {
  version: 1,
  model: 'jev-latest',
  labels: { action: 'Follow Up', review: 'Review' },
  thresholds: {
    actionRequired: 0.55,
    actionNotRequired: 0.2,
    important: 0.7,
    categoryConfidence: 0.6,
  },
  categories: DEFAULT_CATEGORIES,
  runtime: {
    batchSize: 10,
    maxScan: 100,
    maxRuntimeSeconds: 240,
    mode: 'label-only',
    intervalMinutes: 5,
  },
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: RecordLike, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${path}: unknown property "${key}"`);
    }
  }
}

function assertSafeString(value: unknown, path: string, options: { label?: boolean } = {}): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${path}: expected a non-empty trimmed string`);
  }
  if (value.length > (options.label ? 100 : 4000)) {
    throw new Error(`${path}: string is too long`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${path}: contains unsupported control characters`);
  }
}

function assertLabel(value: unknown, path: string): asserts value is string {
  assertSafeString(value, path, { label: true });
  if (value === '.' || value === '..' || value.includes('/')) {
    throw new Error(`${path}: invalid Gmail label`);
  }
  if (RESERVED_LABELS.has(value.toUpperCase())) {
    throw new Error(`${path}: reserved Gmail label "${value}"`);
  }
}

function assertProbability(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path}: expected a finite number between 0 and 1`);
  }
}

function assertPositiveInteger(value: unknown, path: string, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${path}: expected an integer between 1 and ${max}`);
  }
}

function assertConfigShape(value: unknown): asserts value is RecordLike {
  if (!isRecord(value)) throw new Error('config: expected an object');
  assertExactKeys(value, ['version', 'model', 'labels', 'thresholds', 'categories', 'runtime'], 'config');
}

function validateConfigInternal(value: unknown): JevMailConfig {
  assertConfigShape(value);

  if (value.version !== 1) throw new Error('config.version: expected 1');
  assertSafeString(value.model, 'config.model');

  if (!isRecord(value.labels)) throw new Error('config.labels: expected an object');
  assertExactKeys(value.labels, ['action', 'review'], 'config.labels');
  assertLabel(value.labels.action, 'config.labels.action');
  assertLabel(value.labels.review, 'config.labels.review');

  if (value.labels.action === value.labels.review) {
    throw new Error('config.labels: action and review labels must be different');
  }

  if (!isRecord(value.thresholds)) throw new Error('config.thresholds: expected an object');
  assertExactKeys(
    value.thresholds,
    ['actionRequired', 'actionNotRequired', 'important', 'categoryConfidence'],
    'config.thresholds',
  );
  for (const key of ['actionRequired', 'actionNotRequired', 'important', 'categoryConfidence']) {
    assertProbability(value.thresholds[key], `config.thresholds.${key}`);
  }
  const actionRequired = value.thresholds.actionRequired as number;
  const actionNotRequired = value.thresholds.actionNotRequired as number;
  const important = value.thresholds.important as number;
  const categoryConfidence = value.thresholds.categoryConfidence as number;
  if (actionNotRequired >= actionRequired) {
    throw new Error('config.thresholds: actionNotRequired must be lower than actionRequired');
  }

  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    throw new Error('config.categories: expected a non-empty array');
  }
  const keys = new Set<string>();
  const labels = new Set<string>([value.labels.action, value.labels.review]);
  const categories = value.categories.map((raw, index): CategoryConfig => {
    const path = `config.categories[${index}]`;
    if (!isRecord(raw)) throw new Error(`${path}: expected an object`);
    assertExactKeys(raw, ['key', 'label', 'description', 'examples', 'archive'], path);
    assertSafeString(raw.key, `${path}.key`);
    if (raw.key === REVIEW_BUCKET_KEY) {
      throw new Error(`${path}.key: reserved key "${REVIEW_BUCKET_KEY}"`);
    }
    if (!/^[a-z][a-z0-9_-]*$/u.test(raw.key)) {
      throw new Error(`${path}.key: use lowercase letters, numbers, hyphens, or underscores`);
    }
    if (keys.has(raw.key)) throw new Error(`${path}.key: duplicate category key "${raw.key}"`);
    keys.add(raw.key);
    assertLabel(raw.label, `${path}.label`);
    if (labels.has(raw.label)) throw new Error(`${path}.label: duplicate label "${raw.label}"`);
    labels.add(raw.label);
    assertSafeString(raw.description, `${path}.description`);
    if (!Array.isArray(raw.examples) || raw.examples.length === 0 || raw.examples.length > 20) {
      throw new Error(`${path}.examples: expected 1 to 20 examples`);
    }
    const examples = raw.examples.map((example, exampleIndex) => {
      assertSafeString(example, `${path}.examples[${exampleIndex}]`);
      return example;
    });
    if (typeof raw.archive !== 'boolean') throw new Error(`${path}.archive: expected a boolean`);
    return {
      key: raw.key,
      label: raw.label,
      description: raw.description,
      examples,
      archive: raw.archive,
    };
  });

  if (!isRecord(value.runtime)) throw new Error('config.runtime: expected an object');
  assertExactKeys(
    value.runtime,
    ['batchSize', 'maxScan', 'maxRuntimeSeconds', 'mode', 'intervalMinutes'],
    'config.runtime',
  );
  assertPositiveInteger(value.runtime.batchSize, 'config.runtime.batchSize', 100);
  assertPositiveInteger(value.runtime.maxScan, 'config.runtime.maxScan', 10000);
  assertPositiveInteger(value.runtime.maxRuntimeSeconds, 'config.runtime.maxRuntimeSeconds', 900);
  assertPositiveInteger(value.runtime.intervalMinutes, 'config.runtime.intervalMinutes', 1440);
  if (value.runtime.mode !== 'label-only' && value.runtime.mode !== 'archive') {
    throw new Error('config.runtime.mode: expected "label-only" or "archive"');
  }
  if (![1, 5, 10, 15, 30].includes(value.runtime.intervalMinutes as number)) {
    throw new Error('config.runtime.intervalMinutes: Google Apps Script supports 1, 5, 10, 15, or 30 minutes');
  }
  if (value.runtime.batchSize > value.runtime.maxScan) {
    throw new Error('config.runtime.batchSize: cannot exceed maxScan');
  }

  return {
    version: 1,
    model: value.model,
    labels: { action: value.labels.action, review: value.labels.review },
    thresholds: {
      actionRequired,
      actionNotRequired,
      important,
      categoryConfidence,
    },
    categories,
    runtime: {
      batchSize: value.runtime.batchSize,
      maxScan: value.runtime.maxScan,
      maxRuntimeSeconds: value.runtime.maxRuntimeSeconds,
      mode: value.runtime.mode,
      intervalMinutes: value.runtime.intervalMinutes,
    },
  };
}

/** Validate and normalize a user-provided configuration. */
export function validateConfig(value: unknown): JevMailConfig {
  return validateConfigInternal(value);
}

/** Parse YAML and apply the same strict validation as JSON/config objects. */
export function parseConfigYaml(text: string): JevMailConfig {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('config YAML: expected non-empty text');
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`config YAML: ${message}`);
  }
  return validateConfigInternal(parsed);
}

export function stringifyConfigYaml(config: JevMailConfig): string {
  const validated = validateConfigInternal(config);
  return stringifyYaml(validated, { sortMapEntries: false });
}
