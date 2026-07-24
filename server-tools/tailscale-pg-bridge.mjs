import { spawn } from "node:child_process";
import net from "node:net";

const socketPath = process.env.TAILSCALE_SOCKET || "/tmp/axora-tailscaled.sock";
const databaseHost = process.env.TAILSCALE_DB_HOST || "axora-db";
const databasePort = Number(process.env.TAILSCALE_DB_PORT || 5432);
const listenHost = process.env.TAILSCALE_BRIDGE_HOST || "127.0.0.1";
const listenPort = Number(process.env.TAILSCALE_BRIDGE_PORT || 15432);

if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error("TAILSCALE_DB_PORT must be a valid TCP port.");
}
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  throw new Error("TAILSCALE_BRIDGE_PORT must be a valid TCP port.");
}

const children = new Set();

const server = net.createServer((clientSocket) => {
  const tunnel = spawn(
    "tailscale",
    ["--socket", socketPath, "nc", databaseHost, String(databasePort)],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(tunnel);

  let errorText = "";
  tunnel.stderr.setEncoding("utf8");
  tunnel.stderr.on("data", (chunk) => {
    if (errorText.length < 1000) errorText += chunk;
  });

  clientSocket.pipe(tunnel.stdin);
  tunnel.stdout.pipe(clientSocket);

  const closeTunnel = () => {
    if (!tunnel.killed) tunnel.kill("SIGTERM");
  };

  clientSocket.on("error", closeTunnel);
  clientSocket.on("close", closeTunnel);
  tunnel.stdin.on("error", () => {});
  tunnel.stdout.on("error", () => {});
  tunnel.on("error", () => clientSocket.destroy());
  tunnel.on("close", (code) => {
    children.delete(tunnel);
    if (code && errorText.trim()) {
      console.error(`Private database connection failed: ${errorText.trim()}`);
    }
    clientSocket.end();
  });
});

server.on("error", (error) => {
  console.error(`Private database bridge failed: ${error.message}`);
  process.exit(1);
});

server.listen(listenPort, listenHost, () => {
  console.log(`Private database bridge listening on ${listenHost}:${listenPort}.`);
});

function shutdown() {
  server.close();
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
