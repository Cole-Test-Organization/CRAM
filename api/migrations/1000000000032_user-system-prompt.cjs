// Per-user, editable agent system prompt. Adds a nullable `system_prompt`
// column to user_agent_settings (one row per user) so the in-app agent's base
// instructions/persona can be customized in Settings — separate from memories
// (individual facts/rules), which keep their own table.
//
// NULL means "use the built-in default" — exactly how provider / model /
// local_base_url already behave in this table. We deliberately DON'T seed the
// default text here:
//   1. The runtime default ends with the current date, which a frozen seed row
//      would make stale — loop.js injects today's date at composition time
//      instead, so it stays fresh no matter what the user customizes.
//   2. The default's persona references VENDOR_NAME / USER_ROLE, which come from
//      per-deployment config — baking them into a committed migration would
//      hard-code vendor identity (against the vendor-agnostic design).
// So the source of truth for the default is defaultSystemPrompt() in
// api/src/agent/defaults.js, surfaced live via GET /api/agent/settings.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_agent_settings ADD COLUMN system_prompt TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_agent_settings DROP COLUMN IF EXISTS system_prompt;
  `);
};
