import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bundle = fs.readFileSync(new URL('../../dist/gas/Code.gs', import.meta.url), 'utf8');
const config = {
  version: 1,
  model: 'jev-latest',
  labels: { action: 'Follow Up', review: 'Review' },
  thresholds: { actionRequired: 0.55, actionNotRequired: 0.2,
    important: 0.7, categoryConfidence: 0.6 },
  categories: [{ key: 'receipts', label: 'Receipts', description: 'Financial receipts',
    examples: ['purchase receipt'], archive: true }],
  runtime: { batchSize: 10, maxScan: 100, maxRuntimeSeconds: 240,
    mode: 'archive', intervalMinutes: 5 },
};

function harness(httpCode = 200) {
  const properties = new Map();
  const triggers = [];
  const requests = [];
  const labels = new Set();
  const message = {
    id: 'message-1', inbox: true, starred: false,
    getId() { return this.id; },
    isInInbox() { return this.inbox; },
    isStarred() { return this.starred; },
    star() { this.starred = true; },
    getFrom() { return 'merchant@example.com'; },
    getTo() { return 'owner@example.com'; },
    getSubject() { return 'Your receipt'; },
    getPlainBody() { return 'Your purchase receipt is ready.'; },
    getDate() { return new Date('2026-09-20T00:00:00Z'); },
    getAttachments() { return []; },
  };
  const thread = {
    archived: false,
    getId: () => 'thread-1',
    getMessages: () => [message],
    refresh() { return this; },
    getLabels: () => [...labels].map(name => ({ getName: () => name })),
    addLabel: label => labels.add(label.getName()),
    removeLabel: label => labels.delete(label.getName()),
    moveToArchive() { this.archived = true; message.inbox = false; },
  };
  const environment = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key),
      getProperties: () => Object.fromEntries(properties),
    }) },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: name => ({ timeBased: () => ({ everyMinutes: minutes => ({
        create: () => triggers.push({ getHandlerFunction: () => name, minutes }),
      }) }) }),
    },
    GmailApp: {
      search: (_query, start, max) => (message.inbox ? [thread] : []).slice(start, start + max),
      getUserLabelByName: name => ({ getName: () => name }),
      createLabel: name => ({ getName: () => name }),
    },
    UrlFetchApp: { fetch: (url, options) => {
      requests.push({ url, options });
      return { getResponseCode: () => httpCode,
        getContentText: () => JSON.stringify({ answers: {
          requires_action: { noul: 0.05 }, is_important: { noul: 0.05 },
          bucket: { choice: 'receipts', confidence: 0.9 },
        } }) };
    } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  };
  const context = vm.createContext(environment);
  vm.runInContext(`var JEV_CONFIG = ${JSON.stringify(config)};`, context);
  vm.runInContext(bundle, context, { filename: 'Code.gs' });
  return { context, properties, triggers, requests, labels, message, thread };
}

test('built GAS bundle exposes callable wrappers and processes one email once', () => {
  const run = harness();
  const functions = ['autoTriageInbox', 'installTrigger', 'disableTrigger', 'previewInbox',
    'status', 'verifySetup', 'configure', 'setEnabled'];
  for (const name of functions) assert.equal(typeof run.context[name], 'function', name);

  assert.equal(run.context.status().apiKeyConfigured, false);
  assert.equal(run.context.configure('secret-key').modelVerified, true);
  assert.equal(run.context.verifySetup().modelVerified, true);
  assert.equal(run.requests.length, 2);
  const verificationPayload = JSON.parse(run.requests[0].options.payload);
  assert.equal(verificationPayload.state.email.sender, 'check@example.com');
  assert.equal(run.context.installTrigger().triggerCount, 1);
  assert.equal(run.context.installTrigger().triggerCount, 1);
  assert.equal(run.triggers.length, 1);
  assert.equal(run.context.setEnabled(true).enabled, true);

  const beforePreview = new Map(run.properties);
  const preview = run.context.previewInbox(1);
  assert.equal(preview.results[0].targetLabel, 'Receipts');
  assert.equal(run.thread.archived, false);
  assert.equal(run.labels.size, 0);
  assert.deepEqual(run.properties, beforePreview);

  const actual = run.context.autoTriageInbox();
  assert.equal(actual.results[0].targetLabel, 'Receipts');
  assert.equal(run.thread.archived, true);
  assert.equal(run.labels.has('Receipts'), true);
  assert.equal(run.context.status().lastRun.handled, 1);
  assert.equal(run.context.autoTriageInbox().results.length, 0);
  assert.equal(run.context.disableTrigger().enabled, false);
  assert.equal(run.triggers.length, 1);
  assert.equal(run.context.autoTriageInbox().skipped, 'disabled');
});

test('built bundle rejects invalid TypeSafe connection before activation', () => {
  const run = harness(401);
  assert.throws(() => run.context.configure('invalid-key'), /verification failed/);
  assert.equal(run.context.status().apiKeyConfigured, false);
  run.context.installTrigger();
  const verified = run.context.verifySetup();
  assert.equal(verified.modelVerified, false);
  assert.match(verified.modelError, /not configured/);
  assert.throws(() => run.context.setEnabled(true), /not configured/);
  assert.notEqual(run.properties.get('JEV_MAIL_ENABLED'), 'true');
  assert.equal(run.labels.size, 0);
});
