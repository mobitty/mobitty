#!/usr/bin/env node

// mobitty-editor — remote editor bin entry.
// Invoked as $EDITOR/$VISUAL by programs inside a mobitty PTY session.
// Sends the file content to the mobitty server, blocks until the user
// finishes editing in the browser, then writes the result back.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';

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
let content = '';
if (existsSync(filePath)) {
  content = readFileSync(filePath, 'utf-8');
}

const postData = JSON.stringify({ filePath, content });

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
      if (!resultCancelled) {
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
