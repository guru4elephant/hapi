import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildSpawnChildEnv, listEnvProfiles, loadEnvProfile, parseEnvProfile } from './envProfiles';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hapi-env-profiles-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('parseEnvProfile', () => {
    it('parses comments, export, quotes and inline comments without expansion', () => {
        const result = parseEnvProfile([
            '# Claude via proxy',
            '',
            'ANTHROPIC_BASE_URL=https://proxy.example.com  # trailing comment',
            'export ANTHROPIC_AUTH_TOKEN="sk-a\\"b\\\\c"',
            "LITERAL='$HOME/x # not a comment'",
            'MULTI="line1\\nline2"',
            'EMPTY=',
            'URL_WITH_HASH=https://x.example.com/#frag',
            'EXPANDED=$HOME',
        ].join('\r\n'));

        expect(result).toEqual({
            type: 'ok',
            ignoredKeys: [],
            env: {
                ANTHROPIC_BASE_URL: 'https://proxy.example.com',
                ANTHROPIC_AUTH_TOKEN: 'sk-a"b\\c',
                LITERAL: '$HOME/x # not a comment',
                MULTI: 'line1\nline2',
                EMPTY: '',
                URL_WITH_HASH: 'https://x.example.com/#frag',
                EXPANDED: '$HOME',
            },
        });
    });

    it('ignores keys that would redirect the session away from its hub', () => {
        const result = parseEnvProfile('HAPI_API_URL=https://evil\nCLI_API_TOKEN=x\nHAPI_HOME=/tmp\nOK=1\n');
        expect(result).toEqual({
            type: 'ok',
            env: { OK: '1' },
            ignoredKeys: ['HAPI_API_URL', 'CLI_API_TOKEN', 'HAPI_HOME'],
        });
    });

    it('reports the line of a malformed entry', () => {
        expect(parseEnvProfile('OK=1\nnot a pair\n')).toEqual({ type: 'error', line: 2, reason: 'expected KEY=VALUE' });
        expect(parseEnvProfile('1BAD=x')).toEqual({ type: 'error', line: 1, reason: 'invalid variable name' });
        expect(parseEnvProfile('A="open')).toEqual({ type: 'error', line: 1, reason: 'invalid quoted value' });
        expect(parseEnvProfile('A="x" junk')).toEqual({ type: 'error', line: 1, reason: 'invalid quoted value' });
    });
});

describe('listEnvProfiles', () => {
    it('returns [] when the directory does not exist', () => {
        expect(listEnvProfiles(join(dir, 'missing'))).toEqual([]);
    });

    it('lists valid .env names sorted, skipping other files and directories', async () => {
        await writeFile(join(dir, 'zeta.env'), 'A=1');
        await writeFile(join(dir, 'alpha.env'), 'A=1');
        await writeFile(join(dir, 'notes.txt'), '');
        await writeFile(join(dir, 'bad name.env'), '');
        await mkdir(join(dir, 'dir.env'));
        expect(listEnvProfiles(dir)).toEqual(['alpha', 'zeta']);
    });
});

describe('loadEnvProfile', () => {
    it('loads a profile and reports world-readable files', async () => {
        const path = join(dir, 'proxy.env');
        await writeFile(path, 'ANTHROPIC_BASE_URL=https://proxy.example.com\n');
        await chmod(path, 0o600);
        expect(await loadEnvProfile('proxy', dir)).toEqual({
            type: 'ok',
            env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
            ignoredKeys: [],
            worldReadable: false,
        });
        if (process.platform !== 'win32') {
            await chmod(path, 0o644);
            const result = await loadEnvProfile('proxy', dir);
            expect(result.type === 'ok' && result.worldReadable).toBe(true);
        }
    });

    it('rejects names that could escape the profile directory', async () => {
        for (const name of ['../secret', '..', 'a/b', '']) {
            const result = await loadEnvProfile(name, dir);
            expect(result.type).toBe('error');
        }
    });

    it('returns a clear error for a missing profile', async () => {
        const result = await loadEnvProfile('gone', dir);
        expect(result).toEqual({ type: 'error', errorMessage: expect.stringContaining("Env profile 'gone' not found") });
    });

    it('does not echo values in parse errors', async () => {
        await writeFile(join(dir, 'broken.env'), 'TOKEN="sk-secret');
        const result = await loadEnvProfile('broken', dir);
        expect(result.type).toBe('error');
        expect(result.type === 'error' && result.errorMessage).not.toContain('sk-secret');
        expect(result.type === 'error' && result.errorMessage).toContain('line 1');
    });
});

describe('buildSpawnChildEnv', () => {
    it('layers runner env < profile < runner extras and records the profile', () => {
        const env = buildSpawnChildEnv(
            { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://runner-default', CODEX_HOME: '/home/u/.codex' },
            { ANTHROPIC_BASE_URL: 'https://proxy', CODEX_HOME: '/home/u/.codex-proxy' },
            { CODEX_HOME: '/tmp/hapi-codex-token' },
            'proxy',
        );
        expect(env).toEqual({
            PATH: '/bin',
            ANTHROPIC_BASE_URL: 'https://proxy',
            CODEX_HOME: '/tmp/hapi-codex-token',
            HAPI_ENV_PROFILE: 'proxy',
        });
    });

    it('clears a profile name inherited by the runner when none is selected', () => {
        const env = buildSpawnChildEnv({ HAPI_ENV_PROFILE: 'stale' }, {}, {}, undefined);
        expect(env.HAPI_ENV_PROFILE).toBe('');
    });
});
