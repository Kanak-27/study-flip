#!/usr/bin/env node
// Runs the API and the background worker together, so starting the backend is
// one command instead of two terminals.
//
//   npm run dev     -> api + worker, both with --watch
//   npm start       -> api + worker, no watch (production-ish)
//   npm run dev:api -> api only (when you really want just one)
//
// Why they were separate: the worker is a long-running poller, not part of the
// request path. Keeping it a distinct process means it can be scaled, stopped
// or restarted independently of the API (and a crash in one isn't a crash in
// the other). For local development that separation is more ceremony than it's
// worth, so this launcher supervises both — kill this and both go down together.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = !process.argv.includes('--no-watch');

const targets = [
  { name: 'api', script: 'src/server.js' },
  { name: 'worker', script: 'src/worker.js' },
];

const children = new Map();
let shuttingDown = false;

function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // On Windows SIGTERM is a hard TerminateProcess, which would orphan the
    // grandchild that `--watch` spawned; taskkill /T takes the whole tree.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  for (const child of children.values()) killChild(child);
  // Don't let a wedged child keep the console hostage.
  setTimeout(() => process.exit(code), 5000).unref();
}

function start({ name, script }) {
  const args = watch ? ['--watch', script] : [script];
  const child = spawn(process.execPath, args, {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
  children.set(name, child);

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) {
      // last one out turns off the lights (natural exit, keeps exitCode)
      if (children.size === 0) process.exit(process.exitCode ?? 0);
      return;
    }
    console.error(`[with-worker] ${name} exited (${signal ?? code}) — stopping the backend.`);
    shutdown(code ?? 1);
  });

  child.on('error', (err) => {
    console.error(`[with-worker] failed to start ${name}: ${err.message}`);
    shutdown(1);
  });
}

for (const target of targets) start(target);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}
