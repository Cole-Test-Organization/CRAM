import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getConfig() {
  const sslEnabled = process.env.DATABASE_SSL === 'true';
  return {
    port: parseInt(process.env.PORT || '3200', 10),
    host: process.env.HOST || '0.0.0.0',
    notesDir: process.env.NOTES_DIR || path.resolve(__dirname, '..', '..', 'notes'),
    databaseUrl: process.env.DATABASE_URL || 'postgres://crm:devpassword@db:5432/crm',
    databaseSsl: sslEnabled
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
    defaultUserEmail: process.env.DEFAULT_USER_EMAIL || 'default@local',
    apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || '3200'}`,

    // Onboarding-supplied identity. Setup.sh writes these to .env on first run.
    vendorName: process.env.VENDOR_NAME || 'Acme Corp',
    userRole: process.env.USER_ROLE || 'Sales Engineer',

    // Where Todoist tasks land by default. Setup.sh prompts for these.
    todoistDefaultProject: process.env.TODOIST_DEFAULT_PROJECT || 'Inbox',
    todoistDefaultSection: process.env.TODOIST_DEFAULT_SECTION || '',
  };
}
