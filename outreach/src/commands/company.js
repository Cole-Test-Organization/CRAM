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
      result.source = 'linkedin';
      result.linkedin = { searches: [] };

      // Search for the company page and its leaders on LinkedIn.
      // searchLinkedIn returns raw page content for the LLM/agent to parse,
      // not a structured array — fold each search's raw_text + profile_links
      // into the result so downstream consumers can extract leaders/details.
      const linkedinSearches = [
        { query: name, type: 'companies' },
        { query: `${name} CEO`, type: 'people' },
        { query: `${name} CISO`, type: 'people' },
        { query: `${name} CTO`, type: 'people' }
      ];

      for (const { query, type } of linkedinSearches) {
        const searchData = await searchLinkedIn(query, type, options);
        result.linkedin.searches.push({
          query: searchData.query,
          type: searchData.type,
          search_url: searchData.url,
          raw_text: searchData.pageContent.raw_text,
          profile_links: searchData.pageContent.profile_links || [],
          instructions:
            "Parse the raw_text to extract the company page or its leaders (name, title/role, profile URL). Use profile_links for /in/ URLs. Match against the company being researched."
        });
      }
    }

    // Extract cybersecurity info from web results
    result.cybersecurity = extractCybersecurityInfo(cyberResults, webResults);

    // Extract initiatives from web results
    result.initiatives = extractInitiatives(webResults, cyberResults);

    // Best-effort structured leaders from web results; LinkedIn leader detail
    // lives in result.linkedin.searches as raw_text for the agent to parse.
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
