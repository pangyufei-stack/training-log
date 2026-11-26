#!/usr/bin/env node
'use strict';
// Entry point for the scheduled GitHub Actions job:  node run.js [--days N]
const i = process.argv.indexOf('--days');
const raw = i > -1 ? process.argv[i + 1] : process.env.DAYS;
const days = Math.min(365, Math.max(1, parseInt(raw, 10) || 4));

require('./src/sync')
  .runSync({ days })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    const failed = Object.entries(result.sources).filter(([, s]) => ['error', 'needs_login', 'skipped'].includes(s.status));
    // Fail the run (GitHub then emails the owner) only if every connected source failed.
    const connected = Object.values(result.sources).filter((s) => s.status !== 'not_connected');
    if (connected.length && failed.length === connected.length) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
