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
      name: 'mirror-frontend',
      script: 'npx',
      args: 'vite preview --port 3000 --host',
      cwd: './frontend',
      max_memory_restart: '200M'
    }
  ]
};
