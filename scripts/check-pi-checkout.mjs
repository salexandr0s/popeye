import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PI_CLI_PATH = 'packages/coding-agent/dist/cli.js';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readPiExpectation(configPath) {
  const resolvedConfigPath = resolve(configPath);
  const config = readJson(resolvedConfigPath);
  const piVersion = config?.engine?.piVersion;
  const piPath = config?.engine?.piPath;

  if (typeof piVersion !== 'string' || piVersion.length === 0) {
    throw new Error(`Expected engine.piVersion in ${resolvedConfigPath}`);
  }

  return {
    configPath: resolvedConfigPath,
    piVersion,
    piPath: typeof piPath === 'string' && piPath.length > 0 ? piPath : '../pi',
  };
}

function parseArgsJson(argsJson) {
  if (argsJson === undefined) {
    return [];
  }
  const parsed = JSON.parse(argsJson);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error(`Expected args JSON array of strings, received: ${argsJson}`);
  }
  return parsed;
}

function inferLaunchRequirement(piPath, command, args) {
  if (command !== 'node') {
    return { requiredPath: null, description: `custom command ${command}` };
  }

  if (args.length === 0 || args[0]?.startsWith('-')) {
    return {
      requiredPath: join(piPath, DEFAULT_PI_CLI_PATH),
      description: `default Pi CLI ${DEFAULT_PI_CLI_PATH}`,
    };
  }

  const firstArg = args[0];
  return {
    requiredPath: isAbsolute(firstArg) ? firstArg : join(piPath, firstArg),
    description: `custom node entrypoint ${firstArg}`,
  };
}

export function inspectPiCheckout(piPath, expectedVersion, launchConfig = {}) {
  const resolvedPiPath = resolve(piPath);
  const codingAgentPackagePath = join(resolvedPiPath, 'packages', 'coding-agent', 'package.json');
  const command = launchConfig.command ?? 'node';
  const args = launchConfig.args ?? [];
  const launchRequirement = inferLaunchRequirement(resolvedPiPath, command, args);
  const errors = [];

  if (!existsSync(codingAgentPackagePath)) {
    errors.push(`Missing Pi coding-agent package.json at ${codingAgentPackagePath}`);
  }

  let actualVersion = null;
  if (errors.length === 0) {
    const pkg = readJson(codingAgentPackagePath);
    if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
      errors.push(`Invalid version field in ${codingAgentPackagePath}`);
    } else {
      actualVersion = pkg.version;
      if (actualVersion !== expectedVersion) {
        errors.push(`Pi coding-agent version mismatch: expected ${expectedVersion}, received ${actualVersion}`);
      }
    }
  }

  if (launchRequirement.requiredPath && !existsSync(launchRequirement.requiredPath)) {
    errors.push(`Missing ${launchRequirement.description} at ${launchRequirement.requiredPath}`);
  }

  return {
    ok: errors.length === 0,
    expectedVersion,
    actualVersion,
    piPath: resolvedPiPath,
    codingAgentPackagePath,
    launchCommand: command,
    launchArgs: args,
    requiredLaunchPath: launchRequirement.requiredPath,
    errors,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

export function verifyPiCheckout({ piPath, configPath = 'config/example.json', command, argsJson } = {}) {
  const expectation = readPiExpectation(configPath);
  const args = parseArgsJson(argsJson);
  const result = inspectPiCheckout(piPath ?? expectation.piPath, expectation.piVersion, {
    command,
    args,
  });
  if (!result.ok) {
    throw new Error(result.errors.join('\n'));
  }
  return {
    ...result,
    configPath: expectation.configPath,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyPiCheckout({
    piPath: args['pi-path'],
    configPath: args.config,
    command: args.command,
    argsJson: args['args-json'],
  });
  console.info(`Pi checkout verified: ${result.piPath}`);
  console.info(`Expected coding-agent version: ${result.expectedVersion}`);
  if (result.requiredLaunchPath) {
    console.info(`Verified launch target: ${result.requiredLaunchPath}`);
  } else {
    console.info(`Verified launch command: ${result.launchCommand}`);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
