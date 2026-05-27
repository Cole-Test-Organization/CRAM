import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const CONFIG_FILE = path.join(ROOT, '.config.json');

const DEFAULTS = {
  project: process.env.TODOIST_DEFAULT_PROJECT || 'Inbox',
  section: process.env.TODOIST_DEFAULT_SECTION || '',
};

export async function getApiToken() {
  // Try .env file first
  try {
    const content = await fs.readFile(ENV_FILE, 'utf-8');
    const match = content.match(/^TODOIST_API_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}

  // Try environment variable
  if (process.env.TODOIST_API_TOKEN) {
    return process.env.TODOIST_API_TOKEN;
  }

  throw new Error(
    'Todoist API token not found. Create todoist/.env with:\n' +
    'TODOIST_API_TOKEN=your_token_here\n\n' +
    'Get your token from: https://todoist.com/app/settings/integrations/developer'
  );
}

export async function getDefaults() {
  // Try cached config first. Delete .config.json after editing TODOIST_DEFAULT_*
  // env vars — the cache is keyed on whatever defaults were live when it was written.
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    if (config.project_id && config.project_name === DEFAULTS.project) return config;
  } catch {}

  // Resolve from API and cache
  const token = await getApiToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Find project
  const projectsRes = await fetch('https://api.todoist.com/api/v1/projects', { headers });
  if (!projectsRes.ok) throw new Error(`Failed to fetch projects: ${projectsRes.status}`);
  const projectsData = await projectsRes.json();
  const projects = projectsData.results || projectsData;

  const project = projects.find(p => p.name.toLowerCase() === DEFAULTS.project.toLowerCase());
  if (!project) throw new Error(`Default project "${DEFAULTS.project}" not found in Todoist`);

  // Resolve section if one was configured. With TODOIST_DEFAULT_SECTION unset,
  // tasks land at the project root.
  let section = null;
  if (DEFAULTS.section) {
    const sectionsRes = await fetch(`https://api.todoist.com/api/v1/sections?project_id=${project.id}`, { headers });
    if (!sectionsRes.ok) throw new Error(`Failed to fetch sections: ${sectionsRes.status}`);
    const sectionsData = await sectionsRes.json();
    const sections = sectionsData.results || sectionsData;

    section = sections.find(s => s.name.toLowerCase() === DEFAULTS.section.toLowerCase());
    if (!section) throw new Error(`Default section "${DEFAULTS.section}" not found in project "${DEFAULTS.project}"`);
  }

  const config = {
    project_id: project.id,
    project_name: project.name,
    section_id: section ? section.id : null,
    section_name: section ? section.name : null,
  };

  // Cache for next time
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}
