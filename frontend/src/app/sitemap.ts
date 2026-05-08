import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://curriculate.net";
  const now = new Date();

  return [
    // ── Top-level marketing pages ──
    { url: baseUrl, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/features`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/freetrial`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/preview`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/preptime`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/pedagogy`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/parties`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/events`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${baseUrl}/referrals`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/investors`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },

    // ── Pulse Grading product ──
    { url: `${baseUrl}/pulse`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/ai-grading`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },

    // ── Compare pages (one per competitor + summary) ──
    { url: `${baseUrl}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/compare/kahoot`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/compare/quizlet`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/compare/blooket`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/compare/worksheets`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/compare/one-pager`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },

    // ── Sample reports (PDFs and HTML preview, helps surface the artifacts) ──
    { url: `${baseUrl}/sample-report.html`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },

    // ── Legal ──
    { url: `${baseUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },

    // ── Campfire (separate product surface) ──
    { url: `${baseUrl}/aboutcampfire`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/campfire`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/campfirelive`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
  ];
}
