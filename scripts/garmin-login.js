#!/usr/bin/env node
'use strict';
/**
 * Signs in to Garmin from your own computer and prints the login tokens.
 * Use this when the dashboard's "Sign in to Garmin" is refused (Garmin often
 * blocks sign-ins that come from cloud servers).
 *
 *   cd functions && npm install && cd ..
 *   node scripts/garmin-login.js
 *
 * Paste the printed line into Settings > Garmin > "Garmin refuses the sign-in?".
 * The tokens are as sensitive as your password: do not share or commit them.
 * Garmin accounts with two-step verification are not supported by this library.
 */
const path = require('node:path');
const readline = require('node:readline');
const { GarminConnect } = require(path.join(__dirname, '..', 'functions', 'node_modules', 'garmin-connect'));

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stderr.write('\n'); resolve(a.trim()); }));
}

(async () => {
  const email = await ask('Garmin email: ');
  const password = await ask('Garmin password (not shown): ', true);
  const gc = new GarminConnect({ username: email, password });
  try {
    await gc.login();
  } catch (e) {
    console.error(`\nGarmin refused the sign-in: ${e.message}`);
    process.exit(1);
  }
  const { oauth1, oauth2 } = gc.exportToken();
  console.error('\nSigned in. Copy the single line below into the dashboard:\n');
  console.log(JSON.stringify({ oauth1, oauth2 }));
})();
