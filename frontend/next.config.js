/** @type {import('next').NextConfig} */
//
// PNGPay note: /pngpay/* proxies to the PNGPay service on Render
// (multi-tenant payroll bureau — see pngpay/ in this repo). The hostname
// below must match the Render service name. After the first Render deploy,
// if Render assigned a different subdomain (e.g. pngpay-abc1.onrender.com),
// update PNGPAY_ORIGIN here or set the env var in Vercel.
const PNGPAY_ORIGIN = process.env.PNGPAY_ORIGIN || "https://pngpay.onrender.com";

const nextConfig = {
  async rewrites() {
    return [
      // Proxy capture links on www -> backend (api)
      {
        source: "/grading/capture/:path*",
        destination: "https://api.curriculate.net/grading/capture/:path*",
      },
      // PNGPay (Render Web Service)
      { source: "/pngpay",         destination: `${PNGPAY_ORIGIN}/pngpay` },
      { source: "/pngpay/:path*",  destination: `${PNGPAY_ORIGIN}/pngpay/:path*` },
    ];
  },
};

module.exports = nextConfig;
