import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { buildJevPayload, evaluateTriageDecision } from './triage.js';
import type { EmailItem } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runSimulation() {
  console.log('\n=============================================================');
  console.log('📬 Jev-Mail: System One Zero-Inbox Simulator');
  console.log('=============================================================\n');

  const apiKey =
    process.env.TYPESAFE_API_KEY ||
    'apikey_28229b69671a9ad416c8589107adc6cc11c_bf2eb54381f6d44ab80719c29f9febe4accb07509f57fb32473aabb40319fb41';

  const mockPath = resolve(__dirname, '../examples/mock-emails.json');
  const mockData: (EmailItem & { expected: { label: string; shouldStar: boolean; shouldArchive: boolean } })[] =
    JSON.parse(readFileSync(mockPath, 'utf-8'));

  console.log(`Loaded ${mockData.length} mock email scenarios.\nEvaluating with Jev (${CONFIG.typesafe.model})...\n`);

  const results = [];

  for (const item of mockData) {
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
        star: decision.shouldStar ? '⭐ YES' : '  NO ',
        archive: decision.shouldArchive ? '📥 YES' : '  NO ',
        latency: `${elapsed}ms`,
        status: isPassed ? '✅ PASS' : '⚠️ CHECK',
      });
    } catch (err: any) {
      results.push({
        id: item.id,
        subject: item.subject.substring(0, 30),
        label: 'ERROR',
        star: 'N/A',
        archive: 'N/A',
        latency: 'FAIL',
        status: `❌ ${err.message}`,
      });
    }
  }

  console.table(results);
  console.log('\nSimulation complete! All decisions verified against MECE matrix.\n');
}

runSimulation().catch(console.error);
