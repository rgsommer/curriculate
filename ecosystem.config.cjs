// PM2 ecosystem config for Curriculate production deployment
// Usage: pm2 start ecosystem.config.cjs --env production
//
// AWS EC2 recommended:
//   1. sudo apt install -y nodejs npm nginx
//   2. npm install -g pm2
//   3. pm2 start ecosystem.config.cjs --env production
//   4. pm2 save && pm2 startup   ← auto-restart on reboot
//
// IMPORTANT: Socket.io requires sticky sessions for multi-process mode.
// Set instances > 1 only if you're using the Redis adapter for Socket.io.
// Until then, keep instances: 1 (single process, single core).

module.exports = {
  apps: [
    {
      name: "curriculate-backend",
      script: "./index.js",
      cwd: require("path").join(__dirname, "backend"),

      // ── Process model ──────────────────────────────────────────────
      // Socket.io with in-memory rooms requires a single process.
      // To scale to multiple cores you'd add the Socket.io Redis adapter
      // and set instances: "max" + exec_mode: "cluster".
      instances: 1,
      exec_mode: "fork",

      // ── Runtime ────────────────────────────────────────────────────
      interpreter: "node",
      interpreter_args: "--max-old-space-size=512",

      // ── Restart policy ─────────────────────────────────────────────
      watch: false,                    // never watch files in production
      max_memory_restart: "512M",      // restart if RSS exceeds 512 MB
      restart_delay: 3000,             // wait 3 s before auto-restart
      max_restarts: 10,                // give up after 10 crashes in a row
      min_uptime: "10s",               // must be up 10 s before restart counter resets

      // ── Logging ────────────────────────────────────────────────────
      out_file: require("path").join(__dirname, "logs/curriculate-out.log"),
      error_file: require("path").join(__dirname, "logs/curriculate-err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // ── Environment ────────────────────────────────────────────────
      env: {
        NODE_ENV: "development",
        PORT: 4000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 10000,
      },
    },
  ],
};
