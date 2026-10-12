module.exports = {
  apps: [
    {
      name: "collab-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "collab-realtime",
      cwd: __dirname,
      script: "node",
      args: "realtime/server.mjs",
      env: {
        REALTIME_HOST: "0.0.0.0",
        REALTIME_PORT: "1234",
      },
    },
  ],
};