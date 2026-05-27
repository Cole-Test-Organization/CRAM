#!/usr/bin/env node

import { runCli } from '../../tools/argv.js';
import { createTask, getTasks, closeTask, getProjects, getSections, getProjectByName, getSectionByName } from './api.js';
import { getDefaults } from './config.js';
import { logger } from './logger.js';

await runCli({
  name: 'todoist',
  description: 'Create and manage Todoist tasks',
  commands: {
    'create-task': {
      description: 'Create a single Todoist task',
      usage: 'create-task <content> [options]',
      options: {
        description: { type: 'string', description: 'Task description / context' },
        project:     { type: 'string', description: 'Project name (defaults to TODOIST_DEFAULT_PROJECT)' },
        section:     { type: 'string', description: 'Section name (defaults to TODOIST_DEFAULT_SECTION)' },
        labels:      { type: 'string', description: 'Comma-separated labels' },
        priority:    { type: 'string', description: 'Priority 1-4 (4=urgent)', coerce: (v) => parseInt(v, 10) },
        due:         { type: 'string', description: 'Due date (natural language or YYYY-MM-DD)' },
      },
      async run({ positional, options }) {
        const content = positional[0];
        if (!content) throw new Error('Task content is required: create-task <content>');

        try {
          const taskData = { content };
          if (options.description) taskData.description = options.description;

          if (options.project) {
            const project = await getProjectByName(options.project);
            if (project) {
              taskData.project_id = project.id;
              if (options.section) {
                const section = await getSectionByName(project.id, options.section);
                if (section) taskData.section_id = section.id;
                else logger.warn({ event: 'section.not_found', section: options.section }, 'section not found, using project root');
              }
            } else {
              logger.warn({ event: 'project.not_found', project: options.project }, 'project not found, using default');
            }
          } else if (options.section) {
            const defaults = await getDefaults();
            taskData.project_id = defaults.project_id;
            const section = await getSectionByName(defaults.project_id, options.section);
            if (section) taskData.section_id = section.id;
            else logger.warn({ event: 'section.not_found', section: options.section }, 'section not found, using default');
          }

          if (options.labels) taskData.labels = options.labels.split(',').map((l) => l.trim());
          if (options.priority) taskData.priority = options.priority;
          if (options.due) taskData.due_string = options.due;

          const result = await createTask(taskData);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    'create-tasks': {
      description: 'Batch create tasks from a JSON array on stdin',
      usage: 'create-tasks  (pipe a JSON array of task objects)',
      async run() {
        try {
          const chunks = [];
          for await (const chunk of process.stdin) chunks.push(chunk);
          const input = Buffer.concat(chunks).toString().trim();

          if (!input) throw new Error('No input received on stdin. Pipe a JSON array of task objects.');

          const tasks = JSON.parse(input);
          if (!Array.isArray(tasks)) throw new Error('Input must be a JSON array of task objects');

          const results = [];
          for (const task of tasks) {
            if (task.project && !task.project_id) {
              const project = await getProjectByName(task.project);
              if (project) {
                task.project_id = project.id;
                if (task.section) {
                  const section = await getSectionByName(project.id, task.section);
                  if (section) task.section_id = section.id;
                }
              }
              delete task.project;
              delete task.section;
            }

            const result = await createTask(task);
            results.push(result);
            logger.info({ event: 'task.created', content: task.content, id: result.id }, 'created task');
          }

          console.log(JSON.stringify(results, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    'list-projects': {
      description: 'List all Todoist projects',
      async run() {
        try {
          const projects = await getProjects();
          console.log(JSON.stringify(projects, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    'list-sections': {
      description: 'List sections for a project',
      usage: 'list-sections [--project <name>]',
      options: {
        project: { type: 'string', description: 'Project name (defaults to TODOIST_DEFAULT_PROJECT)' },
      },
      async run({ options }) {
        try {
          let projectId;
          if (options.project) {
            const project = await getProjectByName(options.project);
            if (!project) throw new Error(`Project "${options.project}" not found`);
            projectId = project.id;
          } else {
            const defaults = await getDefaults();
            projectId = defaults.project_id;
          }
          const sections = await getSections(projectId);
          console.log(JSON.stringify(sections, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    'list-tasks': {
      description: 'List Todoist tasks',
      usage: 'list-tasks [--project <name>] [--label <label>] [--filter <string>]',
      options: {
        project: { type: 'string', description: 'Filter by project name' },
        label:   { type: 'string', description: 'Filter by label' },
        filter:  { type: 'string', description: 'Todoist filter string' },
      },
      async run({ options }) {
        try {
          const params = {};
          if (options.project) {
            const project = await getProjectByName(options.project);
            if (project) params.project_id = project.id;
            else throw new Error(`Project "${options.project}" not found`);
          }
          if (options.label) params.label = options.label;
          if (options.filter) params.filter = options.filter;

          const tasks = await getTasks(params);
          console.log(JSON.stringify(tasks, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    'close-task': {
      description: 'Close/complete a task by ID',
      usage: 'close-task <id>',
      async run({ positional }) {
        const id = positional[0];
        if (!id) throw new Error('Task id is required: close-task <id>');
        try {
          await closeTask(id);
          console.log(JSON.stringify({ success: true, id }));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },

    status: {
      description: 'Verify API token and show default project/section',
      async run() {
        try {
          const defaults = await getDefaults();
          const projects = await getProjects();
          console.log(JSON.stringify({
            authenticated: true,
            total_projects: projects.length,
            default_project: defaults.project_name,
            default_section: defaults.section_name,
          }, null, 2));
        } catch (error) {
          logger.error({ err: error.message }, 'command failed');
          process.exit(1);
        }
      },
    },
  },
});
