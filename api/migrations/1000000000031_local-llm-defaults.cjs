// Move the agent off the hosted provider and onto a local LLM by default.
// The app now ships pointed at Ollama running on the device itself, so:
//   1. flip the agent_sessions column defaults from the old hosted
//      provider/model to local / gemma4:e4b, and
//   2. rewrite any existing rows that still reference the removed hosted
//      provider, so resuming an old session (or reading saved settings)
//      doesn't try to reach a provider the app no longer has.
//
// Conversation history (the messages JSONB) is untouched — only the backend
// label changes, so old sessions resume on the local provider instead of
// throwing "Unknown provider".

exports.up = (pgm) => {
  pgm.sql(`
    -- New-row defaults for the conversation table.
    ALTER TABLE agent_sessions ALTER COLUMN provider SET DEFAULT 'local';
    ALTER TABLE agent_sessions ALTER COLUMN model    SET DEFAULT 'gemma4:e4b';

    -- Retarget existing conversations created under the old hosted provider.
    UPDATE agent_sessions SET provider = 'local'      WHERE provider = 'anthropic';
    UPDATE agent_sessions SET model    = 'gemma4:e4b' WHERE model = 'claude-sonnet-4-6';

    -- Saved per-user settings: drop the hosted provider and null the stale
    -- hosted model so it falls back to the server default (gemma4:e4b).
    UPDATE user_agent_settings SET provider = 'local' WHERE provider = 'anthropic';
    UPDATE user_agent_settings SET model    = NULL     WHERE model = 'claude-sonnet-4-6';
  `);
};

exports.down = (pgm) => {
  // Restores the prior column defaults. The data rewrites above are not
  // reversed — we no longer know which rows were originally hosted.
  pgm.sql(`
    ALTER TABLE agent_sessions ALTER COLUMN provider SET DEFAULT 'anthropic';
    ALTER TABLE agent_sessions ALTER COLUMN model    SET DEFAULT 'claude-sonnet-4-6';
  `);
};
