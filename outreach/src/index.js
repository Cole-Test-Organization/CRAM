#!/usr/bin/env node

import { runCli } from '../../tools/argv.js';
import { researchPerson } from './commands/person.js';
import { researchCompany } from './commands/company.js';
import { researchIndustry } from './commands/industry.js';
import { logger } from './logger.js';

await runCli({
  name: 'outreach',
  description: 'Research people, companies, and industries for outreach',
  commands: {
    person: {
      description: 'Research a person — background, role, public information',
      usage: 'person <name> [options]',
      options: {
        linkedin:       { type: 'boolean', description: 'Use LinkedIn (requires prior `outreach login`)' },
        company:        { type: 'string',  description: 'Filter by company name' },
        title:          { type: 'string',  description: 'Filter by job title (e.g. "CISO")' },
        deep:           { type: 'boolean', description: 'Include activity and posts in the result' },
        'auto-relogin': { type: 'boolean', description: 'Automatically re-login if the session expires' },
        headless:       { type: 'boolean', default: true, description: 'Run browser headless (use --no-headless to debug)' },
      },
      async run({ positional, options }) {
        const name = positional[0];
        if (!name) throw new Error('Person name is required: person <name>');
        try {
          const result = await researchPerson(name, normalizeOpts(options));
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    company: {
      description: 'Research a company — leaders, initiatives, cybersecurity adoption',
      usage: 'company <name> [options]',
      options: {
        linkedin:       { type: 'boolean', description: 'Use LinkedIn (requires prior `outreach login`)' },
        deep:           { type: 'boolean', description: 'Include recent news and initiatives' },
        'auto-relogin': { type: 'boolean', description: 'Automatically re-login if the session expires' },
        headless:       { type: 'boolean', default: true, description: 'Run browser headless (use --no-headless to debug)' },
      },
      async run({ positional, options }) {
        const name = positional[0];
        if (!name) throw new Error('Company name is required: company <name>');
        try {
          const result = await researchCompany(name, normalizeOpts(options));
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    industry: {
      description: 'Research an industry — companies, leaders, cybersecurity focus',
      usage: 'industry <area> [options]',
      options: {
        linkedin:       { type: 'boolean', description: 'Use LinkedIn (requires prior `outreach login`)' },
        limit:          { type: 'string',  default: '10', description: 'Limit number of companies', coerce: (v) => parseInt(v, 10) },
        'auto-relogin': { type: 'boolean', description: 'Automatically re-login if the session expires' },
        headless:       { type: 'boolean', default: true, description: 'Run browser headless (use --no-headless to debug)' },
      },
      async run({ positional, options }) {
        const area = positional[0];
        if (!area) throw new Error('Industry area is required: industry <area>');
        try {
          const result = await researchIndustry(area, normalizeOpts(options));
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    login: {
      description: 'Login to LinkedIn and save cookies for future use',
      async run() {
        try {
          const { loginToLinkedIn } = await import('./utils/browser.js');
          await loginToLinkedIn();
          console.log(JSON.stringify({ success: true, message: 'Successfully logged in to LinkedIn' }, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    status: {
      description: 'Check LinkedIn session status and rate-limit info',
      async run() {
        try {
          const { validateSession } = await import('./utils/session.js');
          const { getRateLimitStats } = await import('./utils/ratelimit.js');

          // Human explicitly asked for status — do the real /feed probe to
          // confirm the session is live server-side, not just locally valid.
          const isValid = await validateSession(true);
          const rateLimit = await getRateLimitStats();

          console.log(JSON.stringify({
            session: {
              valid: isValid,
              status: isValid ? 'Active' : 'Expired — run: node src/index.js login',
            },
            rateLimit,
          }, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },
  },
});

function normalizeOpts(options) {
  // Downstream commands still expect a single autoRelogin camelCase key.
  return { ...options, autoRelogin: options['auto-relogin'] || false };
}
