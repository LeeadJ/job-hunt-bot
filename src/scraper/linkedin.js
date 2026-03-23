import * as cheerio from 'cheerio';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// Rate limiter — track scrapes per hour
let scrapeCount = 0;
let scrapeWindowStart = Date.now();

function checkRateLimit() {
  const elapsed = Date.now() - scrapeWindowStart;
  if (elapsed > 3600000) {
    scrapeCount = 0;
    scrapeWindowStart = Date.now();
  }
  if (scrapeCount >= config.scraping.maxPerHour) {
    throw new Error(`Rate limit: ${config.scraping.maxPerHour} scrapes/hour exceeded. Try again later.`);
  }
  scrapeCount++;
}

/**
 * Extract LinkedIn job ID from various URL formats.
 */
export function extractJobId(url) {
  const match = url.match(/(?:jobs\/view\/(?:.*?[-/])?|currentJobId=)(\d{8,12})/);
  return match ? match[1] : null;
}

/**
 * Validate that a string looks like a LinkedIn job URL.
 */
export function isLinkedInJobUrl(text) {
  return /linkedin\.com\/jobs\/view\//.test(text) ||
         /linkedin\.com\/jobs\/search\/.*currentJobId=/.test(text);
}

/**
 * Extract all LinkedIn job URLs from a message (supports bulk paste).
 */
export function extractUrls(text) {
  const urlRegex = /https?:\/\/(?:www\.)?linkedin\.com\/jobs\/(?:view|search)[^\s)>\]"]*/gi;
  return [...new Set(text.match(urlRegex) || [])];
}

/**
 * Scrape job details from a LinkedIn job posting.
 * Strategy: RapidAPI (if configured) → fetch public page → parse HTML.
 */
export async function scrapeJob(url) {
  checkRateLimit();

  // Try RapidAPI first if configured (most reliable)
  if (config.rapidApi.key) {
    try {
      return await scrapeViaApi(url);
    } catch (err) {
      logger.warn('RapidAPI scrape failed, falling back to fetch', { error: err.message });
    }
  }

  return await scrapeViaFetch(url);
}

/**
 * Scrape using fetch + cheerio (no browser needed).
 * LinkedIn serves SEO-friendly HTML with meta tags and JSON-LD
 * to non-browser user agents on public job pages.
 */
async function scrapeViaFetch(url) {
  const jobId = extractJobId(url);
  // Use the canonical public URL format
  const publicUrl = jobId
    ? `https://www.linkedin.com/jobs/view/${jobId}`
    : url;

  try {
    const response = await fetch(publicUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`LinkedIn returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Check for login wall
    if (html.includes('authwall') || html.includes('/login') && !html.includes('top-card-layout')) {
      throw new Error('LinkedIn returned a login wall — public page not available');
    }

    // Try JSON-LD structured data first (most reliable, used for SEO)
    let jsonLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data['@type'] === 'JobPosting') {
          jsonLd = data;
        }
      } catch { /* ignore parse errors */ }
    });

    let title, company, location, description;

    if (jsonLd) {
      title = jsonLd.title || '';
      company = jsonLd.hiringOrganization?.name || '';
      location = jsonLd.jobLocation?.address?.addressLocality ||
                 jsonLd.jobLocation?.address?.name || '';
      description = jsonLd.description || '';
      // Strip HTML tags from description
      description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      // Fallback: parse HTML selectors (LinkedIn guest view classes)
      title =
        $('.top-card-layout__title').text().trim() ||
        $('.topcard__title').text().trim() ||
        $('h1').first().text().trim() ||
        '';

      company =
        $('a.topcard__org-name-link').text().trim() ||
        $('a.top-card-layout__company-url').text().trim() ||
        $('.topcard__flavor a').first().text().trim() ||
        '';

      location =
        $('span.topcard__flavor--bullet').text().trim() ||
        $('span.top-card-layout__bullet').text().trim() ||
        '';

      description =
        $('.description__text').text().trim() ||
        $('.show-more-less-html__markup').text().trim() ||
        '';
    }

    // Also try og: meta tags as another fallback
    if (!title) title = $('meta[property="og:title"]').attr('content') || 'Unknown Role';
    if (!company) company = $('meta[property="og:description"]').attr('content')?.split(' at ')?.[1]?.split(' in ')?.[0] || 'Unknown Company';

    // Extract seniority from criteria list or title
    const seniority = extractSeniorityFromHtml($, title);

    const criteria = [];
    $('li.description__job-criteria-item').each((_, el) => {
      const label = $(el).find('.description__job-criteria-subheader').text().trim();
      const value = $(el).find('.description__job-criteria-text').text().trim();
      if (label && value) criteria.push({ label, value });
    });

    const techStack = extractTechStack(description);

    await delay(config.scraping.delayMs);

    return {
      title: cleanText(title) || 'Unknown Role',
      company: cleanText(company) || 'Unknown Company',
      location: cleanText(location),
      seniority,
      description: description.slice(0, 500),
      criteria,
      techStack,
      url,
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('Fetch scrape failed', { url, error: err.message });
    throw new Error(`Could not scrape job details: ${err.message}`);
  }
}

/**
 * Scrape using RapidAPI LinkedIn Jobs endpoint (paid but reliable).
 */
async function scrapeViaApi(url) {
  const jobId = extractJobId(url);
  if (!jobId) throw new Error('Could not extract job ID from URL');

  const response = await fetch(
    `https://linkedin-api8.p.rapidapi.com/get-job-details?id=${jobId}`,
    {
      headers: {
        'X-RapidAPI-Key': config.rapidApi.key,
        'X-RapidAPI-Host': 'linkedin-api8.p.rapidapi.com',
      },
    }
  );

  if (!response.ok) throw new Error(`API returned ${response.status}`);

  const data = await response.json();

  return {
    title: data.title || 'Unknown Role',
    company: data.company?.name || 'Unknown Company',
    location: data.location || '',
    seniority: data.seniorityLevel || extractSeniorityFromTitle(data.title || ''),
    description: (data.description || '').slice(0, 500),
    criteria: [],
    techStack: extractTechStack(data.description || ''),
    url,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Extract seniority level from page content or title.
 */
function extractSeniorityFromHtml($, title) {
  const seniorityEl = $('li.description__job-criteria-item')
    .filter((_, el) => $(el).find('.description__job-criteria-subheader').text().includes('Seniority'))
    .find('.description__job-criteria-text')
    .text()
    .trim();

  if (seniorityEl) return seniorityEl;

  return extractSeniorityFromTitle(title);
}

function extractSeniorityFromTitle(title) {
  const t = title.toLowerCase();
  if (t.includes('intern') || t.includes('student')) return 'Student/Intern';
  if (t.includes('junior') || t.includes('jr.') || t.includes('entry')) return 'Junior';
  if (t.includes('senior') || t.includes('sr.')) return 'Senior';
  if (t.includes('lead') || t.includes('principal') || t.includes('staff')) return 'Lead';
  return 'Mid';
}

/**
 * Extract tech stack keywords from job description.
 */
function extractTechStack(description) {
  const techKeywords = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', '.NET', 'Go', 'Rust',
    'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Next.js', 'NestJS',
    'PostgreSQL', 'MongoDB', 'Redis', 'MySQL', 'SQL Server', 'DynamoDB',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform',
    'GraphQL', 'REST', 'gRPC', 'Kafka', 'RabbitMQ',
    'CI/CD', 'Jenkins', 'GitHub Actions', 'Linux',
  ];

  const descLower = description.toLowerCase();
  const found = techKeywords.filter((tech) =>
    descLower.includes(tech.toLowerCase())
  );

  return found.join(', ');
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
