import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const config: any = {
  version: 1,
  model: 'jev-latest',
  labels: { action: 'Follow Up', review: 'Review' },
  thresholds: { actionRequired: 0.55, actionNotRequired: 0.2,
    important: 0.7, categoryConfidence: 0.6 },
  categories: [{ key: 'receipts', label: 'Receipts', description: 'Receipts',
    examples: ['receipt'], archive: true }],
  runtime: { batchSize: 10, maxScan: 100, maxRuntimeSeconds: 240,
    mode: 'archive', intervalMinutes: 5 },
};

class Message {
  inbox = true;
  starred = false;
  constructor(public id: string, public subject: string) {}
  getId() { return this.id; }
  isInInbox() { return this.inbox; }
  isStarred() { return this.starred; }
  star() { this.starred = true; }
  getFrom() { return 'sender@example.com'; }
  getTo() { return 'owner@example.com'; }
  getCc() { return ''; }
  getSubject() { return this.subject; }
  getPlainBody() { return 'Receipt for subscription'; }
  getDate() { return new Date('2026-09-20T00:00:00Z'); }
  getAttachments() { return []; }
}
class Thread {
  labels = new Set<string>();
  archived = false;
  failAdd = false;
  constructor(public id: string, public messages: Message[]) {}
  getId() { return this.id; }
  getMessages() { return this.messages; }
  refresh() { return this; }
  getLabels() { return [...this.labels].map(name => ({ getName: () => name })); }
  addLabel(label: any) {
    if (this.failAdd) { this.failAdd = false; throw new Error('Gmail transient error'); }
    this.labels.add(label.getName());
  }
  removeLabel(label: any) { this.labels.delete(label.getName()); }
  moveToArchive() {
    this.archived = true;
    this.messages.forEach(message => { message.inbox = false; });
  }
}

let properties: Map<string, string>;
let threads: Thread[];
let triggers: any[];
let calls: number;
let answers: any;
let failApi: boolean;
let logs: string[];
let duringFetch: (() => void) | null;

function setup() {
  properties = new Map(); threads = []; triggers = []; calls = 0; failApi = false; logs = [];
  duringFetch = null;
  config.runtime.mode = 'archive';
  config.runtime.intervalMinutes = 5;
  answers = { requires_action: { noul: 0.05 }, is_important: { noul: 0.05 },
    bucket: { choice: 'receipts', confidence: 0.95 } };
  Object.assign(globalThis, {
    JEV_CONFIG: config,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => { properties.set(key, value); },
      deleteProperty: (key: string) => { properties.delete(key); },
      getProperties: () => Object.fromEntries(properties),
    }) },
    GmailApp: {
      search: (_query: string, start: number, max: number) =>
        threads.filter(thread => thread.messages.some(message => message.inbox)).slice(start, start + max),
      getUserLabelByName: (name: string) => ({ getName: () => name }),
      createLabel: (name: string) => ({ getName: () => name }),
    },
    UrlFetchApp: { fetch: () => {
      calls++;
      duringFetch?.();
      return { getResponseCode: () => failApi ? 503 : 200,
        getContentText: () => JSON.stringify({ answers }) };
    } },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: (trigger: any) => { triggers = triggers.filter(item => item !== trigger); },
      newTrigger: (name: string) => ({ timeBased: () => ({ everyMinutes: (_n: number) => ({
        create: () => { triggers.push({ getHandlerFunction: () => name }); },
      }) }) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: (message: string) => logs.push(message) },
  });
}

beforeEach(setup);
const worker = await import('../../src/gas/worker.js');
const json = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
function configure(key: string) { worker.configure(key); calls = 0; }
function enable() { worker.setEnabled(true); calls = 0; }

test('trigger installation is idempotent and preserves unrelated triggers', () => {
  triggers.push({ getHandlerFunction: () => 'unrelated' });
  json(worker.installTrigger());
  json(worker.installTrigger());
  assert.deepEqual(triggers.map(trigger => trigger.getHandlerFunction()),
    ['unrelated', 'autoTriageInbox']);
});

test('preview evaluates a message without Gmail or property mutations', () => {
  threads.push(new Thread('t1', [new Message('m1', 'Receipt')]));
  configure('private-key');
  const before = new Map(properties);
  const result = json(worker.previewInbox(1));
  assert.equal(result.results[0].targetLabel, 'Receipts');
  assert.deepEqual(properties, before);
  assert.equal(threads[0].labels.size, 0);
  assert.equal(threads[0].archived, false);
  assert.equal(calls, 1);
});

test('processing marks a message once and a new reply receives a new decision', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  assert.equal(json(worker.autoTriageInbox()).results.length, 1);
  assert.equal(thread.archived, true);
  assert.equal(calls, 1);
  thread.messages.push(new Message('m2', 'Need your decision'));
  answers = { ...answers, requires_action: { noul: 0.95 } };
  assert.equal(json(worker.autoTriageInbox()).results.length, 1);
  assert.equal(calls, 2);
  assert.equal(thread.labels.has('Follow Up'), true);
  assert.equal(thread.labels.has('Receipts'), false);
  assert.equal(json(worker.autoTriageInbox()).results.length, 0);
  assert.equal(calls, 2);
});

test('thread with multiple inbox messages is not archived as a side effect', () => {
  const thread = new Thread('t1', [new Message('m1', 'Old'), new Message('m2', 'New')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  json(worker.autoTriageInbox());
  assert.equal(thread.archived, false);
  assert.equal(thread.labels.has('Review'), true);
});

test('API failure leaves Gmail unchanged and backs off retries', () => {
  threads.push(new Thread('t1', [new Message('m1', 'Receipt')]));
  configure('private-key');
  worker.installTrigger();
  enable();
  failApi = true;
  assert.equal(json(worker.autoTriageInbox()).failures, 1);
  assert.equal(json(worker.autoTriageInbox()).results.length, 0);
  assert.equal(calls, 1);
  assert.equal(threads[0].labels.size, 0);
  assert.equal(threads[0].archived, false);
  assert.equal(logs.some(log => log.includes('private-key')), false);
});

test('scan cursor reaches an unprocessed message behind a page of completed threads', () => {
  for (let index = 0; index < 25; index++) {
    const thread = new Thread('t' + index, [new Message('m' + index, 'Done')]);
    threads.push(thread);
    properties.set('JEV_MAIL_RECEIPT_' + thread.id,
      JSON.stringify({ messageId: thread.messages[0].id, phase: 'done', at: Date.now() }));
  }
  threads.push(new Thread('target', [new Message('new', 'Receipt')]));
  configure('private-key');
  worker.installTrigger();
  enable();
  const result = json(worker.autoTriageInbox());
  assert.equal(result.results[0].messageId, 'new');
  assert.equal(calls, 1);
});

test('a reply arriving during inference prevents stale thread archive', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  duringFetch = () => { thread.messages.push(new Message('m2', 'Urgent reply')); duringFetch = null; };
  assert.equal(json(worker.autoTriageInbox()).results[0].status, 'changed');
  assert.equal(thread.archived, false);
  assert.equal(thread.labels.size, 0);
});

test('malformed model answer fails closed without Gmail changes', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  answers.bucket = { choice: 'receipts' };
  const result = json(worker.autoTriageInbox());
  assert.equal(result.failures, 1);
  assert.equal(thread.labels.size, 0);
  assert.equal(thread.archived, false);
});

test('Gmail failure retries stored decision without another model call', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  thread.failAdd = true;
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  assert.equal(json(worker.autoTriageInbox()).failures, 1);
  const key = 'JEV_MAIL_RECEIPT_t1';
  const pending = JSON.parse(properties.get(key)!);
  assert.equal(pending.phase, 'pending');
  pending.retryAt = 0;
  properties.set(key, JSON.stringify(pending));
  assert.equal(json(worker.autoTriageInbox()).failures, 0);
  assert.equal(calls, 1);
  assert.equal(thread.archived, true);
});

test('label-only mode keeps categorized messages in inbox', () => {
  config.runtime.mode = 'label-only';
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  const result = json(worker.autoTriageInbox());
  assert.equal(result.results[0].shouldArchive, false);
  assert.equal(thread.labels.has('Receipts'), true);
  assert.equal(thread.archived, false);
});

test('old completed Inbox receipt remains durable and prevents reclassification', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  properties.set('JEV_MAIL_RECEIPT_t1', JSON.stringify({ messageId: 'm1', phase: 'done',
    at: Date.now() - 181 * 24 * 60 * 60 * 1000 }));
  configure('private-key');
  worker.installTrigger();
  enable();
  assert.equal(json(worker.autoTriageInbox()).results.length, 0);
  assert.equal(calls, 0);
  assert.equal(properties.has('JEV_MAIL_RECEIPT_t1'), true);
});

test('trigger interval update replaces only owned timer', () => {
  triggers.push({ getHandlerFunction: () => 'unrelated' });
  worker.installTrigger();
  config.runtime.intervalMinutes = 10;
  worker.installTrigger();
  assert.deepEqual(triggers.map(trigger => trigger.getHandlerFunction()),
    ['unrelated', 'autoTriageInbox']);
  assert.equal(properties.get('JEV_MAIL_INTERVAL'), '10');
});

test('invalid key cannot replace a previously configured key', () => {
  configure('private-key');
  assert.throws(() => worker.configure('  '), /nonempty/);
  failApi = true;
  assert.throws(() => worker.configure('invalid-key'), /verification failed/);
  assert.equal(properties.get('TYPESAFE_API_KEY'), 'private-key');
});

test('changed interval is reported and pauses an already enabled worker', () => {
  const thread = new Thread('t1', [new Message('m1', 'Receipt')]);
  threads.push(thread);
  configure('private-key');
  worker.installTrigger();
  enable();
  config.runtime.intervalMinutes = 10;
  const setup = worker.status();
  assert.equal(setup.actualIntervalMinutes, 5);
  assert.equal(setup.desiredIntervalMinutes, 10);
  assert.equal(setup.triggerIntervalMatches, false);
  const outcome = worker.autoTriageInbox();
  assert.equal(outcome.skipped, 'trigger interval mismatch');
  assert.equal(worker.status().enabled, false);
  assert.equal(calls, 0);
  assert.equal(thread.labels.size, 0);
  assert.throws(() => worker.setEnabled(true), /rerun installTrigger/);
  worker.installTrigger();
  assert.equal(worker.status().triggerIntervalMatches, true);
  enable();
  assert.equal(worker.status().enabled, true);
});

test('preview rejects out of range limits before reading Gmail', () => {
  assert.throws(() => worker.previewInbox(21), /between 1 and 20/);
  assert.equal(calls, 0);
});

test('verifySetup checks TypeSafe with synthetic content and no Gmail access', () => {
  configure('private-key');
  const result = worker.verifySetup();
  assert.equal(result.modelVerified, true);
  assert.equal(result.apiKeyConfigured, true);
  assert.equal(calls, 1);
  assert.equal(threads.length, 0);
  assert.equal(properties.has('JEV_MAIL_LAST_RUN'), false);
});

test('invalid TypeSafe key fails verification and cannot enable', () => {
  worker.configure('invalid-key');
  worker.installTrigger();
  failApi = true;
  const verified = worker.verifySetup();
  assert.equal(verified.modelVerified, false);
  assert.match(verified.modelError, /HTTP 503/);
  assert.throws(() => worker.setEnabled(true), /connection check failed/);
  assert.notEqual(properties.get('JEV_MAIL_ENABLED'), 'true');
  assert.equal(logs.some(log => log.includes('invalid-key')), false);
});

test('one unreadable Gmail body does not stop the rest of the batch', () => {
  const broken = new Message('bad', 'Broken');
  broken.getPlainBody = () => { throw new Error('Gmail body unavailable'); };
  threads.push(new Thread('t1', [broken]), new Thread('t2', [new Message('good', 'Receipt')]));
  configure('private-key');
  worker.installTrigger();
  enable();
  const result = worker.autoTriageInbox();
  assert.equal(result.failures, 1);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].messageId, 'bad');
  assert.equal(threads[0].labels.size, 0);
  assert.equal(threads[1].archived, true);
  assert.equal(worker.status().lastRun.failures, 1);
});

test('full durable receipt store fails closed before another model call', () => {
  threads.push(new Thread('new-thread', [new Message('new-message', 'Receipt')]));
  for (let index = 0; index < 1200; index++) {
    properties.set('JEV_MAIL_RECEIPT_old-' + index,
      JSON.stringify({ messageId: 'old-' + index, phase: 'done', at: Date.now() }));
  }
  configure('private-key');
  worker.installTrigger();
  enable();
  const result = worker.autoTriageInbox();
  assert.equal(result.failures, 1);
  assert.match(result.results[0].error, /capacity reached/);
  assert.equal(calls, 0);
  assert.equal(threads[0].labels.size, 0);
  assert.equal(worker.status().receiptCapacityReached, true);
});
