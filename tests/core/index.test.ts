import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayload, decide } from '../../src/core/index.js';
import { REVIEW_BUCKET_KEY } from '../../src/configuration/index.js';
import { DEFAULT_CONFIG } from '../../src/configuration/index.js';

const email = {
  sender: 'sender@example.com',
  recipient: 'me@example.com',
  subject: 'Please approve the proposal',
  snippet: 'Could you approve the proposal by Friday?',
  direction: 'inbound' as const,
  previousSnippet: 'Here is the first draft.',
};

test('buildPayload includes only supplied context and all typed judgments', () => {
  const payload = buildPayload(email, DEFAULT_CONFIG);
  assert.equal(payload.model, 'jev-latest');
  assert.deepEqual(payload.state.email, {
    sender: email.sender,
    recipient: email.recipient,
    subject: email.subject,
    snippet: email.snippet,
    direction: 'inbound',
    previous_snippet: email.previousSnippet,
  });
  assert.deepEqual(payload.questions.bucket.criteria.pending.examples, DEFAULT_CONFIG.categories[0].examples);
  assert.ok(payload.questions.bucket.criteria[REVIEW_BUCKET_KEY]);
});

test('action decisions retain mail and star only important messages', () => {
  const decision = decide(
    { requires_action: { noul: 0.9 }, is_important: { noul: 0.8 } },
    DEFAULT_CONFIG,
  );
  assert.deepEqual(decision, {
    targetLabel: 'Follow Up',
    shouldStar: true,
    shouldArchive: false,
    reason: 'Action required and important; kept in Inbox and starred',
  });
});

test('Noul ambiguity is routed to Review without consuming unused answers', () => {
  const decision = decide({ requires_action: { noul: 0.4 } }, DEFAULT_CONFIG);
  assert.equal(decision.targetLabel, 'Review');
  assert.equal(decision.shouldArchive, false);
});

test('low confidence and unknown categories fail safe to Review', () => {
  const lowConfidence = decide(
    { requires_action: { noul: 0.05 }, bucket: { choice: 'receipts', confidence: 0.59 } },
    DEFAULT_CONFIG,
  );
  assert.equal(lowConfidence.targetLabel, 'Review');
  assert.equal(lowConfidence.shouldArchive, false);

  const unknown = decide(
    { requires_action: { noul: 0.05 }, bucket: { choice: 'not-configured', confidence: 0.99 } },
    DEFAULT_CONFIG,
  );
  assert.equal(unknown.targetLabel, 'Review');
  assert.equal(unknown.shouldArchive, false);

  const explicitReview = decide(
    { requires_action: { noul: 0.05 }, bucket: { choice: REVIEW_BUCKET_KEY, confidence: 0.99 } },
    DEFAULT_CONFIG,
  );
  assert.equal(explicitReview.targetLabel, 'Review');
  assert.equal(explicitReview.shouldArchive, false);
});

test('label-only mode never archives', () => {
  const decision = decide(
    { requires_action: { noul: 0.05 }, bucket: { choice: 'receipts', confidence: 0.99 } },
    { ...DEFAULT_CONFIG, runtime: { ...DEFAULT_CONFIG.runtime, mode: 'label-only' } },
  );
  assert.equal(decision.targetLabel, 'Receipts');
  assert.equal(decision.shouldArchive, false);
});

test('malformed probabilities throw only when the branch consumes them', () => {
  assert.throws(
    () => decide({ requires_action: { noul: Number.NaN } }, DEFAULT_CONFIG),
    /finite probability/,
  );
  assert.throws(
    () => decide({ requires_action: { noul: 0.9 }, is_important: { noul: 2 } }, DEFAULT_CONFIG),
    /finite probability/,
  );
  assert.throws(
    () => decide({ requires_action: { noul: 0.05 }, bucket: { choice: 'receipts', confidence: 2 } }, DEFAULT_CONFIG),
    /finite probability/,
  );
  assert.doesNotThrow(() => decide({ requires_action: { noul: 0.4 }, bucket: { confidence: Number.NaN } }, DEFAULT_CONFIG));
});
