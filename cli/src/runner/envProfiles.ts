import { readdirSync, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { EnvProfileNameSchema } from '@hapi/protocol/schemas';
import { configuration } from '@/configuration';

/**
 * Runner-side env profiles: `$HAPI_HOME/env-profiles/<name>.env`.
 *
 * The runner advertises profile names in machine metadata and applies the
 * selected profile's variables to a spawned session. Values never leave this
 * machine: clients only see and send names.
 *
 * File format (parsed here, never executed by a shell):
 *   - `KEY=VALUE` per line; blank lines and `#` comments are skipped
 *   - optional `export ` prefix
 *   - `"double quoted"` values support \n, \t, \" and \\ escapes;
 *     `'single quoted'` values are literal
 *   - unquoted values end at ` #` (inline comment) and are trimmed
 *   - no `$VAR` / `~` expansion
 */

const ENV_PROFILE_EXTENSION = '.env';
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function envProfilesDir(happyHomeDir: string = configuration.happyHomeDir): string {
    return join(happyHomeDir, 'env-profiles');
}

export function isValidEnvProfileName(name: string): boolean {
    return EnvProfileNameSchema.safeParse(name).success;
}

/**
 * Keys a profile must not override: they control how the session reaches the
 * hub and which HAPI runtime it uses, not the agent.
 */
export function isReservedEnvProfileKey(key: string): boolean {
    return key.startsWith('HAPI_') || key === 'CLI_API_TOKEN';
}

/** Sorted names of `<name>.env` files in the profile directory; [] if it does not exist. */
export function listEnvProfiles(dir: string = envProfilesDir()): string[] {
    let entries: Dirent[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(ENV_PROFILE_EXTENSION))
        .map((entry) => entry.name.slice(0, -ENV_PROFILE_EXTENSION.length))
        .filter(isValidEnvProfileName)
        .sort();
}

export type ParsedEnvProfile =
    | { type: 'ok'; env: Record<string, string>; ignoredKeys: string[] }
    | { type: 'error'; line: number; reason: string };

export function parseEnvProfile(content: string): ParsedEnvProfile {
    const env: Record<string, string> = {};
    const ignoredKeys: string[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        let line = lines[i].trim();
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        if (line.startsWith('export ')) {
            line = line.slice('export '.length).trimStart();
        }
        const eq = line.indexOf('=');
        if (eq <= 0) {
            return { type: 'error', line: lineNumber, reason: 'expected KEY=VALUE' };
        }
        const key = line.slice(0, eq).trim();
        if (!ENV_KEY_PATTERN.test(key)) {
            return { type: 'error', line: lineNumber, reason: 'invalid variable name' };
        }
        const value = parseValue(line.slice(eq + 1).trim());
        if (value === null) {
            return { type: 'error', line: lineNumber, reason: 'invalid quoted value' };
        }
        if (isReservedEnvProfileKey(key)) {
            ignoredKeys.push(key);
            continue;
        }
        env[key] = value;
    }

    return { type: 'ok', env, ignoredKeys };
}

function parseValue(raw: string): string | null {
    const quote = raw[0];
    if (quote === '"' || quote === '\'') {
        const end = findClosingQuote(raw, quote);
        if (end === -1) {
            return null;
        }
        const rest = raw.slice(end + 1).trim();
        if (rest !== '' && !rest.startsWith('#')) {
            return null;
        }
        const inner = raw.slice(1, end);
        return quote === '"' ? unescapeDoubleQuoted(inner) : inner;
    }
    const commentStart = raw.search(/\s#/);
    return (commentStart === -1 ? raw : raw.slice(0, commentStart)).trim();
}

function findClosingQuote(raw: string, quote: string): number {
    for (let i = 1; i < raw.length; i++) {
        if (quote === '"' && raw[i] === '\\') {
            i++;
            continue;
        }
        if (raw[i] === quote) {
            return i;
        }
    }
    return -1;
}

function unescapeDoubleQuoted(value: string): string {
    return value.replace(/\\([nt"\\])/g, (_, ch: string) => {
        switch (ch) {
            case 'n': return '\n';
            case 't': return '\t';
            default: return ch;
        }
    });
}

export type LoadEnvProfileResult =
    | { type: 'ok'; env: Record<string, string>; ignoredKeys: string[]; worldReadable: boolean }
    | { type: 'error'; errorMessage: string };

/**
 * Read and parse one profile. Called on every spawn, so edits to an existing
 * profile apply to the next session without restarting the runner. Error
 * messages name the file and line but never include values.
 */
export async function loadEnvProfile(name: string, dir: string = envProfilesDir()): Promise<LoadEnvProfileResult> {
    if (!isValidEnvProfileName(name)) {
        return { type: 'error', errorMessage: `Invalid env profile name: ${JSON.stringify(name)}` };
    }
    const path = join(dir, `${name}${ENV_PROFILE_EXTENSION}`);

    let content: string;
    let mode: number;
    try {
        const stat = await fs.stat(path);
        if (!stat.isFile()) {
            return { type: 'error', errorMessage: `Env profile '${name}' is not a regular file: ${path}` };
        }
        mode = stat.mode;
        content = await fs.readFile(path, 'utf8');
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return { type: 'error', errorMessage: `Env profile '${name}' not found on this machine (${path})` };
        }
        return { type: 'error', errorMessage: `Unable to read env profile '${name}' (${path}): ${error?.message ?? error}` };
    }

    const parsed = parseEnvProfile(content);
    if (parsed.type === 'error') {
        return { type: 'error', errorMessage: `Invalid env profile '${name}' (${path}) line ${parsed.line}: ${parsed.reason}` };
    }
    return {
        type: 'ok',
        env: parsed.env,
        ignoredKeys: parsed.ignoredKeys,
        worldReadable: process.platform !== 'win32' && (mode & 0o044) !== 0,
    };
}

/**
 * Child env for a runner spawn: runner env < profile < runner-owned extras
 * (token / worktree vars). `HAPI_ENV_PROFILE` is always set ('' = none) so
 * the child reports the profile it actually got, never one inherited by the
 * runner process.
 */
export function buildSpawnChildEnv(
    baseEnv: NodeJS.ProcessEnv,
    profileEnv: Record<string, string>,
    extraEnv: Record<string, string>,
    envProfile: string | undefined,
): NodeJS.ProcessEnv {
    return {
        ...baseEnv,
        ...profileEnv,
        ...extraEnv,
        HAPI_ENV_PROFILE: envProfile ?? '',
    };
}
