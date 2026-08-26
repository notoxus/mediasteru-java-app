#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const argumentsList = process.argv.slice(2);
const option = (name) => argumentsList.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const allTargets = argumentsList.includes('--all');
const checkOnly = argumentsList.includes('--check');
const selectedTool = option('--tool');
const toolsDirectory = resolve(option('--tools-dir') ?? join(projectRoot, 'tools'));
const manifestPath = resolve(option('--manifest') ?? join(projectRoot, 'tools-manifest.json'));

function currentTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch;
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  return `${platform}-${arch}`;
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'VideoDownloader dependency synchronizer' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function extractZipEntry(archive, wantedEntry) {
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end-of-central-directory record not found.');

  const entries = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory.');
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const fileName = archive.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    if (fileName === wantedEntry || basename(fileName) === wantedEntry) {
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
      if (compression === 0) return Buffer.from(compressed);
      if (compression === 8) return inflateRawSync(compressed);
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${wantedEntry}`);
}

async function installAtomically(source, destination) {
  const backup = `${destination}.backup`;
  await rm(backup, { force: true });
  if (await exists(destination)) await rename(destination, backup);
  try {
    await rename(source, destination);
    await rm(backup, { force: true });
  } catch (error) {
    if (await exists(backup)) await rename(backup, destination);
    throw error;
  }
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !manifest.tools || typeof manifest.tools !== 'object') {
    throw new Error('Unsupported or malformed tools manifest.');
  }
  for (const [toolName, tool] of Object.entries(manifest.tools)) {
    if (!tool.version || !tool.repository || !tool.targets) throw new Error(`Incomplete manifest entry: ${toolName}`);
    for (const [target, asset] of Object.entries(tool.targets)) {
      for (const field of ['url', 'sha256', 'binarySha256', 'output']) {
        if (!asset[field]) throw new Error(`Missing ${toolName}.${target}.${field}`);
      }
      if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !/^[a-f0-9]{64}$/.test(asset.binarySha256)) {
        throw new Error(`Invalid checksum for ${toolName}.${target}`);
      }
    }
  }
}

async function syncAsset(toolName, version, target, asset) {
  const destination = join(toolsDirectory, asset.output);
  if (await exists(destination)) {
    const installedHash = await sha256(destination);
    if (installedHash === asset.binarySha256) {
      console.log(`[tools] Ready ${toolName} ${version} (${target})`);
      return;
    }
  }
  if (checkOnly) throw new Error(`${toolName} ${version} is missing or has the wrong checksum: ${destination}`);

  await mkdir(toolsDirectory, { recursive: true });
  const downloadFile = join(toolsDirectory, `.${asset.output}.${process.pid}.download`);
  const extractedFile = join(toolsDirectory, `.${asset.output}.${process.pid}.ready`);
  await rm(downloadFile, { force: true });
  await rm(extractedFile, { force: true });
  try {
    console.log(`[tools] Downloading ${toolName} ${version} (${target})…`);
    await download(asset.url, downloadFile);
    const downloadedHash = await sha256(downloadFile);
    if (downloadedHash !== asset.sha256) {
      throw new Error(`Checksum mismatch for ${asset.asset}: expected ${asset.sha256}, received ${downloadedHash}`);
    }

    if (asset.archive === 'zip') {
      const archive = await readFile(downloadFile);
      await writeFile(extractedFile, extractZipEntry(archive, asset.archiveEntry));
    } else {
      await rename(downloadFile, extractedFile);
    }
    const binaryHash = await sha256(extractedFile);
    if (binaryHash !== asset.binarySha256) {
      throw new Error(`Extracted checksum mismatch for ${asset.output}: expected ${asset.binarySha256}, received ${binaryHash}`);
    }
    if (process.platform !== 'win32') await chmod(extractedFile, 0o755);
    await installAtomically(extractedFile, destination);
    console.log(`[tools] Installed ${asset.output}`);
  } finally {
    await rm(downloadFile, { force: true });
    await rm(extractedFile, { force: true });
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
validateManifest(manifest);
const targets = allTargets
  ? [...new Set(Object.values(manifest.tools).flatMap((tool) => Object.keys(tool.targets)))]
  : [option('--target') ?? currentTarget()];

let matches = 0;
for (const [toolName, tool] of Object.entries(manifest.tools)) {
  if (selectedTool && selectedTool !== toolName) continue;
  for (const target of targets) {
    const asset = tool.targets[target];
    if (!asset) continue;
    matches += 1;
    await syncAsset(toolName, tool.version, target, asset);
  }
}
if (matches === 0) throw new Error(`No dependencies match target(s): ${targets.join(', ')}`);
console.log(`[tools] Synchronized ${matches} component${matches === 1 ? '' : 's'} in ${toolsDirectory}`);
