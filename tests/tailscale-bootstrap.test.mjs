import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureTailscale } from "../server-tools/configure-tailscale.mjs";

describe("Tailscale hybrid bootstrap", () => {
  const temporaryDirectories = [];
  const servers = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ));
    await Promise.all(temporaryDirectories.splice(0).map(
      (directory) => rm(directory, { force: true, recursive: true }),
    ));
  });

  it("applies the restricted policy, protects both keys, and revokes the API token", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "axora-tailscale-test-"));
    temporaryDirectories.push(projectDir);
    await mkdir(path.join(projectDir, "tailscale"));
    const targetPolicy = JSON.stringify({
      acls: [],
      tagOwners: {
        "tag:axora-db": ["autogroup:admin"],
        "tag:axora-render": ["autogroup:admin"],
      },
      grants: [{
        src: ["tag:axora-render"],
        dst: ["tag:axora-db"],
        ip: ["tcp:5432"],
      }],
      tests: [{
        src: "tag:axora-render",
        proto: "tcp",
        accept: ["tag:axora-db:5432"],
        deny: ["tag:axora-db:22"],
      }],
    });
    await writeFile(path.join(projectDir, "tailscale", "policy.hujson"), targetPolicy);

    const requests = [];
    let keyNumber = 0;
    let policyApplied = false;
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        body,
        headers: request.headers,
        method: request.method,
        url: request.url,
      });

      expect(request.headers.authorization).toBe("Bearer tskey-api-TESTID-testsecret");
      if (request.method === "GET" && request.url === "/api/v2/tailnet/-/acl") {
        response.setHeader("etag", "\"policy-v1\"");
        response.end(policyApplied
          ? targetPolicy
          : '{"acls":[{"action":"accept","src":["*"],"dst":["*:*"]}]}');
        return;
      }
      if (
        request.method === "POST"
        && ["/api/v2/tailnet/-/acl/validate", "/api/v2/tailnet/-/acl"].includes(request.url)
      ) {
        if (request.url === "/api/v2/tailnet/-/acl") policyApplied = true;
        response.end("{}");
        return;
      }
      if (request.method === "POST" && request.url === "/api/v2/tailnet/-/keys") {
        keyNumber += 1;
        const requestBody = JSON.parse(body);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          id: `KEY${keyNumber}`,
          key: `tskey-auth-KEY${keyNumber}-secret${keyNumber}`,
          keyType: "auth",
          capabilities: requestBody.capabilities,
          expirySeconds: requestBody.expirySeconds,
          expires: new Date(Date.now() + requestBody.expirySeconds * 1000).toISOString(),
        }));
        return;
      }
      if (
        request.method === "DELETE"
        && request.url === "/api/v2/tailnet/-/keys/TESTID"
      ) {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");

    const result = await configureTailscale({
      apiToken: "tskey-api-TESTID-testsecret",
      projectDir,
      apiBaseUrl: `http://127.0.0.1:${address.port}/api/v2`,
      log: () => {},
      warn: () => {},
    });

    expect(result.apiTokenRevoked).toBe(true);
    expect(await readFile(
      path.join(projectDir, "secrets", "tailscale_db_auth_key"),
      "utf8",
    )).toBe("tskey-auth-KEY1-secret1\n");
    expect(await readFile(
      path.join(projectDir, "secrets", "tailscale_render_auth_key"),
      "utf8",
    )).toBe("tskey-auth-KEY2-secret2\n");
    expect((await stat(
      path.join(projectDir, "secrets", "tailscale_db_auth_key"),
    )).mode & 0o777).toBe(0o600);
    expect((await stat(
      path.join(projectDir, "secrets", "tailscale_render_auth_key"),
    )).mode & 0o777).toBe(0o600);

    const keyRequests = requests
      .filter((request) => request.method === "POST" && request.url.endsWith("/keys"))
      .map((request) => JSON.parse(request.body));
    expect(keyRequests).toHaveLength(2);
    expect(keyRequests[0].keyType).toBe("auth");
    expect(keyRequests[0].capabilities.devices.create).toEqual({
      reusable: false,
      ephemeral: false,
      preauthorized: true,
      tags: ["tag:axora-db"],
    });
    expect(keyRequests[1].keyType).toBe("auth");
    expect(keyRequests[1].capabilities.devices.create).toEqual({
      reusable: true,
      ephemeral: true,
      preauthorized: true,
      tags: ["tag:axora-render"],
    });

    const policyRequest = requests.find(
      (request) => request.method === "POST" && request.url.endsWith("/acl"),
    );
    expect(policyRequest.body).toBe(targetPolicy);
    expect(policyRequest.headers["if-match"]).toBe("\"policy-v1\"");
    const backupNames = await readdir(path.join(projectDir, "backups"));
    expect(backupNames.some((name) => name.startsWith("tailscale-policy-before-axora-")))
      .toBe(true);
    expect(requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: "/api/v2/tailnet/-/keys/TESTID",
    });
  });
});
