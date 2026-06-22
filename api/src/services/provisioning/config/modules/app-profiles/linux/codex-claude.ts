import type { AppProfileModule } from "../../types.js";

const appProfile = {
  "name": "codex-claude",
  "description": "Ubuntu bootstrap profile for Codex CLI and Claude Code CLI validation hosts.",
  "packages": [
    "git",
    "python3",
    "python3-pip"
  ],
  "commands": [
    "npm install -g @openai/codex",
    "npm install -g @anthropic-ai/claude-code"
  ]
} satisfies AppProfileModule;

export default appProfile;
