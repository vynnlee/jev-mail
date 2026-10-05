/** Live model evaluation over synthetic fixtures; never touches Gmail. */
import fs from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { buildModelRequest, decide, parseModelResponse, providerName, usesTypeSafe } from './core/index.js';
import { DEFAULT_CONFIG, parseConfigYaml } from './configuration/index.js';
try { loadEnvFile(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
const config = structuredClone(DEFAULT_CONFIG);
config.runtime.mode = 'archive';
// Optional YAML selects the model and provider; fixtures keep the default taxonomy.
if (process.env.JEV_MAIL_CONFIG) {
  const custom = parseConfigYaml(await fs.readFile(process.env.JEV_MAIL_CONFIG, 'utf8'));
  config.model = custom.model;
  if (custom.provider) config.provider = custom.provider;
}
const key = process.env.JEV_MAIL_API_KEY || (usesTypeSafe(config) ? process.env.TYPESAFE_API_KEY : undefined);
if (!key) { console.error('Set JEV_MAIL_API_KEY (or TYPESAFE_API_KEY for TypeSafe) in your environment or gitignored .env to run live synthetic evaluation.'); process.exit(3); }
const fixtures = JSON.parse(await fs.readFile(new URL('../examples/mock-emails.json', import.meta.url), 'utf8'));
let passed = 0;
let labelMatches = 0, archiveMatches = 0, starMatches = 0, safeAbstentions = 0, unexpectedArchives = 0, requestFailures = 0;
for (const fixture of fixtures) {
  try {
    const request = buildModelRequest(fixture, config, key);
    const response = await fetch(request.url, {
      method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`${providerName(config)} HTTP ${response.status}`);
    const result = decide(parseModelResponse(await response.json(), config), config);
    const ok = result.targetLabel === fixture.expected.label && result.shouldStar === fixture.expected.shouldStar && result.shouldArchive === fixture.expected.shouldArchive;
    if (ok) passed++;
    if (result.targetLabel === fixture.expected.label) labelMatches++;
    if (result.shouldArchive === fixture.expected.shouldArchive) archiveMatches++;
    if (result.shouldStar === fixture.expected.shouldStar) starMatches++;
    if (result.targetLabel === config.labels.review && fixture.expected.label !== config.labels.review) safeAbstentions++;
    if (result.shouldArchive && !fixture.expected.shouldArchive) unexpectedArchives++;
    console.log(JSON.stringify({ id: fixture.id, passed: ok, expected: fixture.expected, result }));
  } catch (error) {
    requestFailures++;
    console.error(JSON.stringify({ id: fixture.id, passed: false, error: 'Model request failed; check credentials and connectivity.' }));
  }
}
console.log(JSON.stringify({ passed, total: fixtures.length, labelMatches, archiveMatches, starMatches, safeAbstentions, unexpectedArchives, requestFailures, scope: 'synthetic fixtures; not production accuracy' }));
if (passed !== fixtures.length) process.exitCode = 1;
