#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

function printUsage() {
  console.error('Usage: node cli.js <youtube-url-or-id> [--lang <code>] [--pretty] [--out <file>]');
  console.error('Example: node cli.js "https://www.youtube.com/watch?v=4uzGDAoNOZc&t=1s" --pretty');
}

let YoutubeTranscript;
try {
  ({ YoutubeTranscript } = require('./dist/youtube-transcript.common.js'));
} catch (error) {
  console.error('Failed to load local build from ./dist/youtube-transcript.common.js');
  console.error('Run `npm run build` first.');
  process.exit(1);
}

const args = process.argv.slice(2);
let input;
let lang;
let pretty = false;
let outFile;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--lang') {
    lang = args[i + 1];
    i++;
    continue;
  }

  if (arg === '--pretty') {
    pretty = true;
    continue;
  }

  if (arg === '--out') {
    outFile = args[i + 1];
    i++;
    continue;
  }

  if (!input) {
    input = arg;
    continue;
  }

  console.error(`Unknown argument: ${arg}`);
  printUsage();
  process.exit(1);
}

if (!input) {
  printUsage();
  process.exit(1);
}

if (args.includes('--lang') && !lang) {
  console.error('Missing value for --lang');
  process.exit(1);
}

if (args.includes('--out') && !outFile) {
  console.error('Missing value for --out');
  process.exit(1);
}

const config = lang ? { lang } : undefined;

YoutubeTranscript.fetchTranscript(input, config)
  .then((transcript) => {
    const serialized = pretty
      ? JSON.stringify(transcript, null, 2)
      : JSON.stringify(transcript);

    if (outFile) {
      const outputPath = path.resolve(process.cwd(), outFile);
      fs.writeFileSync(outputPath, `${serialized}\n`, 'utf8');
      console.error(`Saved transcript to ${outputPath}`);
      return;
    }

    process.stdout.write(`${serialized}\n`);
  })
  .catch((error) => {
    console.error(error?.message ?? String(error));
    process.exit(1);
  });
