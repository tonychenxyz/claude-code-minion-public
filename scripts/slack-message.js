#!/usr/bin/env node

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  node scripts/slack-message.js regular "message" [--thread-ts TS]
  node scripts/slack-message.js mention "message" [--thread-ts TS]
  node scripts/slack-message.js upload /absolute/path/to/file [--thread-ts TS]

Requires CHANNEL_ID in the environment. ORCHESTRATOR_URL defaults to http://localhost:3000.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = [...argv];
  const mode = args.shift();
  if (!mode || mode === '-h' || mode === '--help') usage(mode ? 0 : 1);

  let threadTs;
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--thread-ts') {
      threadTs = args[++i];
      if (!threadTs) usage();
    } else {
      values.push(arg);
    }
  }

  return { mode, value: values.join(' '), threadTs };
}

function postToOrchestrator(payload) {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
  const channelId = process.env.CHANNEL_ID;
  if (!channelId) {
    throw new Error('CHANNEL_ID is not set. This script must run inside a minion channel terminal.');
  }

  const url = new URL(orchestratorUrl);
  const postData = JSON.stringify({ ...payload, channelId });
  const options = {
    hostname: url.hostname,
    port: url.port || 3000,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const { mode, value, threadTs } = parseArgs(process.argv.slice(2));
  if (!value) usage();

  let payload;
  if (mode === 'regular') {
    payload = {
      type: 'markdown',
      content: value,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
  } else if (mode === 'mention') {
    payload = {
      type: 'mention',
      mentionUser: true,
      mentionText: value,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
  } else if (mode === 'upload') {
    if (!path.isAbsolute(value)) {
      throw new Error('upload requires an absolute file path');
    }
    if (!fs.existsSync(value)) {
      throw new Error(`file not found: ${value}`);
    }
    const filename = path.basename(value);
    payload = {
      type: 'file_upload',
      filename,
      title: filename,
      base64Content: fs.readFileSync(value).toString('base64'),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
  } else {
    usage();
  }

  const response = await postToOrchestrator(payload);
  console.log(response || 'Message sent');
}

main().catch((err) => {
  console.error(`slack-message failed: ${err.message}`);
  process.exit(1);
});
