import { searchLinkedIn } from '../utils/browser.js';
import { searchWeb } from '../utils/web.js';

export async function researchIndustry(area, options = {}) {
  const limit = parseInt(options.limit) || 10;

  const result = {
    area,
    companies: [],
    leaders: [],
    cybersecurity: {
      trends: [],
      adoption: null
    },
    motives: []
  };

  try {
    // Search for companies in the industry
    const companyQuery = `${area} companies`;
    const webResults = await searchWeb(companyQuery);

    // Extract companies from web results
    const companies = extractCompaniesFromWeb(webResults, area);
    result.companies = companies.slice(0, limit);

    // Search for cybersecurity trends in the industry
    const cyberQuery = `${area} cybersecurity trends 2026`;
    const cyberResults = await searchWeb(cyberQuery);
    result.cybersecurity = extractCybersecurityTrends(cyberResults);

    // Search for industry leaders
    const leaderQuery = `${area} industry leaders`;
    const leaderResults = await searchWeb(leaderQuery);
    result.leaders = extractIndustryLeaders(leaderResults);

    // Search for industry motives and drivers
    const motiveQuery = `${area} industry trends drivers`;
    const motiveResults = await searchWeb(motiveQuery);
    result.motives = extractMotives(motiveResults);

    // If LinkedIn is enabled, enrich with LinkedIn data
    if (options.linkedin) {
      // Search for companies on LinkedIn
      const linkedinCompanies = await searchLinkedIn(`${area} companies`, 'companies');

      // Merge with existing companies
      for (const lc of linkedinCompanies.slice(0, limit)) {
        const existingCompany = result.companies.find(c =>
          c.name.toLowerCase().includes(lc.name.toLowerCase()) ||
          lc.name.toLowerCase().includes(c.name.toLowerCase())
        );

        if (existingCompany) {
          existingCompany.linkedin = lc.url;
          existingCompany.description = lc.subtitle;
        } else if (result.companies.length < limit) {
          result.companies.push({
            name: lc.name,
            description: lc.subtitle,
            linkedin: lc.url,
            cybersecurity_focus: null
          });
        }
      }
    }

    return result;

  } catch (error) {
    throw new Error(`Failed to research industry: ${error.message}`);
  }
}

function extractCompaniesFromWeb(webResults, area) {
  const companies = [];
  const seenNames = new Set();

  for (const result of webResults) {
    const text = `${result.title} ${result.snippet}`;

    // Look for company names (capitalized words, possibly with spaces)
    const companyPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:Inc|LLC|Corp|Corporation|Ltd|Limited))?)\b/g;
    const matches = text.matchAll(companyPattern);

    for (const match of matches) {
      const name = match[1];

      // Skip common false positives
      if (name.length < 3 || seenNames.has(name) ||
          ['The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where', 'Why', 'How'].includes(name)) {
        continue;
      }

      seenNames.add(name);

      // Check if snippet mentions cybersecurity
      const snippet = result.snippet.toLowerCase();
      const hasCyberFocus = snippet.includes('security') ||
                           snippet.includes('cyber') ||
                           snippet.includes('encryption') ||
                           snippet.includes('zero trust');

      companies.push({
        name,
        description: result.snippet,
        url: result.url,
        cybersecurity_focus: hasCyberFocus ? 'mentioned' : null
      });

      if (companies.length >= 20) break;
    }

    if (companies.length >= 20) break;
  }

  return companies;
}

function extractCybersecurityTrends(cyberResults) {
  const trends = [];
  let adoption = null;

  for (const result of cyberResults) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Look for trend keywords
    const trendKeywords = [
      'zero trust',
      'ai security',
      'cloud security',
      'ransomware',
      'supply chain security',
      'identity management',
      'endpoint security',
      'threat detection',
      'security automation',
      'compliance'
    ];

    for (const keyword of trendKeywords) {
      if (text.includes(keyword) && !trends.some(t => t.toLowerCase().includes(keyword))) {
        trends.push(keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
      }
    }

    // Determine adoption level
    if (text.includes('rapid adoption') || text.includes('widespread')) {
      adoption = 'high';
    } else if (text.includes('growing') || text.includes('increasing')) {
      adoption = 'moderate';
    }
  }

  return {
    trends: trends.slice(0, 10),
    adoption: adoption || 'unknown'
  };
}

function extractIndustryLeaders(leaderResults) {
  const leaders = [];

  for (const result of leaderResults) {
    const text = result.snippet || '';

    // Look for people names and companies
    const namePattern = /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:,?\s+(?:CEO|CTO|CISO|President|Founder|Director))?\s+(?:of|at)\s+([A-Z][a-zA-Z0-9\s&]+)/g;
    const matches = text.matchAll(namePattern);

    for (const match of matches) {
      leaders.push({
        name: match[1],
        company: match[2].trim(),
        source: result.url
      });

      if (leaders.length >= 10) break;
    }

    if (leaders.length >= 10) break;
  }

  return leaders;
}

function extractMotives(motiveResults) {
  const motives = [];

  for (const result of motiveResults) {
    const text = `${result.title} ${result.snippet}`;

    // Look for motive/driver keywords
    const motiveKeywords = [
      'digital transformation',
      'cost reduction',
      'efficiency',
      'compliance',
      'competitive advantage',
      'innovation',
      'customer experience',
      'data protection',
      'risk management',
      'business continuity'
    ];

    for (const keyword of motiveKeywords) {
      if (text.toLowerCase().includes(keyword) &&
          !motives.some(m => m.toLowerCase().includes(keyword))) {
        motives.push({
          motive: keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          context: result.snippet
        });
      }
    }
  }

  return motives.slice(0, 8);
}
