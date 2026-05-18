/** @type {import('next').NextConfig} */
//
// Note: TeebeePay (payroll product) and Tee Bee Accountants (firm site)
// live as native Next.js pages under /teebeepay and /teebee — no external
// service to proxy to. The earlier /pngpay → Render rewrite was removed.
// /pngpay still works as a friendly URL via the redirect below.
const nextConfig = {
  // pdfkit needs its .afm font files (Helvetica, etc.) at runtime. Without
  // this, Vercel's serverless bundler strips them and the /api/teebee/brief
  // route 500s with "ENOENT Helvetica.afm". The glob below ships those files
  // alongside the function.
  experimental: {
    outputFileTracingIncludes: {
      "/api/teebee/brief": ["./node_modules/pdfkit/js/data/**/*"],
    },
  },
  async rewrites() {
    return [
      // Proxy capture links on www -> backend (api)
      {
        source: "/grading/capture/:path*",
        destination: "https://api.curriculate.net/grading/capture/:path*",
      },
    ];
  },
  async redirects() {
    return [
      // Old internal name kept as a permanent redirect to the public brand.
      { source: "/pngpay",        destination: "/teebeepay",        permanent: true },
      { source: "/pngpay/:path*", destination: "/teebeepay/:path*", permanent: true },
    ];
  },
};

module.exports = nextConfig;
