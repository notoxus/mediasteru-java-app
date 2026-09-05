#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(projectRoot, 'tools-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const definitions = {
  'yt-dlp': {
    repository: 'yt-dlp/yt-dlp',
    version: (release) => release.tag_name,
    assets: {
      'win32-x64': ['yt-dlp.exe', 'yt-dlp.exe'],
      'darwin-x64': ['yt-dlp_macos', 'yt-dlp-macos'],
      'darwin-arm64': ['yt-dlp_macos', 'yt-dlp-macos'],
      'linux-x64': ['yt-dlp_linux', 'yt-dlp-linux-x64'],
      'linux-arm64': ['yt-dlp_linux_aarch64', 'yt-dlp-linux-arm64'],
    },
  },
  ffmpeg: {
    repository: 'Tyrrrz/FFmpegBin',
    version: (release) => release.tag_name,
    assets: {
      'win32-x64': ['ffmpeg-windows-x64.zip', 'ffmpeg-win-x64.exe', 'ffmpeg.exe'],
      'darwin-x64': ['ffmpeg-osx-x64.zip', 'ffmpeg-macos-x64', 'ffmpeg'],
      'darwin-arm64': ['ffmpeg-osx-arm64.zip', 'ffmpeg-macos-arm64', 'ffmpeg'],
      'linux-x64': ['ffmpeg-linux-x64.zip', 'ffmpeg-linux-x64', 'ffmpeg'],
      'linux-arm64': ['ffmpeg-linux-arm64.zip', 'ffmpeg-linux-arm64', 'ffmpeg'],
    },
  },
  deno: {
    repository: 'denoland/deno',
    version: (release) => release.tag_name.replace(/^v/, ''),
    assets: {
      'win32-x64': ['deno-x86_64-pc-windows-msvc.zip', 'deno-win-x64.exe', 'deno.exe'],
      'darwin-x64': ['deno-x86_64-apple-darwin.zip', 'deno-macos-x64', 'deno'],
      'darwin-arm64': ['deno-aarch64-apple-darwin.zip', 'deno-macos-arm64', 'deno'],
      'linux-x64': ['deno-x86_64-unknown-linux-gnu.zip', 'deno-linux-x64', 'deno'],
      'linux-arm64': ['deno-aarch64-unknown-linux-gnu.zip', 'deno-linux-arm64', 'deno'],
    },
  },
};

async function request(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MediaSteru dependency updater' } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${url}`);
  return response;
}

function digest(asset) {
  const value = asset.digest?.replace(/^sha256:/, '').toLowerCase();
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`GitHub did not publish a SHA-256 digest for ${asset.name}`);
  return value;
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

async function archivedBinaryDigest(asset, archiveEntry, expectedArchiveDigest) {
  console.log(`[tools] Inspecting ${asset.name}…`);
  const archive = Buffer.from(await (await request(asset.browser_download_url)).arrayBuffer());
  const archiveDigest = createHash('sha256').update(archive).digest('hex');
  if (archiveDigest !== expectedArchiveDigest) {
    throw new Error(`Downloaded checksum mismatch for ${asset.name}`);
  }
  return createHash('sha256').update(extractZipEntry(archive, archiveEntry)).digest('hex');
}

async function denoBinaryDigest(release, zipAssetName) {
  const checksumName = zipAssetName.replace(/\.zip$/, '.sha256sum');
  const checksumAsset = release.assets.find((asset) => asset.name === checksumName);
  if (!checksumAsset) throw new Error(`Deno checksum asset not found: ${checksumName}`);
  const text = await (await request(checksumAsset.browser_download_url)).text();
  const hash = text.match(/\b[a-fA-F0-9]{64}\b/)?.[0]?.toLowerCase();
  if (!hash) throw new Error(`Could not parse Deno checksum: ${checksumName}`);
  return hash;
}

const updated = structuredClone(manifest);
for (const [toolName, definition] of Object.entries(definitions)) {
  const release = await (await request(`https://api.github.com/repos/${definition.repository}/releases/latest`)).json();
  const targetEntries = {};
  for (const [target, [assetName, output, archiveEntry]] of Object.entries(definition.assets)) {
    const asset = release.assets.find((candidate) => candidate.name === assetName);
    if (!asset) throw new Error(`${toolName} release ${release.tag_name} is missing ${assetName}`);
    const sha = digest(asset);
    const existing = manifest.tools[toolName]?.targets?.[target];
    const reusableBinaryDigest = existing?.url === asset.browser_download_url
      && existing?.sha256 === sha
      && existing?.binarySha256;
    const binarySha256 = reusableBinaryDigest
      || (archiveEntry
        ? toolName === 'deno'
          ? await denoBinaryDigest(release, assetName)
          : await archivedBinaryDigest(asset, archiveEntry, sha)
        : sha);
    targetEntries[target] = {
      asset: asset.name,
      url: asset.browser_download_url,
      sha256: sha,
      binarySha256,
      ...(archiveEntry ? { archive: 'zip', archiveEntry } : {}),
      output,
    };
  }
  updated.tools[toolName] = {
    repository: definition.repository,
    version: definition.version(release),
    tag: release.tag_name,
    targets: targetEntries,
  };
}

const comparable = (value) => JSON.stringify(value, (key, item) => key === 'generatedAt' ? undefined : item);
if (comparable(updated) === comparable(manifest)) {
  console.log('[tools] Manifest already tracks the latest releases.');
} else {
  updated.generatedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log('[tools] Updated tools-manifest.json:');
  for (const [name, tool] of Object.entries(updated.tools)) console.log(`  ${name}: ${tool.version}`);
}
