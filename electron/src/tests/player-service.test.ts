import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerService } from '../core/player-service';

test('stopping an idle player is safe and leaves playback idle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mediasteru-player-test-'));
  try {
    const player = new PlayerService(directory, directory);
    const state = await player.command('stop');
    assert.equal(state.status, 'idle');
    assert.equal(state.localPath, null);
    player.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
