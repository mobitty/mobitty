// Shared infrastructure for mobitty CLI bins (mobitty-cli, mobitty-cli-edit).
//
// This module performs no top-level work — it only exports helpers and the
// per-action implementations. Each bin entry parses its own argv and invokes
// the appropriate run* function.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, basename } from 'node:path';

export const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export function fail(prefix: string, msg: string): never {
  process.stderr.write(`${prefix}: ${msg}\n`);
  process.exit(1);
}

export interface CliEnv {
  sessionId: string;
  port: number;
  host: string;
  useTls: boolean;
}

export function readCliEnv(prefix: string): CliEnv {
  const sessionId = process.env['MOBITTY_SESSION_ID'];
  const port = process.env['MOBITTY_CLI_PORT'];
  if (!sessionId || !port) {
    fail(prefix, 'missing MOBITTY_SESSION_ID or MOBITTY_CLI_PORT');
  }
  return {
    sessionId,
    port: parseInt(port, 10),
    host: process.env['MOBITTY_CLI_HOST'] ?? '127.0.0.1',
    useTls: process.env['MOBITTY_CLI_TLS'] === '1',
  };
}

interface HttpResult {
  status: number;
  body: string;
}

function httpPost(env: CliEnv, path: string, jsonBody: string): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const request = env.useTls ? httpsRequest : httpRequest;
    const req = request(
      {
        hostname: env.host,
        port: env.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
        },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') });
        });
      },
    );
    req.on('error', (err) => reject(err));
    req.write(jsonBody);
    req.end();
  });
}

export async function runEdit(env: CliEnv, prefix: string, filePath: string): Promise<void> {
  const imageContentType = IMAGE_EXTENSIONS[extname(filePath).toLowerCase()];

  let content: string;
  if (imageContentType) {
    if (!existsSync(filePath)) fail(prefix, 'file not found');
    content = readFileSync(filePath).toString('base64');
  } else {
    content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  }

  const postBody: Record<string, string> = { filePath, content };
  if (imageContentType) postBody['contentType'] = imageContentType;

  const result = await httpPost(
    env,
    `/api/sessions/${encodeURIComponent(env.sessionId)}/editor`,
    JSON.stringify(postBody),
  );

  if (result.status !== 200) fail(prefix, `server error ${result.status}: ${result.body}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    fail(prefix, 'invalid response from server');
  }
  if (typeof parsed !== 'object' || parsed === null) fail(prefix, 'unexpected response format');
  const record = parsed as Record<string, unknown>;
  const resultContent = record['content'];
  const resultCancelled = record['cancelled'];
  if (typeof resultContent !== 'string' || typeof resultCancelled !== 'boolean') {
    fail(prefix, 'missing content or cancelled in response');
  }
  if (!resultCancelled && !imageContentType) {
    writeFileSync(filePath, resultContent);
  }
}

export async function runView(env: CliEnv, prefix: string, filePath: string): Promise<void> {
  if (!existsSync(filePath)) fail(prefix, 'file not found');
  const ext = extname(filePath).toLowerCase();
  const contentType = IMAGE_EXTENSIONS[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath).toString('base64');

  const result = await httpPost(
    env,
    `/api/sessions/${encodeURIComponent(env.sessionId)}/editor`,
    JSON.stringify({ filePath, content, contentType }),
  );

  if (result.status !== 200) fail(prefix, `server error ${result.status}: ${result.body}`);
  // View is read-only — never write back
}

export async function runDownload(env: CliEnv, prefix: string, filePath: string): Promise<void> {
  if (!existsSync(filePath)) fail(prefix, `file not found: ${filePath}`);
  const st = statSync(filePath);
  if (!st.isFile()) fail(prefix, `not a regular file: ${filePath}`);

  const result = await httpPost(
    env,
    `/api/sessions/${encodeURIComponent(env.sessionId)}/download`,
    JSON.stringify({ filePath }),
  );

  if (result.status !== 200) fail(prefix, `server error ${result.status}: ${result.body}`);
  process.stderr.write(`download: ${basename(filePath)}\n`);
}
