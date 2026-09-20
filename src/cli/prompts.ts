import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

export async function ask(question: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive input unavailable. Supply the documented flags, or run in a terminal.');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { const answer = (await rl.question(`${question}${fallback !== undefined ? ` [${fallback}]` : ''}: `)).trim(); return answer || fallback || ''; }
  finally { rl.close(); }
}
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const answer = await ask(`${question} (${defaultYes ? 'Y/n' : 'y/N'})`, defaultYes ? 'y' : 'n');
  if (!/^(y|yes|n|no)$/i.test(answer)) throw new Error('Answer yes or no.');
  return /^y/i.test(answer);
}
export async function secret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Set TYPESAFE_API_KEY in the environment or enter it in an interactive terminal.');
  process.stderr.write(`${question}: `);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stderr.write('\n'); error ? reject(error) : resolve(value); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not open browser; use the printed URL.')));
  });
}
