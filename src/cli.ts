import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { buildJevPayload, evaluateTriageDecision } from './triage.js';
import type { EmailItem } from './types.js';

interface MockItem extends EmailItem {
  expected: {
    label: string;
    shouldStar: boolean;
    shouldArchive: boolean;
  };
}

async function runSimulation() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error('Error: TYPESAFE_API_KEY environment variable is required.');
    process.exit(1);
  }

  const mockPath = path.resolve('examples/mock-emails.json');
  const rawData = fs.readFileSync(mockPath, 'utf-8');
  const mockEmails: MockItem[] = JSON.parse(rawData);

  console.log('\n=============================================================');
  console.log('Jev-Mail: System One Zero-Inbox Simulator');
  console.log('=============================================================\n');
  console.log(`Loaded ${mockEmails.length} mock email scenarios.`);
  console.log(`Evaluating with Jev (${CONFIG.typesafe.model})...\n`);

  const results: any[] = [];

  for (const item of mockEmails) {
    const payload = buildJevPayload(item);
    const startTime = Date.now();

    try {
      const response = await fetch(CONFIG.typesafe.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const elapsed = Date.now() - startTime;
      const json: any = await response.json();

      if (!json.answers) {
        throw new Error(JSON.stringify(json));
      }

      const decision = evaluateTriageDecision(item, json.answers);
      const matchLabel = decision.targetLabel === item.expected.label;
      const matchStar = decision.shouldStar === item.expected.shouldStar;
      const matchArchive = decision.shouldArchive === item.expected.shouldArchive;
      const isPassed = matchLabel && matchStar && matchArchive;

      results.push({
        id: item.id,
        subject: item.subject.length > 35 ? item.subject.substring(0, 32) + '...' : item.subject,
        label: decision.targetLabel,
        star: decision.shouldStar ? 'YES' : 'NO',
        archive: decision.shouldArchive ? 'YES' : 'NO',
        latency: `${elapsed}ms`,
        status: isPassed ? 'PASS' : 'CHECK',
      });
    } catch (err: any) {
      results.push({
        id: item.id,
        subject: item.subject.substring(0, 30),
        label: 'ERROR',
        star: 'N/A',
        archive: 'N/A',
        latency: 'FAIL',
        status: `FAIL: ${err.message}`,
      });
    }
  }

  console.table(results);
  console.log('\nSimulation complete. All decisions verified against taxonomy.\n');
}

runSimulation().catch(console.error);
