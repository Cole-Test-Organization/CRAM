import { searchLinkedIn } from '../utils/browser.js';
import { searchWeb } from '../utils/web.js';

export async function researchCompany(name, options = {}) {
  const result = {
    name,
    source: 'web',
    leaders: [],
    initiatives: [],
    cybersecurity: {
      adoption: null,
      initiatives: [],
      leaders: []
    },
    publicInfo: []
  };

  try {
    // Web search for company information
    const webResults = await searchWeb(`${name} company`);
    result.publicInfo = webResults;

    // Search for cybersecurity info
    const cyberResults = await searchWeb(`${name} cybersecurity initiatives`);

    if (options.linkedin) {
      // Search for company page on LinkedIn
      const companyResults = await searchLinkedIn(name, 'companies');

      if (companyResults.length > 0) {
        result.source = 'linkedin';

        // Search for leaders of the company
        const leaderSearches = [
          `${name} CEO`,
          `${name} CISO`,
          `${name} CTO`
        ];

        for (const query of leaderSearches) {
          const leaders = await searchLinkedIn(query, 'people');
          if (leaders.length > 0) {
            result.leaders.push(...leaders.slice(0, 2).map(l => ({
              name: l.name,
              title: l.subtitle,
              url: l.url
            })));
          }
        }
      }
    }

    // Extract cybersecurity info from web results
    result.cybersecurity = extractCybersecurityInfo(cyberResults, webResults);

    // Extract initiatives from web results
    result.initiatives = extractInitiatives(webResults, cyberResults);

    // If no LinkedIn leaders found, try to extract from web
    if (result.leaders.length === 0) {
      result.leaders = extractLeadersFromWeb(webResults);
    }

    return result;

  } catch (error) {
    throw new Error(`Failed to research company: ${error.message}`);
  }
}

function extractCybersecurityInfo(cyberResults, generalResults) {
  const info = {
    adoption: null,
    initiatives: [],
    leaders: []
  };

  // Look for cybersecurity mentions
  const allResults = [...cyberResults, ...generalResults];

  for (const result of allResults) {
    const snippet = (result.snippet || '').toLowerCase();

    // Check for cybersecurity adoption signals
    if (snippet.includes('zero trust') || snippet.includes('security framework') ||
        snippet.includes('iso 27001') || snippet.includes('soc 2')) {
      info.adoption = 'active';

      // Extract specific initiatives
      if (snippet.includes('zero trust')) {
        info.initiatives.push('Zero Trust Architecture');
      }
      if (snippet.includes('iso 27001')) {
        info.initiatives.push('ISO 27001 Certification');
      }
      if (snippet.includes('soc 2')) {
        info.initiatives.push('SOC 2 Compliance');
      }
    }

    // Look for CISO or security leaders
    const cisoPattern = /CISO|Chief Information Security Officer|Head of Security|VP of Security|Director of Security/i;
    if (cisoPattern.test(result.snippet || '')) {
      const nameMatch = (result.title || '').match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
      if (nameMatch) {
        info.leaders.push({
          name: nameMatch[0],
          title: 'Security Leadership'
        });
      }
    }
  }

  return info;
}

function extractInitiatives(webResults, cyberResults) {
  const initiatives = [];
  const allResults = [...webResults, ...cyberResults];

  for (const result of allResults) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Look for initiative keywords
    if (text.includes('launch') || text.includes('initiative') ||
        text.includes('announce') || text.includes('program')) {
      initiatives.push({
        title: result.title,
        description: result.snippet,
        url: result.url
      });
    }
  }

  return initiatives.slice(0, 5);
}

function extractLeadersFromWeb(webResults) {
  const leaders = [];

  for (const result of webResults) {
    const snippet = result.snippet || '';

    // Look for executive titles
    const titlePattern = /(CEO|CTO|CISO|CFO|COO|President|Founder)[\s:]+([A-Z][a-z]+\s+[A-Z][a-z]+)/i;
    const match = snippet.match(titlePattern);

    if (match) {
      leaders.push({
        title: match[1],
        name: match[2].trim()
      });
    }
  }

  return leaders.slice(0, 5);
}
