import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/grading/capture/",
          "/campfirelive/group/",   // Don't index user-specific group pages
          "/campfirelive/auth/",
          "/campfirelive/join/",
          "/campfirelive/settings/",
        ],
      },
    ],
    sitemap: "https://curriculate.net/sitemap.xml",
  };
}
