/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Proxy capture links on www -> backend (api)
      {
        source: "/grading/capture/:path*",
        destination: "https://api.curriculate.net/grading/capture/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
