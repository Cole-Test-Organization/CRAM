import { getApiToken, getDefaults } from './config.js';

const BASE_URL = 'https://api.todoist.com/api/v1';

async function request(method, path, body = null) {
  const token = await getApiToken();
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Todoist API ${res.status}: ${text}`);
  }

  if (res.status === 204) return { success: true };

  const data = await res.json();

  // v1 API wraps list responses in { results: [...] }
  if (data.results && Array.isArray(data.results)) return data.results;
  return data;
}

export async function createTask({ content, description, project_id, section_id, labels, priority, due_string, due_date }) {
  // Apply defaults if no project/section specified
  if (!project_id && !section_id) {
    const defaults = await getDefaults();
    project_id = defaults.project_id;
    section_id = defaults.section_id;
  }

  const body = { content };
  if (description) body.description = description;
  if (project_id) body.project_id = project_id;
  if (section_id) body.section_id = section_id;
  if (labels && labels.length) body.labels = labels;
  if (priority) body.priority = priority;
  if (due_string) body.due_string = due_string;
  if (due_date) body.due_date = due_date;

  return request('POST', '/tasks', body);
}

export async function getTasks({ project_id, label, filter } = {}) {
  const params = new URLSearchParams();
  if (project_id) params.set('project_id', project_id);
  if (label) params.set('label', label);
  if (filter) params.set('filter', filter);
  const qs = params.toString();
  return request('GET', `/tasks${qs ? '?' + qs : ''}`);
}

export async function closeTask(taskId) {
  return request('POST', `/tasks/${taskId}/close`);
}

export async function getProjects() {
  return request('GET', '/projects');
}

export async function getSections(projectId) {
  const params = projectId ? `?project_id=${projectId}` : '';
  return request('GET', `/sections${params}`);
}

export async function getProjectByName(name) {
  const projects = await getProjects();
  const lower = name.toLowerCase();
  return projects.find(p => p.name.toLowerCase() === lower)
    || projects.find(p => p.name.toLowerCase().includes(lower))
    || null;
}

export async function getSectionByName(projectId, name) {
  const sections = await getSections(projectId);
  const lower = name.toLowerCase();
  return sections.find(s => s.name.toLowerCase() === lower)
    || sections.find(s => s.name.toLowerCase().includes(lower))
    || null;
}
