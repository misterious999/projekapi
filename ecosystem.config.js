'use strict';

module.exports = {
  apps: [
    {
      name: 'zeroixapi',
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
      error_file: 'logs/zeroixapi-error.log',
      out_file: 'logs/zeroixapi-out.log',
      merge_logs: true,
    },
  ],
};
