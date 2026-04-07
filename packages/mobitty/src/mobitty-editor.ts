#!/usr/bin/env node

// mobitty-editor — remote editor bin entry.
// Invoked as $EDITOR/$VISUAL by programs inside a mobitty PTY session.
// Sends the file content to the mobitty server, blocks until the user
// finishes editing in the browser, then writes the result back.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve, extname } from 'node:path';

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
  process.stderr.write(`mobitty-editor: ${msg}\n`);
  process.exit(1);
}

const sessionId = process.env['MOBITTY_SESSION_ID'];
const port = process.env['MOBITTY_EDITOR_PORT'];
const host = process.env['MOBITTY_EDITOR_HOST'] ?? '127.0.0.1';
const useTls = process.env['MOBITTY_EDITOR_TLS'] === '1';
const rawPath = process.argv[2];

if (!sessionId || !port || !rawPath) {
  fail('missing MOBITTY_SESSION_ID, MOBITTY_EDITOR_PORT, or file argument');
}

const filePath = resolve(rawPath);
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
const postData = JSON.stringify(postBody);

const request = useTls ? httpsRequest : httpRequest;
const req = request(
  {
    hostname: host,
    port: parseInt(port, 10),
    path: `/api/sessions/${encodeURIComponent(sessionId)}/editor`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    rejectUnauthorized: false,
  },
  (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (res.statusCode !== 200) {
        fail(`server error ${res.statusCode}: ${body}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        fail('invalid response from server');
      }
      if (typeof parsed !== 'object' || parsed === null) {
        fail('unexpected response format');
      }
      const record = parsed as Record<string, unknown>;
      const resultContent = record['content'];
      const resultCancelled = record['cancelled'];
      if (typeof resultContent !== 'string' || typeof resultCancelled !== 'boolean') {
        fail('missing content or cancelled in response');
      }
      if (!resultCancelled && !imageContentType) {
        writeFileSync(filePath, resultContent);
      }
      process.exit(0);
    });
  },
);

req.on('error', (err) => {
  fail(`connection error: ${err.message}`);
});

req.write(postData);
req.end();
