#!/usr/bin/env node
/**
 * Metro (RN 0.66) uses OpenSSL MD4 hashing that Node 17+ rejects.
 * Apply --openssl-legacy-provider only when needed.
 */
const {spawn} = require('child_process');

const major = Number(process.versions.node.split('.')[0]);
const env = {...process.env};

if (major >= 17) {
  const existing = env.NODE_OPTIONS || '';
  if (!existing.includes('--openssl-legacy-provider')) {
    env.NODE_OPTIONS = `${existing} --openssl-legacy-provider`.trim();
  }
}

const child = spawn('react-native', ['start', ...process.argv.slice(2)], {stdio: 'inherit', env, shell: true});

child.on('exit', code => process.exit(code == null ? 1 : code));
