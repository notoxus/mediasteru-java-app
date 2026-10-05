#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(projectRoot, path), 'utf8');
const expectedArgument = process.argv.find((argument) => argument.startsWith('--expected='));
const expectedVersion = expectedArgument?.slice('--expected='.length).replace(/^v/, '');
const failures = [];

function expect(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, found ${actual ?? 'missing'}`);
}

function match(text, pattern, label) {
  const value = text.match(pattern)?.[1];
  if (!value) failures.push(`${label}: value not found`);
  return value;
}

const [pom, properties, updateChecker, releaseWorkflow, runSh, runBat] = await Promise.all([
  read('pom.xml'),
  read('src/main/resources/version.properties'),
  read('src/main/java/com/mediasteru/controller/UpdateChecker.java'),
  read('.github/workflows/release.yml'),
  read('tools/run.sh'),
  read('tools/run.bat'),
]);

const pomVersion = match(pom.slice(0, 1_000), /<version>([^<]+)<\/version>/, 'pom.xml project version');
const assemblyVersion = match(pom, /<finalName>MediaSteru-v([^<]+)<\/finalName>/, 'pom.xml assembly version');
const propertiesVersion = match(properties, /^version=(.+)$/m, 'version.properties');
const fallbackVersion = match(updateChecker, /DEFAULT_FALLBACK_VERSION\s*=\s*"v([^"]+)"/, 'UpdateChecker fallback version');

for (const [label, version] of [
  ['pom.xml assembly version', assemblyVersion],
  ['version.properties', propertiesVersion],
  ['UpdateChecker fallback version', fallbackVersion],
]) expect(label, version, pomVersion);
if (expectedVersion) expect('Release tag', expectedVersion, pomVersion);

const javaSource = match(pom, /<maven\.compiler\.source>([^<]+)<\/maven\.compiler\.source>/, 'Maven Java source');
const javaTarget = match(pom, /<maven\.compiler\.target>([^<]+)<\/maven\.compiler\.target>/, 'Maven Java target');
expect('Maven Java target', javaTarget, javaSource);

const desktopJavaBlocks = [...releaseWorkflow.matchAll(/- name:\s*(Set up Java[^\n]*)[\s\S]{0,180}?java-version:\s*'([^']+)'/g)]
  .map((result) => result[2]);
if (desktopJavaBlocks.length < 7) failures.push(`release.yml: expected at least 7 desktop Java setup blocks, found ${desktopJavaBlocks.length}`);
for (const [index, version] of desktopJavaBlocks.entries()) expect(`release.yml desktop Java block ${index + 1}`, version, javaSource);

const shellJre = match(runSh, /assets\/latest\/([0-9]+)\/hotspot/, 'run.sh JRE version');
const windowsJre = match(runBat, /assets\/latest\/([0-9]+)\/hotspot/, 'run.bat JRE version');
expect('run.sh JRE version', shellJre, javaSource);
expect('run.bat JRE version', windowsJre, javaSource);

if (failures.length > 0) {
  console.error('Project version/JRE consistency check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Version ${pomVersion} is synchronized across Java and release metadata.`);
console.log(`Java/JRE ${javaSource} is synchronized across Maven, launchers, and desktop release jobs.`);
