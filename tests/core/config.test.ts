import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONFIG,
  parseConfigYaml,
  stringifyConfigYaml,
  validateConfig,
} from '../../src/configuration/index.js';

test('default config is valid and has safe distinct labels', () => {
  const config = validateConfig(DEFAULT_CONFIG);
  assert.equal(config.version, 1);
  assert.equal(config.labels.action, 'Follow Up');
  assert.equal(new Set(config.categories.map((category) => category.label)).size, config.categories.length);
});

test('YAML round trip preserves validated custom taxonomy', () => {
  const source = stringifyConfigYaml({
    ...DEFAULT_CONFIG,
    labels: { action: 'Needs Action', review: 'Human Review' },
    runtime: { ...DEFAULT_CONFIG.runtime, mode: 'label-only' },
    categories: [
      {
        key: 'work',
        label: 'Work',
        description: 'Work messages',
        examples: ['Project update'],
        archive: false,
      },
    ],
  });
  const parsed = parseConfigYaml(source);
  assert.equal(parsed.labels.action, 'Needs Action');
  assert.equal(parsed.runtime.mode, 'label-only');
  assert.deepEqual(parsed.categories[0], {
    key: 'work',
    label: 'Work',
    description: 'Work messages',
    examples: ['Project update'],
    archive: false,
  });
});

test('unknown properties and duplicate or reserved labels are rejected', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, extra: true }), /unknown property/);
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, labels: { action: 'INBOX', review: 'Review' } }),
    /reserved Gmail label/,
  );
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, labels: { action: 'Same', review: 'Same' } }),
    /must be different/,
  );
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, categories: [{ ...DEFAULT_CONFIG.categories[0], label: 'Review' }] }),
    /duplicate label/,
  );
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, categories: [{ ...DEFAULT_CONFIG.categories[0], key: '__review__' }] }),
    /reserved key/,
  );
});

test('threshold and runtime invariants are rejected', () => {
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_CONFIG.thresholds, actionNotRequired: 0.8 } }),
    /actionNotRequired must be lower/,
  );
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, batchSize: 101 } }),
    /batchSize: expected/,
  );
});
