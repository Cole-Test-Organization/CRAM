# Outreach Research CLI

A CLI tool for researching people, companies, and industries with a focus on cybersecurity intelligence gathering and outreach preparation.

## Features

- **Person Research**: Gather background, role, and public information about individuals
- **Company Research**: Discover leaders, initiatives, and cybersecurity adoption
- **Industry Research**: Map companies, leaders, and cybersecurity trends in specific areas
- **LinkedIn Integration**: Optional authenticated LinkedIn scraping for richer data
- **JSON Output**: Structured data output for easy parsing and automation

## Installation

```bash
cd outreach
npm install
```

## Setup

### Basic Usage (Web Search Only)

The CLI works out of the box with web search for basic research.

### LinkedIn Integration (Optional)

For richer data from LinkedIn, you need to authenticate once:

```bash
node src/index.js login
```

This will:
1. Open a browser window
2. Wait for you to log in to LinkedIn manually
3. Save your session cookies for future use

Once logged in, you can use the `--linkedin` flag with any research command.

## Usage

### Research a Person

```bash
# Basic research
node src/index.js person "John Smith"

# With LinkedIn integration
node src/index.js person "Jane Doe" --linkedin

# Deep research with more details
node src/index.js person "Bob Johnson" --linkedin --deep
```

**Output**: JSON with name, background, current role, experience, and public information.

### Research a Company

```bash
# Basic research
node src/index.js company "Acme Corp"

# With LinkedIn integration
node src/index.js company "TechStart Inc" --linkedin

# Deep research with initiatives and news
node src/index.js company "CyberSec LLC" --linkedin --deep
```

**Output**: JSON with company leaders, initiatives, cybersecurity adoption, and public information.

### Research an Industry

```bash
# Basic research
node src/index.js industry "healthcare cybersecurity"

# With LinkedIn and custom limit
node src/index.js industry "fintech" --linkedin --limit 20

# Research specific area
node src/index.js industry "cloud security startups" --linkedin
```

**Output**: JSON with companies in the area, industry leaders, cybersecurity trends, and market drivers.

## Output Format

All commands output JSON to stdout:

```json
{
  "name": "...",
  "source": "web" | "linkedin",
  "profile": { ... },
  "background": { ... },
  "publicInfo": [ ... ]
}
```

Errors are output to stderr as JSON:

```json
{
  "error": "Error message here"
}
```

## Integration with Claude Code

This CLI is designed to be used as a Claude Code skill. When invoked via the `/outreach` command, Claude will:

1. Understand your research request
2. Run the appropriate `research` command
3. Parse the JSON output
4. Present findings in a clear, actionable format
5. Suggest follow-up research if relevant

## Examples

### Example 1: Research a Security Leader

```bash
node src/index.js person "Kevin Mandia" --linkedin --deep
```

Claude will present:
- Current role and company
- Background and experience
- Public statements and activities
- Cybersecurity focus areas

### Example 2: Research a Target Company

```bash
node src/index.js company "Palo Alto Networks" --linkedin --deep
```

Claude will present:
- Key executives and decision makers
- Recent cybersecurity initiatives
- Security product offerings
- Market position and trends

### Example 3: Research from an Email List

Give Claude a list of emails for an upcoming call or meeting:

```
Research everyone on this call:
- jane.doe@paloaltonetworks.com
- bob.smith@cisco.com
- sarah.jones@crowdstrike.com
```

Claude will:
1. Identify the companies from the email domains (Palo Alto Networks, Cisco, CrowdStrike)
2. Research each company for background, cybersecurity posture, and leadership
3. Extract person names from the emails (Jane Doe, Bob Smith, Sarah Jones)
4. Research each person's role, background, and relevance
5. Present a consolidated briefing with company summaries, person profiles, and talking points

### Example 4: Map an Industry

```bash
node src/index.js industry "healthcare HIPAA compliance" --linkedin --limit 25
```

Claude will present:
- Major companies in the space
- Industry leaders and influencers
- Cybersecurity trends and drivers
- Regulatory focus areas

## Notes

- LinkedIn scraping respects rate limits with built-in delays
- Cookies are stored in `cookies.json` (gitignored)
- First run with `--linkedin` requires `login` command first
- Web search provides fallback when LinkedIn is unavailable
- All data is for research and outreach purposes only

## Troubleshooting

**"Not logged in to LinkedIn"**: Run `node src/index.js login` first

**Browser hangs during login**: Make sure you complete the login within 5 minutes

**No results found**: Try adjusting search terms or removing the `--linkedin` flag

**Rate limited**: Wait a few minutes between requests when using LinkedIn

## Privacy & Ethics

- Only access publicly available information
- Respect LinkedIn's terms of service
- Use data responsibly for legitimate outreach
- Don't scrape aggressively or at scale
- Obtain consent before adding contacts to lists
