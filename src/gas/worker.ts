import { buildPayload, decide } from '../core/index.js';

// Apps Script supplies these services at runtime. Keeping this adapter free of
// Google typings also lets the same bundle run against an in-memory E2E harness.
declare const GmailApp: any;
declare const UrlFetchApp: any;
declare const PropertiesService: any;
declare const ScriptApp: any;
declare const LockService: any;
declare const Logger: any;
declare const Session: any;
declare const JEV_CONFIG: any;

const PREFIX = 'JEV_MAIL_';
const RECEIPT_PREFIX = PREFIX + 'RECEIPT_';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const RECEIPT_LIMIT = 1200;
const RECEIPT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function props(): any { return PropertiesService.getScriptProperties(); }
function config(): any {
  if (typeof JEV_CONFIG === 'undefined' || !JEV_CONFIG || JEV_CONFIG.version !== 1) {
    throw new Error('Jev-Mail configuration is missing or incompatible');
  }
  return JEV_CONFIG;
}
function now(): number { return Date.now(); }
function output(value: unknown): string { return JSON.stringify(value); }
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function policyFingerprint(cfg: any): string {
  const source = output({ model: cfg.model, labels: cfg.labels, thresholds: cfg.thresholds,
    categories: cfg.categories, mode: cfg.runtime.mode });
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  }
  return (hash >>> 0).toString(16);
}
function ownedTriggers(): any[] {
  return ScriptApp.getProjectTriggers().filter((trigger: any) =>
    trigger.getHandlerFunction() === 'autoTriageInbox');
}

/** Called once in the Apps Script editor, where trigger creation is permitted. */
export function installTrigger(): any {
  const cfg = config();
  const minutes = cfg.runtime.intervalMinutes;
  if (![1, 5, 10, 15, 30].includes(minutes)) throw new Error('Unsupported trigger interval');
  const triggers = ownedTriggers();
  const knownInterval = props().getProperty(PREFIX + 'INTERVAL');
  if (triggers.length === 0 || knownInterval !== String(minutes)) {
    ScriptApp.newTrigger('autoTriageInbox').timeBased().everyMinutes(minutes).create();
    triggers.forEach((trigger: any) => ScriptApp.deleteTrigger(trigger));
  } else if (triggers.length > 1) {
    triggers.slice(1).forEach((trigger: any) => ScriptApp.deleteTrigger(trigger));
  }
  props().setProperty(PREFIX + 'INTERVAL', String(minutes));
  return { installed: true, triggerCount: 1, intervalMinutes: minutes };
}

/** Remote safe pause. The trigger stays installed for a later enable. */
export function setEnabled(enabled: boolean): any {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  config();
  if (enabled) {
    if (!props().getProperty('TYPESAFE_API_KEY')) throw new Error('TypeSafe API key is not configured');
    if (ownedTriggers().length !== 1) throw new Error('Run installTrigger once in Apps Script editor');
    if (!baseSetup().triggerIntervalMatches) {
      throw new Error('Trigger interval differs from configuration; rerun installTrigger in Apps Script editor');
    }
    const verified = verifySetup();
    if (!verified.modelVerified) throw new Error('TypeSafe connection check failed: ' + verified.modelError);
  }
  props().setProperty(PREFIX + 'ENABLED', enabled ? 'true' : 'false');
  return { enabled };
}

export function disableTrigger(): any { return setEnabled(false); }

/** Transmits the key to this script once through the authenticated execution API. */
export function configure(apiKey: string): any {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096) {
    throw new Error('A nonempty TypeSafe API key is required');
  }
  const candidate = apiKey.trim();
  try { verifyModel(candidate); }
  catch (error) { throw new Error('TypeSafe key verification failed: ' + errorText(error)); }
  props().setProperty('TYPESAFE_API_KEY', candidate);
  return { apiKeyConfigured: true, modelVerified: true };
}

function baseSetup(): any {
  const cfg = config();
  const installedInterval = Number(props().getProperty(PREFIX + 'INTERVAL'));
  const actualIntervalMinutes = [1, 5, 10, 15, 30].includes(installedInterval) ? installedInterval : null;
  const triggerCount = ownedTriggers().length;
  let accountEmail = '';
  try { accountEmail = Session.getEffectiveUser().getEmail() || ''; } catch { /* scope may hide email */ }
  return {
    configVersion: cfg.version,
    apiKeyConfigured: Boolean(props().getProperty('TYPESAFE_API_KEY')),
    triggerCount,
    actualIntervalMinutes,
    desiredIntervalMinutes: cfg.runtime.intervalMinutes,
    triggerIntervalMatches: triggerCount === 1 && actualIntervalMinutes === cfg.runtime.intervalMinutes,
    enabled: props().getProperty(PREFIX + 'ENABLED') === 'true',
    accountEmail,
  };
}

function verifyModel(apiKey: string): void {
  infer({ sender: 'check@example.com', recipient: 'owner@example.com', direction: 'inbound',
    subject: 'Jev-Mail connection check', snippet: 'This is a synthetic connection check.' },
  config(), apiKey);
}

/** Verify the saved key and model with synthetic content; no Gmail access. */
export function verifySetup(): any {
  const base = baseSetup();
  if (!base.apiKeyConfigured) return { ...base, modelVerified: false,
    modelError: 'TypeSafe API key is not configured' };
  try {
    verifyModel(props().getProperty('TYPESAFE_API_KEY'));
    return { ...base, modelVerified: true };
  } catch (error) {
    return { ...base, modelVerified: false, modelError: errorText(error) };
  }
}

export function status(): any {
  const base = baseSetup();
  const last = props().getProperty(PREFIX + 'LAST_RUN');
  const count = receiptCount();
  return { ...base, lastRun: last ? JSON.parse(last) : null,
    receiptCount: count, receiptLimit: RECEIPT_LIMIT, receiptCapacityReached: count >= RECEIPT_LIMIT };
}

function receiptKey(thread: any): string { return RECEIPT_PREFIX + thread.getId(); }
function receiptCount(): number {
  return Object.keys(props().getProperties()).filter(key => key.startsWith(RECEIPT_PREFIX)).length;
}
function readReceipt(thread: any): any {
  const raw = props().getProperty(receiptKey(thread));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function writeReceipt(thread: any, receipt: any): void {
  const key = receiptKey(thread);
  if (!props().getProperty(key)) {
    const count = receiptCount();
    if (count >= RECEIPT_LIMIT) throw new Error('Jev-Mail receipt capacity reached; archive or review retained Inbox threads');
  }
  props().setProperty(key, output({ ...receipt, at: now() }));
}
function pruneReceipts(): void {
  const all = props().getProperties();
  const entries = Object.keys(all).filter(key => key.startsWith(RECEIPT_PREFIX));
  const timestamp = (key: string): number => {
    try { return Number(JSON.parse(all[key] || '{}').at || 0); } catch { return 0; }
  };
  const current = now();
  const fresh = entries.filter(key => {
    let receipt: any;
    try { receipt = JSON.parse(all[key]); } catch { props().deleteProperty(key); return false; }
    // Completed Inbox receipts are never age-evicted: doing so would make an
    // old Follow Up eligible for classification again under a newer policy.
    if (receipt.phase === 'done' || current - timestamp(key) <= RECEIPT_TTL_MS) return true;
    props().deleteProperty(key);
    return false;
  });
  if (fresh.length < RECEIPT_LIMIT - 100) return;
  fresh.sort();
  const offset = Number(props().getProperty(PREFIX + 'PRUNE_CURSOR') || 0) % fresh.length;
  for (let i = 0; i < Math.min(20, fresh.length); i++) {
    const key = fresh[(offset + i) % fresh.length];
    let receipt: any;
    try { receipt = JSON.parse(all[key]); } catch { continue; }
    if (receipt.phase !== 'done') continue;
    try {
      const thread = GmailApp.getThreadById(key.slice(RECEIPT_PREFIX.length));
      if (!thread || !thread.isInInbox()) props().deleteProperty(key);
    } catch { /* transient Gmail read failure must not erase a receipt */ }
  }
  props().setProperty(PREFIX + 'PRUNE_CURSOR', String((offset + 20) % fresh.length));
}

function latestInboxMessage(thread: any): any | null {
  const messages = thread.getMessages();
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isInInbox()) return messages[i];
  }
  return null;
}

function emailFrom(message: any, thread: any): any {
  const messages = thread.getMessages();
  const position = messages.findIndex((item: any) => item.getId() === message.getId());
  const snippet = message.getPlainBody().slice(0, 1000);
  return {
    id: message.getId(),
    threadId: thread.getId(),
    sender: message.getFrom(),
    recipient: message.getTo(),
    direction: 'inbound',
    subject: message.getSubject(),
    snippet,
    previousSnippet: snippet.length < 200 && position > 0
      ? messages[position - 1].getPlainBody().slice(0, 500) : undefined,
  };
}

function infer(email: any, cfg: any, apiKey: string): any {
  const response = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: output(buildPayload(email, cfg)),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('TypeSafe API HTTP ' + code);
  let parsed: any;
  try { parsed = JSON.parse(response.getContentText()); }
  catch { throw new Error('TypeSafe API returned invalid JSON'); }
  if (!parsed || !parsed.answers) throw new Error('TypeSafe API returned no answers');
  return decide(parsed.answers, cfg);
}

function labelFor(name: string): any {
  let label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

function hasLabel(thread: any, name: string): boolean {
  return thread.getLabels().some((label: any) => label.getName() === name);
}

function apply(thread: any, message: any, decision: any, cfg: any, prior: any): any {
  // A new reply, or a manual archive, invalidates a previously computed plan.
  thread.refresh();
  const current = latestInboxMessage(thread);
  if (!current || current.getId() !== message.getId()) return { phase: 'changed' };
  const inboxMessages = thread.getMessages().filter((item: any) => item.isInInbox());
  const needsReview = decision.shouldArchive && cfg.runtime.mode === 'archive' && inboxMessages.length > 1;
  const targetLabel = needsReview ? cfg.labels.review : decision.targetLabel;
  if (!hasLabel(thread, targetLabel)) thread.addLabel(labelFor(targetLabel));
  if (prior && prior.phase === 'done' && prior.targetLabel &&
      prior.targetLabel !== targetLabel && hasLabel(thread, prior.targetLabel)) {
    thread.removeLabel(labelFor(prior.targetLabel));
  }
  if (!needsReview && decision.shouldStar && !current.isStarred()) current.star();
  if (!needsReview && decision.shouldArchive && cfg.runtime.mode === 'archive') {
    thread.refresh();
    const beforeArchive = latestInboxMessage(thread);
    if (!beforeArchive || beforeArchive.getId() !== message.getId()) return { phase: 'changed' };
    // GmailApp archive is thread-wide. Leave mixed old/new inbox threads for
    // review instead of archiving messages the model has not evaluated.
    const currentInbox = thread.getMessages().filter((item: any) => item.isInInbox());
    if (currentInbox.length === 1) thread.moveToArchive();
    else return { phase: 'changed' };
  }
  return { phase: 'done', targetLabel };
}

function run(preview: boolean, limit?: number): any {
  const cfg = config();
  const runtime = cfg.runtime;
  const policy = policyFingerprint(cfg);
  const apiKey = props().getProperty('TYPESAFE_API_KEY');
  if (!apiKey) throw new Error('TypeSafe API key is not configured');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: 'another run is active' };
  const started = now();
  const maxScan = Math.max(1, Math.min(500, runtime.maxScan));
  const maxItems = Math.max(1, Math.min(50, limit || runtime.batchSize));
  let cursor = preview ? 0 : Number(props().getProperty(PREFIX + 'CURSOR') || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  const results: any[] = [];
  let scanned = 0;
  let failures = 0;
  let exhausted = false;
  try {
    if (!preview) pruneReceipts();
    while (scanned < maxScan && results.length < maxItems && now() - started < runtime.maxRuntimeSeconds * 1000) {
      let threads = GmailApp.search('in:inbox', cursor, Math.min(20, maxScan - scanned));
      if (!threads.length && cursor > 0) {
        cursor = 0;
        threads = GmailApp.search('in:inbox', 0, Math.min(20, maxScan - scanned));
      }
      if (!threads.length) { exhausted = true; break; }
      for (const thread of threads) {
        if (scanned >= maxScan || results.length >= maxItems ||
            now() - started >= runtime.maxRuntimeSeconds * 1000) break;
        scanned++;
        cursor++;
        let message: any = null;
        let old: any = null;
        let email: any = null;
        try {
          message = latestInboxMessage(thread);
          if (!message) continue;
          old = readReceipt(thread);
          if (old && old.messageId === message.getId() && old.phase === 'done') continue;
          if (old && old.messageId === message.getId() && old.policy === policy &&
              old.retryAt > now()) continue;
          email = emailFrom(message, thread);
          if (!preview && !old && receiptCount() >= RECEIPT_LIMIT) {
            throw new Error('Jev-Mail receipt capacity reached; archive or review retained Inbox threads');
          }
          const decision = !preview && old && old.messageId === message.getId() &&
            old.phase === 'pending' && old.policy === policy
            ? old.decision : infer(email, cfg, apiKey);
          const needsReview = decision.shouldArchive && runtime.mode === 'archive' &&
            thread.getMessages().filter((item: any) => item.isInInbox()).length > 1;
          const result: any = { messageId: email.id, threadId: email.threadId, subject: email.subject,
            targetLabel: needsReview ? cfg.labels.review : decision.targetLabel,
            shouldStar: needsReview ? false : decision.shouldStar,
            shouldArchive: Boolean(!needsReview && decision.shouldArchive && runtime.mode === 'archive') };
          if (!preview) {
            writeReceipt(thread, { messageId: email.id, phase: 'pending', decision,
              policy, attempts: old && old.messageId === email.id ? old.attempts || 0 : 0 });
            const applied = apply(thread, message, decision, cfg, old);
            if (applied.phase === 'done') writeReceipt(thread, { messageId: email.id, phase: 'done',
              targetLabel: applied.targetLabel });
            result.status = applied.phase;
            if (applied.targetLabel && applied.targetLabel !== decision.targetLabel) {
              result.targetLabel = applied.targetLabel;
              result.shouldArchive = false;
            }
          }
          results.push(result);
        } catch (error) {
          failures++;
          if (!preview && email) {
            try {
              const attempts = old && old.messageId === email.id ? Math.min(10, (old.attempts || 0) + 1) : 1;
              const pending = readReceipt(thread);
              writeReceipt(thread, {
                messageId: email.id,
                phase: pending && pending.messageId === email.id && pending.phase === 'pending' ? 'pending' : 'failed',
                decision: pending && pending.messageId === email.id ? pending.decision : undefined,
                policy,
                attempts,
                retryAt: now() + Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** (attempts - 1))),
              });
            } catch { /* full receipt storage: fail closed, preserve Gmail */ }
          }
          Logger.log('[Jev-Mail] processing error: ' + errorText(error));
          results.push({ messageId: email?.id || message?.getId?.() || null,
            status: 'error', error: errorText(error) });
        }
        if (scanned >= maxScan || results.length >= maxItems || now() - started >= runtime.maxRuntimeSeconds * 1000) break;
      }
      if (threads.length < Math.min(20, maxScan - scanned)) { exhausted = true; break; }
    }
    if (!preview) {
      props().setProperty(PREFIX + 'CURSOR', String(exhausted ? 0 : cursor));
      props().setProperty(PREFIX + 'LAST_RUN', output({ at: new Date().toISOString(), scanned,
        handled: results.length - failures, failures }));
      pruneReceipts();
    }
    return { preview, scanned, cursor: exhausted ? 0 : cursor, results, failures };
  } finally { lock.releaseLock(); }
}

export function autoTriageInbox(): any {
  if (props().getProperty(PREFIX + 'ENABLED') !== 'true') return { skipped: 'disabled' };
  if (!baseSetup().triggerIntervalMatches) {
    props().setProperty(PREFIX + 'ENABLED', 'false');
    return { skipped: 'trigger interval mismatch', enabled: false };
  }
  return run(false);
}

export function previewInbox(limit?: number): any {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
    throw new Error('Preview limit must be between 1 and 20');
  }
  return run(true, limit);
}
