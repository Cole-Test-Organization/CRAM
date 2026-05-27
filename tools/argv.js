// Tiny CLI helper built on node:util.parseArgs.
//
// Supports subcommands, positional args, string and boolean options, default
// values, --no-foo negation, value coercion, and auto-generated help text.
//
// Usage:
//   import { runCli } from '../../tools/argv.js';
//
//   await runCli({
//     name: 'mycli',
//     description: 'Does a thing',
//     commands: {
//       greet: {
//         description: 'Say hello to someone',
//         usage: 'greet <name> [--loud]',
//         options: {
//           loud:    { type: 'boolean', description: 'SHOUT IT' },
//           prefix:  { type: 'string',  description: 'Greeting prefix', default: 'Hello' },
//           times:   { type: 'string',  description: 'Repeat N times',  coerce: (v) => parseInt(v, 10) },
//         },
//         async run({ positional, options }) {
//           const name = positional[0];
//           ...
//         },
//       },
//     },
//   });
//
// Negation: --no-loud flips a boolean option to false. Useful for options that
// default to true (e.g. --no-headless).

import { parseArgs } from 'node:util';

export async function runCli({ name, description, commands }) {
  const argv = process.argv.slice(2);
  const [commandName, ...rest] = argv;

  if (!commandName || commandName === '--help' || commandName === '-h') {
    printRootHelp(name, description, commands);
    process.exit(commandName ? 0 : 1);
  }

  const cmd = commands[commandName];
  if (!cmd) {
    console.error(`Unknown command: ${commandName}\n`);
    printRootHelp(name, description, commands);
    process.exit(2);
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    printCommandHelp(name, commandName, cmd);
    process.exit(0);
  }

  const optionDefs = cmd.options || {};
  const booleanNames = new Set(
    Object.entries(optionDefs)
      .filter(([, spec]) => spec.type === 'boolean')
      .map(([name]) => name)
  );

  const { args, negations } = stripNegations(rest, booleanNames);

  const parseOptions = {};
  for (const [key, spec] of Object.entries(optionDefs)) {
    parseOptions[key] = { type: spec.type };
    if (spec.short) parseOptions[key].short = spec.short;
    if (spec.default !== undefined) parseOptions[key].default = spec.default;
  }

  let parsed;
  try {
    parsed = parseArgs({ args, options: parseOptions, allowPositionals: true, strict: true });
  } catch (err) {
    console.error(`${err.message}\n`);
    printCommandHelp(name, commandName, cmd);
    process.exit(2);
  }

  const values = { ...parsed.values, ...negations };
  for (const [key, spec] of Object.entries(optionDefs)) {
    if (values[key] != null && typeof spec.coerce === 'function') {
      values[key] = spec.coerce(values[key]);
    }
  }

  return cmd.run({ positional: parsed.positionals, options: values });
}

function stripNegations(args, booleanNames) {
  const out = [];
  const negations = {};
  for (const arg of args) {
    const m = arg.match(/^--no-(.+)$/);
    if (m && booleanNames.has(m[1])) {
      negations[m[1]] = false;
    } else {
      out.push(arg);
    }
  }
  return { args: out, negations };
}

function printRootHelp(name, description, commands) {
  console.error(`${name} — ${description}\n`);
  console.error(`Usage: ${name} <command> [options]\n`);
  console.error('Commands:');
  for (const [cmdName, cmd] of Object.entries(commands)) {
    console.error(`  ${cmdName.padEnd(20)} ${cmd.description || ''}`);
  }
  console.error(`\nRun "${name} <command> --help" for command-specific options.`);
}

function printCommandHelp(name, commandName, cmd) {
  console.error(`${name} ${commandName} — ${cmd.description || ''}\n`);
  if (cmd.usage) console.error(`Usage: ${cmd.usage}\n`);
  const opts = cmd.options || {};
  if (Object.keys(opts).length === 0) return;
  console.error('Options:');
  for (const [optName, spec] of Object.entries(opts)) {
    const flag = spec.short ? `-${spec.short}, --${optName}` : `    --${optName}`;
    const valueHint = spec.type === 'string' ? ' <value>' : '';
    const defaultHint = spec.default !== undefined ? ` (default: ${JSON.stringify(spec.default)})` : '';
    const desc = (spec.description || '') + defaultHint;
    console.error(`  ${(flag + valueHint).padEnd(30)} ${desc}`);
  }
}
