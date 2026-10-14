#!/usr/bin/env node
// Idempotent in-repo patcher for dsh-orb@0.1.6 (installed under profiles/web/node_modules).
//
// Why a script instead of pnpm patchedDependencies: dsh-orb ships a bundled
// node_modules/ (koffi & co), so pnpm's text diff against its store copy is
// megabytes of unrelated platform noise and even corrupts binary assets.
// This patcher applies three string-level, verify-then-write edits instead:
//
//   1. dist/host/index.js — embeds the Fairy eye (fairy-visual's
//      .dsh-fairy-mark-eye CSS spec, see tools/assets/fairy-eye.png) as the
//      default ball avatar, materialized into helper assets on first use.
//   2. dist/host/index.js — the avatar route serves it as image/png.
//   3. client.js — the settings gallery gains a leading "Fairy" preset
//      (zh/en labels).
//
// Safe to run repeatedly (skips when already patched) and on machines
// without the package (exits quietly). Wired as profiles/web postinstall.
'use strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TARGET_ROOT = join(HERE, '..', 'profiles', 'web', 'node_modules', 'dsh-orb');
const PNG_PATH = join(HERE, 'assets', 'fairy-eye.png');

function applyEdit(label, filePath, oldText, newText) {
  if (!existsSync(filePath)) {
    console.log(`[patch-dsh-orb] skip (${label}): target missing`);
    return false;
  }
  const before = readFileSync(filePath, 'utf8');
  if (before.includes(newText)) {
    console.log(`[patch-dsh-orb] already patched (${label})`);
    return false;
  }
  const hits = before.split(oldText).length - 1;
  if (hits !== 1) {
    console.warn(`[patch-dsh-orb] ABORT (${label}): expected 1 match, found ${hits} — leaving the file untouched`);
    return false;
  }
  writeFileSync(filePath, before.replace(oldText, newText));
  console.log(`[patch-dsh-orb] patched (${label})`);
  return true;
}

const hostPath = join(TARGET_ROOT, 'dist', 'host', 'index.js');
const clientPath = join(TARGET_ROOT, 'client.js');
if (!existsSync(hostPath) && !existsSync(clientPath)) {
  console.log('[patch-dsh-orb] dsh-orb is not installed; nothing to do');
  process.exit(0);
}

const pngBase64 = readFileSync(PNG_PATH).toString('base64');

applyEdit(
  'host: default avatar -> Fairy eye',
  hostPath,
  'function defaultAvatarPath() {\n\treturn join(helperRoot(), "assets", "deepseek-avatar-square.gif");\n}',
  'const FAIRY_EYE_PNG_BASE64 = "' + pngBase64 + '";\n'
    + '/** Bundled default avatar: the Fairy eye, rendered offline from fairy-visual\'s\n'
    + ' * .dsh-fairy-mark-eye CSS spec (tools/assets/fairy-eye.png is the source of the\n'
    + ' * base64). Materialized into helper assets on first use. */\n'
    + 'function defaultAvatarPath() {\n'
    + '\tconst target = join(helperRoot(), "assets", "fairy-eye.png");\n'
    + '\tif (!existsSync(target)) {\n'
    + '\t\ttry {\n'
    + '\t\t\twriteFileSync(target, Buffer.from(FAIRY_EYE_PNG_BASE64, "base64"));\n'
    + '\t\t} catch {\n'
    + '\t\t}\n'
    + '\t}\n'
    + '\treturn target;\n'
    + '}',
);

applyEdit(
  'host: avatar route mime -> image/png',
  hostPath,
  'if (await sendFile(res, method, defaultAvatarPath(), "image/gif")) return;',
  'if (await sendFile(res, method, defaultAvatarPath(), "image/png")) return;',
);

applyEdit(
  'client: zh gallery gains Fairy',
  clientPath,
  "      avatarPresetNames: {\n        point: '指点',",
  "      avatarPresetNames: {\n        fairy: 'Fairy',\n        point: '指点',",
);

applyEdit(
  'client: en gallery gains Fairy',
  clientPath,
  "      avatarPresetNames: {\n        point: 'Point',",
  "      avatarPresetNames: {\n        fairy: 'Fairy',\n        point: 'Point',",
);

console.log('[patch-dsh-orb] done');
