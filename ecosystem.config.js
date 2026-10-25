'use strict';

module.exports = {
  apps: [
    {
      name: 'nusaapi',
      script: 'app.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/nusaapi-error.log',
      out_file: 'logs/nusaapi-out.log',
      merge_logs: true,
    },
  ],
};
