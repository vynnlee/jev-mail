/** Live model evaluation over synthetic fixtures; never touches Gmail. */
import fs from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { buildPayload, decide } from './core/index.js';
import { DEFAULT_CONFIG } from './configuration/index.js';
try { loadEnvFile(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error('Set TYPESAFE_API_KEY in your environment or gitignored .env to run live synthetic evaluation.'); process.exit(3); }
const fixtures = JSON.parse(await fs.readFile(new URL('../examples/mock-emails.json', import.meta.url), 'utf8'));
const config = structuredClone(DEFAULT_CONFIG);
config.runtime.mode = 'archive';
let passed = 0;
for (const fixture of fixtures) {
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(fixture, config)), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
    const data = await response.json() as any;
    const result = decide(data.answers, config);
    const ok = result.targetLabel === fixture.expected.label && result.shouldStar === fixture.expected.shouldStar && result.shouldArchive === fixture.expected.shouldArchive;
    if (ok) passed++;
    console.log(JSON.stringify({ id: fixture.id, passed: ok, expected: fixture.expected, result }));
  } catch (error) {
    console.error(JSON.stringify({ id: fixture.id, passed: false, error: 'Model request failed; check credentials and connectivity.' }));
  }
}
console.log(JSON.stringify({ passed, total: fixtures.length, scope: 'synthetic fixtures; not production accuracy' }));
if (passed !== fixtures.length) process.exitCode = 1;
