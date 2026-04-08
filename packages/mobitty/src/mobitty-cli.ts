#!/usr/bin/env node

// mobitty-cli — unified CLI for mobitty PTY sessions.
//
// Subcommands:
//   edit <path>      Open file in browser editor (used as $EDITOR/$VISUAL)
//   view <path>      View image in browser (read-only)
//   download <path>  Download file to browser

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve, extname, basename } from 'node:path';

// ── Shared infrastructure ────────────────────────────────────────────────────

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

function fail(msg: string): never {
  process.stderr.write(`mobitty-cli: ${msg}\n`);
  process.exit(1);
}

const sessionId = process.env['MOBITTY_SESSION_ID'];
const port = process.env['MOBITTY_CLI_PORT'];
const host = process.env['MOBITTY_CLI_HOST'] ?? '127.0.0.1';
const useTls = process.env['MOBITTY_CLI_TLS'] === '1';

interface HttpResult {
  status: number;
  body: string;
}

function httpPost(path: string, jsonBody: string): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const request = useTls ? httpsRequest : httpRequest;
    const req = request(
      {
        hostname: host,
        port: parseInt(port!, 10),
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

// ── Subcommand dispatch ──────────────────────────────────────────────────────

const subcommand = process.argv[2] ?? '';
const rawPath = process.argv[3];
if (!subcommand || !rawPath) {
  fail('usage: mobitty-cli <edit|view|download> <path>');
}
const filePath = resolve(rawPath);

if (!sessionId || !port) {
  fail('missing MOBITTY_SESSION_ID or MOBITTY_CLI_PORT');
}

// ── edit ──────────────────────────────────────────────────────────────────────

async function cmdEdit(): Promise<void> {
  const imageContentType = IMAGE_EXTENSIONS[extname(filePath).toLowerCase()];

  let content: string;
  if (imageContentType) {
    if (!existsSync(filePath)) fail('file not found');
    content = readFileSync(filePath).toString('base64');
  } else {
    content = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  }

  const postBody: Record<string, string> = { filePath, content };
  if (imageContentType) postBody['contentType'] = imageContentType;

  const result = await httpPost(
    `/api/sessions/${encodeURIComponent(sessionId!)}/editor`,
    JSON.stringify(postBody),
  );

  if (result.status !== 200) fail(`server error ${result.status}: ${result.body}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    fail('invalid response from server');
  }
  if (typeof parsed !== 'object' || parsed === null) fail('unexpected response format');
  const record = parsed as Record<string, unknown>;
  const resultContent = record['content'];
  const resultCancelled = record['cancelled'];
  if (typeof resultContent !== 'string' || typeof resultCancelled !== 'boolean') {
    fail('missing content or cancelled in response');
  }
  if (!resultCancelled && !imageContentType) {
    writeFileSync(filePath, resultContent);
  }
}

// ── view ─────────────────────────────────────────────────────────────────────

async function cmdView(): Promise<void> {
  if (!existsSync(filePath)) fail('file not found');
  const ext = extname(filePath).toLowerCase();
  const contentType = IMAGE_EXTENSIONS[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath).toString('base64');

  const result = await httpPost(
    `/api/sessions/${encodeURIComponent(sessionId!)}/editor`,
    JSON.stringify({ filePath, content, contentType }),
  );

  if (result.status !== 200) fail(`server error ${result.status}: ${result.body}`);
  // View is read-only — never write back
}

// ── download ─────────────────────────────────────────────────────────────────

async function cmdDownload(): Promise<void> {
  if (!existsSync(filePath)) fail(`file not found: ${filePath}`);
  const st = statSync(filePath);
  if (!st.isFile()) fail(`not a regular file: ${filePath}`);

  const result = await httpPost(
    `/api/sessions/${encodeURIComponent(sessionId!)}/download`,
    JSON.stringify({ filePath }),
  );

  if (result.status !== 200) fail(`server error ${result.status}: ${result.body}`);
  process.stderr.write(`download: ${basename(filePath)}\n`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  switch (subcommand) {
    case 'edit':
      await cmdEdit();
      break;
    case 'view':
      await cmdView();
      break;
    case 'download':
      await cmdDownload();
      break;
    default:
      fail(`unknown subcommand: ${subcommand}\nusage: mobitty-cli <edit|view|download> <path>`);
  }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  fail(`connection error: ${msg}`);
});
