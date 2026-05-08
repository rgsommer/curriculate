import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/admin/",
          "/billing/",
          "/dashboard",
          "/dashboard/",
          "/grading/capture/",
          "/login",
          "/login/",
          "/practice-dashboard",
          "/practice-dashboard/",
          "/progress",
          "/progress/",
          "/results/",          // per-student result pages — private content
          "/reports",           // teacher's authenticated reports list
          "/reports/",
          "/campfirelive/group/",
          "/campfirelive/auth/",
          "/campfirelive/join/",
          "/campfirelive/settings/",
          "/termsofservice",    // legacy alias canonicalized to /terms
        ],
      },
    ],
    sitemap: "https://curriculate.net/sitemap.xml",
  };
}
