/**
 * Standalone port of the CRM's News feature (api/src/services/news/news.ts):
 * fetch Google News RSS for a company, rank headlines by a keyword rubric
 * (Apps Script runs on Google's servers and can't reach the local LLM the CRM
 * ranks with), render the result live. Nothing is stored.
 *
 * Deploy: paste into its own project at script.new → Deploy → Web app
 * (Execute as: Me · access: Only myself) → bookmark the /exec URL.
 * Params: ?company=Other+Co · ?format=json. Editor test: testInEditor().
 * Docs: google-scripts/news/README.md in the repo.
 */

// =============================== CONFIG ===============================

const COMPANY_NAME = 'Palo Alto Networks'; // default when no ?company= given
const MAX_ARTICLES = 40;

// Your terms. One score per headline; negative weight demotes.
const EXTRA_KEYWORDS = [
  // { label: 'firewall', pattern: /\bfirewalls?\b/i, weight: 15 },
];

// The CRM's default ranking prompt, as scoring tiers. Each match adds weight once.
const KEYWORD_TIERS = [
  {
    label: 'security incident',
    weight: 30,
    patterns: [
      /\bbreach(?:es|ed)?\b/i, /\bransomware\b/i, /\bdata leak\b/i,
      /\bleaked\b/i, /\bhack(?:ed|ers?|ing)?\b/i, /\bcyber ?attack/i,
      /\bCVE-\d/i, /\bvulnerabilit/i, /\bzero[- ]day\b/i, /\boutage\b/i,
      /\bsecurity incident\b/i, /\bextortion\b/i, /\bstolen\b/i,
      /\bexposed\b/i, /\bphishing\b/i, /\bmalware\b/i, /\bfined\b/i,
      /\blawsuit\b/i, /\bsettlement\b/i, /\bregulator/i, /\bcompliance\b/i,
      /\bGDPR\b/, /\bHIPAA\b/, /\binvestigation\b/i,
    ],
  },
  {
    label: 'leadership & structure',
    weight: 20,
    patterns: [
      /\bCISO\b/, /\bCIO\b/, /\bCTO\b/, /\bCEO\b/, /\bCFO\b/,
      /\bchief \w+ officer\b/i, /\bappoint(?:s|ed)?\b/i, /\bhire(?:s|d)\b/i,
      /\bresign/i, /\bsteps? down\b/i, /\bdepart(?:s|ure|ing)?\b/i,
      /\bacqui(?:res?|red|sition)\b/i, /\bmerger\b/i, /\bmerges? with\b/i,
      /\bfunding\b/i, /\braises? \$\d/i, /\blayoffs?\b/i, /\brestructur/i,
      /\bIPO\b/, /\btakeover\b/i, /\bexecutive\b/i,
    ],
  },
  {
    label: 'strategic signal',
    weight: 10,
    patterns: [
      /\blaunch(?:es|ed)?\b/i, /\bunveils?\b/i, /\brolls? out\b/i,
      /\bpartnership\b/i, /\bpartners? with\b/i, /\bcloud\b/i,
      /\bdigital transformation\b/i, /\bexpan(?:ds?|sion)\b/i,
      /\bearnings\b/i, /\brevenue\b/i, /\bnew product\b/i,
      /\bopens? new\b/i, /\binvest(?:s|ing|ment)\b/i,
    ],
  },
  {
    label: 'noise',
    weight: -25,
    patterns: [
      /\btop \d+\b/i, /\b\d+ best\b/i, /\bstocks?\b/i, /\bshares?\b/i,
      /\bprice target/i, /\btarget price/i, /\b(?:buy|sell|hold) rating\b/i,
      /\bPT\b/, /\banalyst/i, /\bdividend/i,
      /\bshort interest\b/i, /\b52[- ]week\b/i, /\bmarket cap\b/i,
      /\b(?:NASDAQ|NYSE):/, /\b(?:up|down)graded? (?:at|by)\b/i,
      /\b(?:over|under|equal ?)weight\b/i, /\boutperform\b/i,
      /\bthings to know\b/i, /\bhere'?s why\b/i,
    ],
  },
];

const DEMOTED_SOURCES = {
  weight: -20,
  names: [
    'Motley Fool', 'Simply Wall St', 'Zacks', 'Benzinga', 'MarketBeat',
    'TipRanks', 'Seeking Alpha', 'StockTitan', 'GuruFocus', 'Insider Monkey',
  ],
};

const COMPANY_IN_TITLE_BOOST = 12;
const RECENCY = { maxPoints: 15, halfLifeHours: 72 }; // halves every 72h

// ============================ ENTRY POINTS ============================

function doGet(e) {
  const params = (e && e.parameter) || {};
  const company =
    String(params.company || params.q || '').replace(/"/g, '').trim() || COMPANY_NAME;
  try {
    const ranked = rankArticles_(fetchGoogleNews_(company), company);
    if (String(params.format).toLowerCase() === 'json') {
      return ContentService.createTextOutput(
        JSON.stringify(toJsonPayload_(company, ranked), null, 2),
      ).setMimeType(ContentService.MimeType.JSON);
    }
    return HtmlService.createHtmlOutput(renderPage_(company, ranked))
      .setTitle('Top news — ' + company)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(renderError_(company, String(err && err.message || err)))
      .setTitle('Top news — error')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
}

function testInEditor() {
  const ranked = rankArticles_(fetchGoogleNews_(COMPANY_NAME), COMPANY_NAME);
  Logger.log('%s articles for "%s"', String(ranked.length), COMPANY_NAME);
  ranked.slice(0, 15).forEach(function (a, i) {
    Logger.log(
      '#%s [%s] %s  (%s)\n    %s',
      String(i + 1), String(a.score), a.title, a.source || '?',
      a.reasons.map(reasonText_).join(' · ') || 'no signals',
    );
  });
}

// ============================== PIPELINE ==============================

function fetchGoogleNews_(name) {
  const q = encodeURIComponent('"' + name + '"');
  const url = 'https://news.google.com/rss/search?q=' + q + '&hl=en-US&gl=US&ceid=US:en';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; se-operating-system-news/1.0)' },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Google News RSS returned HTTP ' + res.getResponseCode());
  }
  return parseRss_(res.getContentText()).slice(0, MAX_ARTICLES);
}

function parseRss_(xml) {
  let items;
  try {
    const channel = XmlService.parse(xml).getRootElement().getChild('channel');
    items = (channel ? channel.getChildren('item') : []).map(function (item) {
      return {
        title: String(item.getChildText('title') || '').trim(),
        url: String(item.getChildText('link') || '').trim(),
        source: String(item.getChildText('source') || '').trim() || null,
        published_at: toIso_(item.getChildText('pubDate')),
      };
    });
  } catch (err) {
    items = parseRssRegex_(xml); // fallback = the CRM's dependency-free parser
  }
  const seen = {};
  return items.filter(function (a) {
    if (!a.title || !a.url || seen[a.url]) return false;
    seen[a.url] = true;
    return true;
  });
}

function parseRssRegex_(xml) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: decodeEntities_(stripCdata_(extractTag_(block, 'title')) || '').trim(),
      url: decodeEntities_(stripCdata_(extractTag_(block, 'link')) || '').trim(),
      source: decodeEntities_(stripCdata_(extractTag_(block, 'source')) || '').trim() || null,
      published_at: toIso_(stripCdata_(extractTag_(block, 'pubDate'))),
    });
  }
  return items;
}

function extractTag_(block, tag) {
  const m = block.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1] : null;
}

function stripCdata_(s) {
  if (s == null) return null;
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function decodeEntities_(s) {
  return s
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function toIso_(rfc822) {
  if (!rfc822) return null;
  const d = new Date(String(rfc822).trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ============================== RANKING ===============================

function rankArticles_(articles, company) {
  const now = Date.now();
  return articles
    .map(function (a, i) {
      const scored = scoreArticle_(a, company, now);
      return {
        feedIndex: i,
        title: a.title, url: a.url, source: a.source, published_at: a.published_at,
        score: scored.score, reasons: scored.reasons,
      };
    })
    // ties keep feed order — the CRM's fallback when its LLM is unreachable
    .sort(function (x, y) { return (y.score - x.score) || (x.feedIndex - y.feedIndex); });
}

function scoreArticle_(article, company, nowMs) {
  let score = 0;
  const reasons = [];
  // score without the " - <Source>" title suffix, so a source named e.g.
  // "The Hacker News" doesn't award +30 to every one of its headlines
  const title = stripSourceSuffix_(article.title, article.source);

  KEYWORD_TIERS.forEach(function (tier) {
    tier.patterns.forEach(function (p) {
      const m = title.match(p);
      if (m) {
        score += tier.weight;
        reasons.push({ label: tier.label, text: m[0], points: tier.weight });
      }
    });
  });

  EXTRA_KEYWORDS.forEach(function (k) {
    const m = title.match(k.pattern);
    if (m) {
      score += k.weight;
      reasons.push({ label: k.label || 'your keyword', text: m[0], points: k.weight });
    }
  });

  if (article.source && DEMOTED_SOURCES.names.some(function (n) {
    return article.source.toLowerCase().indexOf(n.toLowerCase()) !== -1;
  })) {
    score += DEMOTED_SOURCES.weight;
    reasons.push({ label: 'stock-blog source', text: article.source, points: DEMOTED_SOURCES.weight });
  }

  if (new RegExp('\\b' + escapeRegex_(company) + '\\b', 'i').test(title)) {
    score += COMPANY_IN_TITLE_BOOST;
    reasons.push({ label: 'named in headline', text: company, points: COMPANY_IN_TITLE_BOOST });
  }

  if (article.published_at) {
    const ageHours = Math.max(0, (nowMs - new Date(article.published_at).getTime()) / 3.6e6);
    const pts = Math.round(RECENCY.maxPoints * Math.pow(0.5, ageHours / RECENCY.halfLifeHours));
    if (pts > 0) {
      score += pts;
      reasons.push({ label: 'recency', text: ageText_(ageHours), points: pts });
    }
  }

  return { score: score, reasons: reasons };
}

function stripSourceSuffix_(title, source) {
  if (source && title.slice(-(source.length + 3)) === ' - ' + source) {
    return title.slice(0, -(source.length + 3));
  }
  return title;
}

function escapeRegex_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ageText_(hours) {
  if (hours < 1) return 'under 1h old';
  if (hours < 48) return Math.round(hours) + 'h old';
  return Math.round(hours / 24) + 'd old';
}

function reasonText_(r) {
  return r.text + ' ' + (r.points > 0 ? '+' : '') + r.points;
}

// ============================= RENDERING ==============================

function toJsonPayload_(company, ranked) {
  return {
    company: company,
    fetched_at: new Date().toISOString(),
    article_count: ranked.length,
    articles: ranked.map(function (a, i) {
      return {
        rank: i, title: a.title, url: a.url, source: a.source,
        published_at: a.published_at, score: a.score,
        reasons: a.reasons.map(reasonText_),
      };
    }),
  };
}

function renderPage_(company, ranked) {
  const execUrl = ScriptApp.getService().getUrl() || '';
  const rows = ranked.map(function (a, i) {
    const chips = a.reasons.map(function (r) {
      return '<span class="chip' + (r.points < 0 ? ' neg' : '') + '" title="' +
        escapeHtml_(r.label) + '">' + escapeHtml_(reasonText_(r)) + '</span>';
    }).join(' ');
    return (
      '<li class="card">' +
      '<a class="headline" href="' + escapeHtml_(a.url) + '" target="_blank" rel="noopener">' +
      escapeHtml_(a.title) + '</a>' +
      '<div class="meta">#' + (i + 1) +
      ' · score <b>' + a.score + '</b>' +
      (a.source ? ' · ' + escapeHtml_(a.source) : '') +
      (a.published_at ? ' · ' + escapeHtml_(fmtWhen_(a.published_at)) : '') +
      '</div>' +
      (chips ? '<div class="chips">' + chips + '</div>' : '') +
      '</li>'
    );
  }).join('\n');

  return (
    '<style>' +
    'body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f5edd8;color:#33261f;' +
    'max-width:760px;margin:0 auto;padding:16px;}' +
    'h1{font-size:20px;margin:0 0 2px;}' +
    '.sub{font-size:12px;color:#6b5644;margin-bottom:14px;}' +
    'form{margin:0 0 16px;display:flex;gap:6px;}' +
    'input[type=text]{flex:1;font:inherit;font-size:16px;padding:6px 8px;border:2px solid #33261f;' +
    'border-radius:0;background:#fffaf0;color:inherit;min-width:0;}' +
    'button{font:inherit;padding:6px 12px;border:2px solid #33261f;border-radius:0;' +
    'background:#b45309;color:#fffaf0;box-shadow:2px 2px 0 #33261f;cursor:pointer;}' +
    'ol{list-style:none;padding:0;margin:0;}' +
    '.card{border:2px solid #33261f;box-shadow:3px 3px 0 #33261f;background:#fffaf0;' +
    'padding:10px 12px;margin-bottom:12px;}' +
    '.headline{color:#92400e;font-weight:bold;text-decoration:none;overflow-wrap:anywhere;}' +
    '.headline:hover{text-decoration:underline;}' +
    '.meta{font-size:12px;color:#6b5644;margin-top:4px;}' +
    '.chips{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;}' +
    '.chip{font-size:11px;border:1px solid #33261f;background:#f0e2c4;padding:0 5px;}' +
    '.chip.neg{background:#e7d3cf;}' +
    '.foot{font-size:11px;color:#6b5644;margin:18px 0;}' +
    '</style>' +
    '<h1>Top news — ' + escapeHtml_(company) + '</h1>' +
    '<div class="sub">' + ranked.length + ' articles · fetched live ' +
    escapeHtml_(fmtWhen_(new Date().toISOString())) + '</div>' +
    (execUrl
      ? '<form method="get" action="' + escapeHtml_(execUrl) + '" target="_top">' +
        '<input type="text" name="company" placeholder="Another company…" ' +
        'value="' + escapeHtml_(company) + '"><button type="submit">Fetch</button></form>'
      : '') +
    (ranked.length ? '<ol>' + rows + '</ol>'
      : '<p>No articles found. Try a different company spelling.</p>') +
    '<div class="foot">Google News RSS · ranked by the keyword rubric in CONFIG · ' +
    'chips show why each item scored</div>'
  );
}

function renderError_(company, message) {
  return (
    '<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f5edd8;' +
    'color:#33261f;max-width:760px;margin:0 auto;padding:16px;}' +
    '.err{border:2px solid #33261f;box-shadow:3px 3px 0 #33261f;background:#e7d3cf;padding:12px;}</style>' +
    '<h1>Top news — ' + escapeHtml_(company) + '</h1>' +
    '<div class="err"><b>Fetch failed:</b> ' + escapeHtml_(message) +
    '<br><br>Reload to retry — Google News hiccups are transient.</div>'
  );
}

function fmtWhen_(iso) {
  const tz = Session.getScriptTimeZone() || 'Etc/UTC';
  return Utilities.formatDate(new Date(iso), tz, 'MMM d, h:mm a');
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
