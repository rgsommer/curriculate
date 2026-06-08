/** @type {import('next').NextConfig} */
//
// Note: TeebeePay (payroll product) and TeeBee Accountants (firm site)
// live as native Next.js pages under /teebeepay and /teebee — no external
// service to proxy to. The earlier /pngpay → Render rewrite was removed.
// /pngpay still works as a friendly URL via the redirect below.
const nextConfig = {
  async rewrites() {
    return [
      // Proxy capture links on www -> backend (api)
      {
        source: "/grading/capture/:path*",
        destination: "https://api.curriculate.net/grading/capture/:path*",
      },
      // Oak Hill Academy microsite — static files in public/oakhill/.
      // Without these rewrites Next.js returns 404 for the bare /oakhill path
      // (it only serves /oakhill/index.html). These map clean URLs to the
      // underlying .html files so curriculate.net/oakhill/about works.
      { source: "/oakhill",            destination: "/oakhill/index.html" },
      { source: "/oakhill/about",      destination: "/oakhill/about.html" },
      { source: "/oakhill/academics",  destination: "/oakhill/academics.html" },
      { source: "/oakhill/admissions", destination: "/oakhill/admissions.html" },
      { source: "/oakhill/contact",    destination: "/oakhill/contact.html" },
      // Street Properties microsite — static files in public/streetproperties/.
      // Map clean URLs to the underlying .html files.
      { source: "/streetproperties",           destination: "/streetproperties/index.html" },
      { source: "/streetproperties/about",     destination: "/streetproperties/about.html" },
      { source: "/streetproperties/services",  destination: "/streetproperties/services.html" },
      { source: "/streetproperties/portfolio", destination: "/streetproperties/portfolio.html" },
      { source: "/streetproperties/contact",   destination: "/streetproperties/contact.html" },
    ];
  },
  async redirects() {
    return [
      // Old internal name kept as a permanent redirect to the public brand.
      { source: "/pngpay",        destination: "/teebeepay",        permanent: true },
      { source: "/pngpay/:path*", destination: "/teebeepay/:path*", permanent: true },
      // The Behaviours app lives at /behavior (singular); accept the plural too.
      { source: "/behaviors",        destination: "/behavior",        permanent: false },
      { source: "/behaviors/:path*", destination: "/behavior/:path*", permanent: false },
    ];
  },
};

module.exports = nextConfig;
