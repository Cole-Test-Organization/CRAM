import { searchLinkedIn, scrapeLinkedInProfile } from '../utils/browser.js';
import { searchWeb } from '../utils/web.js';
import { logger as rootLogger } from '../logger.js';

const logger = rootLogger.child({ component: 'person' });

export async function researchPerson(name, options = {}) {
  logger.info({ event: 'research.person.start', name }, 'starting research for person');

  const result = {
    name,
    source: 'web',
    profile: null,
    background: null,
    publicInfo: []
  };

  try {
    if (options.linkedin) {
      logger.debug({ company: options.company, title: options.title }, 'searching LinkedIn');

      // Build search query with filters
      let searchQuery = name;
      if (options.company) searchQuery += ` ${options.company}`;
      if (options.title) searchQuery += ` ${options.title}`;

      // Search LinkedIn for the person - returns raw page content
      const searchData = await searchLinkedIn(searchQuery, 'people', options);
      logger.debug({ event: 'research.person.linkedin_returned' }, 'LinkedIn search returned page content');

      // Return simplified structure - raw text for LLM to parse
      result.source = 'linkedin';
      result.linkedin = {
        search_url: searchData.url,
        search_query: searchData.query,
        search_results: {
          raw_text: searchData.pageContent.raw_text,
          instructions: "Parse the raw_text to extract: name, title/role, company, location for all people in results. Look for the person matching the search criteria."
        }
      };

      // Try to extract a profile URL from the search results for deeper research
      const profileUrl = extractProfileUrl(searchData.pageContent, options);

      if (profileUrl && options.deep) {
        logger.info({ event: 'research.person.deep_scrape', profileUrl }, 'scraping full profile');
        const profileData = await scrapeLinkedInProfile(profileUrl, options);

        result.linkedin.profile = {
          url: profileData.url,
          raw_text: profileData.raw_text,
          sections: profileData.sections,
          location: profileData.location,
          instructions: "Parse the sections to extract: current role, past experience (company, title, duration), education (school, degree, years), skills, certifications, and any relevant cybersecurity background. The `location` field is a best-guess location string already extracted from the header — verify against raw_text and split into normalized city/state/country before writing to the contact."
        };
      }
    }

    // Always do web search for additional context
    const webResults = await searchWeb(name);
    result.publicInfo = webResults;

    // Extract background from available data
    if (result.profile) {
      result.background = {
        currentPosition: result.profile.currentRole?.title || result.profile.headline,
        currentCompany: result.profile.currentRole?.company || null,
        location: result.profile.location,
        summary: result.profile.about || result.profile.headline
      };
    } else {
      // Try to extract from web results
      result.background = extractBackgroundFromWeb(webResults);
    }

    return result;

  } catch (error) {
    throw new Error(`Failed to research person: ${error.message}`);
  }
}

function extractProfileUrl(pageContent, options) {
  // Use the profile_links array extracted from the page
  const urls = pageContent.profile_links || [];

  // Also try structured items as backup
  if (pageContent.structured_items && pageContent.structured_items.length > 0) {
    for (const item of pageContent.structured_items) {
      if (item.links) {
        for (const link of item.links) {
          if (link.href && link.href.includes('/in/') && !link.href.includes('/search/')) {
            urls.push(link.href);
          }
        }
      }
    }
  }

  // Also try raw text as last resort
  const urlPattern = /https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g;
  const matches = pageContent.raw_text?.match(urlPattern);
  if (matches) {
    urls.push(...matches);
  }

  if (urls.length === 0) {
    logger.debug({ event: 'profile_url.none' }, 'no profile URLs found in search results');
    return null;
  }

  // Remove duplicates
  const uniqueUrls = [...new Set(urls)];
  logger.debug(
    { event: 'profile_url.found', count: uniqueUrls.length, sample: uniqueUrls.slice(0, 3), pick: uniqueUrls[0] },
    'found profile URLs; using first'
  );

  // Just return first URL - company filtering happens in the search query
  // so the top result should already be the right person
  return uniqueUrls[0];
}

function extractBackgroundFromWeb(webResults) {
  // Extract basic info from web search results
  const background = {
    currentPosition: null,
    currentCompany: null,
    location: null,
    summary: webResults[0]?.snippet || null
  };

  // Try to find position/company from snippets
  for (const result of webResults) {
    const snippet = result.snippet || '';

    // Look for common patterns like "CEO at Company" or "Software Engineer at Company"
    const rolePattern = /(CEO|CTO|CISO|Director|Manager|Engineer|Developer|Analyst|Consultant|VP|President|Founder)[\s]+(?:at|@|of)[\s]+([A-Z][a-zA-Z0-9\s&]+)/i;
    const match = snippet.match(rolePattern);

    if (match && !background.currentPosition) {
      background.currentPosition = match[1];
      background.currentCompany = match[2].trim();
      break;
    }
  }

  return background;
}
