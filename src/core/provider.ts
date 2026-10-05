import type { JevMailConfig, ProviderType } from '../configuration/index.js';
import { buildPayload, type EmailInput, type JevAnswers } from './index.js';

export const SYSTEM_ONE_BASE_URL = 'https://api.typesafe.ai/v1';
export const TYPESAFE_ENDPOINT = SYSTEM_ONE_BASE_URL + '/systemone';

/** Transport-neutral HTTP request so GAS (UrlFetchApp) and Node (fetch) share one adapter. */
export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function providerType(config: JevMailConfig): ProviderType {
  return config.provider?.type ?? 'system-one';
}

/** True only for System One served by TypeSafe itself, where TYPESAFE_API_KEY belongs. */
export function usesTypeSafe(config: JevMailConfig): boolean {
  return providerType(config) === 'system-one' && (config.provider?.baseUrl ?? SYSTEM_ONE_BASE_URL) === SYSTEM_ONE_BASE_URL;
}

export function providerName(config: JevMailConfig): string {
  return usesTypeSafe(config) ? 'TypeSafe' : 'System One';
}

/** Script Property holding the key. System One keeps the historical name so existing installs continue to work. */
export function apiKeyProperty(_config: JevMailConfig): string {
  return 'TYPESAFE_API_KEY';
}

export function buildModelRequest(email: EmailInput, config: JevMailConfig, apiKey: string): ModelRequest {
  const auth = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  return {
    url: (config.provider?.baseUrl ?? SYSTEM_ONE_BASE_URL) + '/systemone',
    headers: { ...config.provider?.headers, ...auth },
    body: JSON.stringify(buildPayload(email, config)),
  };
}

/** Normalize a provider response body into Jev answers for decide(). */
export function parseModelResponse(body: unknown, config: JevMailConfig): JevAnswers {
  const name = providerName(config);
  if (!body || typeof body !== 'object') throw new Error(`${name} API returned invalid JSON`);
  const answers = (body as any).answers;
  if (!answers) throw new Error(`${name} API returned no answers`);
  return answers;
}
