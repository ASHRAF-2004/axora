import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";
import zapier from "zapier-platform-core";

import App from "../index.js";
import { AXORA_ORIGIN, AXORA_SCOPE } from "../constants.js";
import { addAxoraBearerToken } from "../middleware.js";

const appTester = zapier.createAppTester(App);
const clientId = `axora_client_${"a".repeat(24)}`;
const clientSecret = `axora_cs_${"b".repeat(43)}`;
const basicAuthorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

describe("Axora OAuth", () => {
  beforeAll(() => {
    nock.disableNetConnect();
    process.env.AXORA_OAUTH_CLIENT_ID = clientId;
    process.env.AXORA_OAUTH_CLIENT_SECRET = clientSecret;
  });

  beforeEach(() => nock.cleanAll());

  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    delete process.env.AXORA_OAUTH_CLIENT_ID;
    delete process.env.AXORA_OAUTH_CLIENT_SECRET;
  });

  it("uses Authorization Code with native PKCE and no password field", async () => {
    expect(App.authentication?.type).toBe("oauth2");
    expect(App.authentication?.fields).toEqual([]);
    expect(App.authentication?.oauth2Config?.enablePkce).toBe(true);
    expect(App.authentication?.oauth2Config?.scope).toBe(AXORA_SCOPE);

    const authorizationUrl = await appTester(
      App.authentication!.oauth2Config!.authorizeUrl as never,
      {
        inputData: {
          state: "state-fixture",
          redirect_uri: "https://zapier.com/dashboard/auth/oauth/return/AxoraCLIAPI/",
        },
      },
    );
    const parsed = new URL(String(authorizationUrl));
    expect(parsed.origin).toBe(AXORA_ORIGIN);
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe(clientId);
    expect(parsed.searchParams.get("state")).toBe("state-fixture");
    expect(parsed.searchParams.get("scope")).toBe(AXORA_SCOPE);
  });

  it("sends Zapier's generated PKCE verifier during code exchange", async () => {
    const tokenRequest = nock(AXORA_ORIGIN)
      .post("/oauth/token", (body) => body.grant_type === "authorization_code"
        && body.code === "authorization-code-fixture"
        && body.code_verifier === "pkce-verifier-fixture"
        && body.redirect_uri === "https://zapier.com/dashboard/auth/oauth/return/AxoraCLIAPI/")
      .matchHeader("authorization", basicAuthorization)
      .reply(200, {
        access_token: `axora_at_${"c".repeat(43)}`,
        refresh_token: `axora_rt_${"d".repeat(43)}`,
        token_type: "Bearer",
        expires_in: 900,
        scope: AXORA_SCOPE,
      });

    const result = await appTester(
      App.authentication!.oauth2Config!.getAccessToken as never,
      {
        inputData: {
          code: "authorization-code-fixture",
          code_verifier: "pkce-verifier-fixture",
          redirect_uri: "https://zapier.com/dashboard/auth/oauth/return/AxoraCLIAPI/",
        },
      },
    );
    expect(result).toMatchObject({ token_type: "Bearer", expires_in: 900 });
    expect(tokenRequest.isDone()).toBe(true);
  });

  it("requires and stores the rotated refresh token", async () => {
    const refreshRequest = nock(AXORA_ORIGIN)
      .post("/oauth/token", (body) => body.grant_type === "refresh_token"
        && body.refresh_token === `axora_rt_${"d".repeat(43)}`)
      .matchHeader("authorization", basicAuthorization)
      .reply(200, {
        access_token: `axora_at_${"e".repeat(43)}`,
        refresh_token: `axora_rt_${"f".repeat(43)}`,
        token_type: "Bearer",
        expires_in: 900,
        scope: AXORA_SCOPE,
      });

    const result = await appTester(
      App.authentication!.oauth2Config!.refreshAccessToken as never,
      {
        authData: {
          access_token: `axora_at_${"c".repeat(43)}`,
          refresh_token: `axora_rt_${"d".repeat(43)}`,
        },
      },
    );
    expect((result as { refresh_token: string }).refresh_token)
      .toBe(`axora_rt_${"f".repeat(43)}`);
    expect(refreshRequest.isDone()).toBe(true);
  });

  it("fails closed on malformed or overlong-lived token responses", async () => {
    const tokenRequest = nock(AXORA_ORIGIN)
      .post("/oauth/token")
      .reply(200, {
        access_token: "unexpected-provider-token",
        refresh_token: `axora_rt_${"d".repeat(43)}`,
        token_type: "Bearer",
        expires_in: 86_400,
        scope: `${AXORA_SCOPE} wallet:write`,
      });
    await expect(appTester(
      App.authentication!.oauth2Config!.getAccessToken as never,
      {
        inputData: {
          code: "authorization-code-fixture",
          code_verifier: "pkce-verifier-fixture",
          redirect_uri: "https://zapier.com/dashboard/auth/oauth/return/AxoraCLIAPI/",
        },
      },
    )).rejects.toThrow("invalid OAuth token response");
    expect(tokenRequest.isDone()).toBe(true);
  });

  it("never forwards a bearer token outside the fixed Axora API origin", async () => {
    const bundle = { authData: { access_token: "sensitive-token" } } as never;
    const apiRequest = await addAxoraBearerToken({
      url: `${AXORA_ORIGIN}/api/v1/me`,
      headers: {},
    }, {} as never, bundle);
    expect(apiRequest.headers?.Authorization).toBe("Bearer sensitive-token");

    const externalRequest = await addAxoraBearerToken({
      url: "https://attacker.example/api/v1/me",
      headers: {},
    }, {} as never, bundle);
    expect(externalRequest.headers).not.toHaveProperty("Authorization");

    const tokenRequest = await addAxoraBearerToken({
      url: `${AXORA_ORIGIN}/oauth/token`,
      headers: { Authorization: "Basic fixture" },
    }, {} as never, bundle);
    expect(tokenRequest.headers?.Authorization).toBe("Basic fixture");

    const preAuthorizedRequest = await addAxoraBearerToken({
      url: `${AXORA_ORIGIN}/api/v1/me`,
      headers: { authorization: "Bearer operation-owned-token" },
    }, {} as never, bundle);
    expect(preAuthorizedRequest.headers).toEqual({
      authorization: "Bearer operation-owned-token",
    });
  });
});
