module.exports = {
  apps: [
    {
      name: 'mirror-backend',
      script: 'backend/server.js',
      wait_ready: true,
      listen_timeout: 10000,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      env_development: { NODE_ENV: 'development' }
    },
    {
      // Warm yt-dlp resolver: keeps Python + yt_dlp imported so a track
      // conversion costs ~4-6s instead of ~20s on a Pi 2 (see the script's
      // docstring). The backend falls back to spawning the yt-dlp CLI when
      // this is down, so a missing venv on dev machines is not fatal.
      name: 'yt-dlp-daemon',
      script: 'backend/bin/yt-dlp-daemon.py',
      interpreter: process.env.YTDLP_DAEMON_PYTHON || '/opt/yt-dlp-venv/bin/python',
      max_memory_restart: '250M',
      autorestart: true
    },
    {
      name: 'mirror-frontend',
      script: 'npx',
      args: 'vite preview --port 3000 --host',
      cwd: './frontend',
      max_memory_restart: '200M'
    }
  ]
};
