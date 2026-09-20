import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateLegacyConfig, parseLegacyJsonConfig } from '../../src/configuration/migrate.js';

const legacy = {
  version: '1.0.0',
  action_label: 'Follow Up',
  review_label: 'Review',
  thresholds: { requires_action: 0.55, is_important: 0.7, min_confidence: 0.6 },
  categories: [{
    key: 'finance',
    label: 'Finance',
    archive: true,
    description: 'Invoices and payment confirmations',
    examples: ['Payment confirmation'],
  }],
};

test('legacy JSON migrates to the current schema and preserves archive behavior', () => {
  const config = migrateLegacyConfig(legacy);
  assert.equal(config.version, 1);
  assert.equal(config.model, 'jev-latest');
  assert.equal(config.thresholds.actionRequired, 0.55);
  assert.equal(config.thresholds.actionNotRequired, 0.2);
  assert.equal(config.runtime.mode, 'archive');
  assert.deepEqual(config.categories[0], legacy.categories[0]);
});

test('legacy migration supports an explicit safe label-only mode', () => {
  const config = parseLegacyJsonConfig(JSON.stringify(legacy), { mode: 'label-only' });
  assert.equal(config.runtime.mode, 'label-only');
});

test('legacy migration rejects unknown fields and invalid JSON', () => {
  assert.throws(
    () => migrateLegacyConfig({ ...legacy, future_field: true }),
    /unknown property/,
  );
  assert.throws(() => parseLegacyJsonConfig('{'), /invalid JSON/);
  assert.throws(
    () => migrateLegacyConfig({ ...legacy, categories: [{ ...legacy.categories[0], examples: [] }] }),
    /examples: expected 1 to 20/,
  );
});
