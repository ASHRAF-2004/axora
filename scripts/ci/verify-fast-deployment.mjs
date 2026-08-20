import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function temporaryRoot(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

async function writePrivateConfig(root, values = {}) {
  const config = path.join(root, "deploy.env");
  const defaults = {
    AXORA_STATE_ROOT: path.join(root, "state"),
    AXORA_LOG_ROOT: path.join(root, "log"),
    AXORA_BUILD_HOME: path.join(root, "build"),
    AXORA_SECRETS_DIR: path.join(root, "secrets"),
    AXORA_RUNTIME_ROOT: path.join(root, "runtime"),
    ...values,
  };
  await writeFile(config, Object.entries(defaults).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  await chmod(config, 0o600);
  return config;
}

async function installFakeRootIdentity(bin) {
  await mkdir(bin, { recursive: true });
  const fakeId = path.join(bin, "id");
  await writeFile(fakeId, `#!/usr/bin/env bash
if [[ "\${1:-}" == -u ]]; then
  printf '0\\n'
else
  exec /usr/bin/id "$@"
fi
`);
  await chmod(fakeId, 0o755);
  const fakeStat = path.join(bin, "stat");
  await writeFile(fakeStat, `#!/usr/bin/env bash
if [[ "\${1:-}" == -c && "\${2:-}" == %u && "\${3:-}" == */deploy.env ]]; then
  printf '0\\n'
else
  exec /usr/bin/stat "$@"
fi
`);
  await chmod(fakeStat, 0o755);
}

test("builds the application once and deploys the resulting digest", async () => {
  const [workflow, deploy] = await Promise.all([
    readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../production/deploy.sh", import.meta.url), "utf8"),
  ]);
  assert.equal(workflow.match(/docker\/build-push-action@/g)?.length, 1);
  assert.match(workflow, /push: \$\{\{ github\.event_name == 'push' \}\}/);
  assert.match(workflow, /steps\.build\.outputs\.digest/);
  assert.doesNotMatch(workflow, /npm run (lint|typecheck|test)/);
  assert.match(deploy, /docker pull "\$AXORA_IMAGE"/);
  assert.match(deploy, /org\.opencontainers\.image\.revision/);
  assert.doesNotMatch(deploy, /docker build(?:x)? /);
});

test("production deployment uses environment-scoped OIDC Tailscale access", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /id-token: write/);
  assert.match(
    workflow,
    /tailscale\/github-action@a392da0a182bba0e9613b6243ebd69529b1878aa/,
  );
  assert.match(workflow, /oauth-client-id: \$\{\{ secrets\.TS_OAUTH_CLIENT_ID \}\}/);
  assert.match(workflow, /audience: \$\{\{ secrets\.TS_AUDIENCE \}\}/);
  assert.match(workflow, /tags: tag:axora-github-deploy/);
  assert.match(workflow, /ping: \$\{\{ vars\.PRODUCTION_TAILSCALE_HOST \}\}/);
  assert.match(workflow, /PRODUCTION_SSH_HOST: \$\{\{ vars\.PRODUCTION_TAILSCALE_HOST \}\}/);
  assert.doesNotMatch(workflow, /TS_OAUTH_SECRET|oauth-secret:|authkey:/);
  assert.doesNotMatch(workflow, /secrets\.PRODUCTION_SSH_HOST/);
});

test("controller installation does not activate the deployment cutover", async () => {
  const installer = await readFile(
    new URL("../production/install.sh", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(installer, /systemctl disable --now axora-deploy/);
  assert.doesNotMatch(installer, /rm -f -- .*axora-deploy\.timer/);
  assert.match(installer, /Legacy polling deployment remains enabled until explicit cutover/);
});

test("public source keeps production credentials and GHCR access private", async () => {
  const [architecture, migrationPlan, runbook] = await Promise.all([
    readFile(new URL("../../docs/PRODUCTION_ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/MIGRATION_PLAN.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/PRODUCTION_RUNBOOK.md", import.meta.url), "utf8"),
  ]);
  assert.match(architecture, /source repository remains public/);
  assert.match(architecture, /granular permissions without inheriting/);
  assert.match(architecture, /repository_visibility=public/);
  assert.match(migrationPlan, /intentionally remains public/);
  assert.match(migrationPlan, /Build immutable production image/);
  assert.match(runbook, /public repository contains no production credential or secret/);
  assert.match(runbook, /production pull identity read access only/);
  assert.doesNotMatch(migrationPlan, /Change the repository to private/);
  assert.doesNotMatch(runbook, /GitHub repository is private/);
});

test("GHCR pull credential stays root-only and outside runtime secrets", async () => {
  const [template, library, preflight] = await Promise.all([
    readFile(new URL("../../deploy/systemd/deploy.env.example", import.meta.url), "utf8"),
    readFile(new URL("../production/lib.sh", import.meta.url), "utf8"),
    readFile(new URL("../production/preflight.sh", import.meta.url), "utf8"),
  ]);
  const templateRequired = template.match(/^AXORA_REQUIRED_SECRETS=(.*)$/mu)?.[1] ?? "";
  const libraryDefault = library.match(/AXORA_REQUIRED_SECRETS:=([^}]*)/u)?.[1] ?? "";
  assert.doesNotMatch(templateRequired, /ghcr_read_token/);
  assert.doesNotMatch(libraryDefault, /ghcr_read_token/);
  assert.match(preflight, /-f "\$AXORA_REGISTRY_TOKEN_FILE" && ! -L "\$AXORA_REGISTRY_TOKEN_FILE"/);
  assert.match(preflight, /stat -c '%u:%g'.*== "0:0"/);
  assert.match(preflight, /stat -c '%a'.*== "600"/);
});

test("backs up and migrates only when the immutable ledger requires it", async () => {
  const deploy = await readFile(
    new URL("../production/deploy.sh", import.meta.url),
    "utf8",
  );
  const status = deploy.indexOf('pending_migrations="$(');
  const conditional = deploy.indexOf('if [[ "$pending_migrations" == "required" ]]', status);
  const backup = deploy.indexOf('"$SCRIPT_DIR/backup.sh" --commit "$target_sha"', conditional);
  const migration = deploy.indexOf('/database/init/01-run-migration.sh', backup);
  const swap = deploy.indexOf('compose_release "$release" up -d --no-deps --no-build --wait', migration);
  assert(status >= 0);
  assert(conditional > status);
  assert(backup > conditional);
  assert(migration > backup);
  assert(swap > migration);
  assert.match(deploy, /skipping deployment backup and migration runner/);
});

test("retains locking, health gates, exact revision checks, and rollback", async () => {
  const [deploy, health] = await Promise.all([
    readFile(new URL("../production/deploy.sh", import.meta.url), "utf8"),
    readFile(new URL("../production/health-check.sh", import.meta.url), "utf8"),
  ]);
  assert.match(deploy, /flock --exclusive --nonblock/);
  assert.match(deploy, /latest_main="\$\(remote_main_sha\)"/);
  assert.match(deploy, /automatic_revert/);
  assert.match(deploy, /health-check\.sh" --local/);
  assert.match(deploy, /health-check\.sh" --external/);
  assert.match(health, /\/api\/health\/live/);
  assert.match(health, /\/api\/health\/ready/);
});

test("SSH and sudo expose only the exact forced deployment protocol", async () => {
  const [workflow, sshWrapper, rootGateway, sudoers] = await Promise.all([
    readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../production/ssh-deploy-command.sh", import.meta.url), "utf8"),
    readFile(new URL("../production/run-ci-deploy.sh", import.meta.url), "utf8"),
    readFile(new URL("../../deploy/sudoers/axora-deploy", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /"deploy \$GITHUB_SHA \$IMAGE_DIGEST"/);
  assert.doesNotMatch(workflow, /sudo --non-interactive/);
  assert.match(sshWrapper, /\^deploy\\ \(\[0-9a-f\]\{40\}\)\\ \(sha256:\[0-9a-f\]\{64\}\)\$/);
  assert.match(sshWrapper, /\[\[ "\$#" -eq 0 \]\]/);
  assert.match(sshWrapper, /-z "\$\{SSH_TTY:-\}"/);
  assert.match(rootGateway, /\[\[ "\$#" -eq 0 \]\]/);
  assert.match(rootGateway, /\/usr\/bin\/env -i/);
  assert.match(rootGateway, /--automatic "\$commit_sha" "\$image_digest"/);
  assert.equal(
    sudoers.trim(),
    'axora-deploy ALL=(root) NOPASSWD: /usr/local/libexec/axora-production/run-ci-deploy.sh ""',
  );
  assert.doesNotMatch(sudoers, /\*/);
});

test("forced SSH command rejects malformed commands and shell syntax", async () => {
  const wrapper = new URL("../production/ssh-deploy-command.sh", import.meta.url).pathname;
  const baseEnvironment = { ...process.env, SSH_CONNECTION: "192.0.2.1 1 192.0.2.2 22", SSH_TTY: "" };
  const rejected = [
    "",
    "deploy",
    `deploy ${"a".repeat(39)} sha256:${"b".repeat(64)}`,
    `deploy ${"a".repeat(40)} sha256:${"b".repeat(63)}`,
    `deploy ${"a".repeat(40)} sha256:${"b".repeat(64)} extra`,
    `deploy ${"a".repeat(40)} sha256:${"b".repeat(64)};id`,
    `VAR=x deploy ${"a".repeat(40)} sha256:${"b".repeat(64)}`,
    `deploy $(id) sha256:${"b".repeat(64)}`,
  ];
  for (const command of rejected) {
    await assert.rejects(
      execFile("bash", [wrapper], { env: { ...baseEnvironment, SSH_ORIGINAL_COMMAND: command } }),
      /deployment command rejected/i,
    );
  }
  await assert.rejects(
    execFile("bash", [wrapper, "unexpected"], {
      env: { ...baseEnvironment, SSH_ORIGINAL_COMMAND: `deploy ${"a".repeat(40)} sha256:${"b".repeat(64)}` },
    }),
    /deployment command rejected/i,
  );
  await assert.rejects(
    execFile("bash", [wrapper], {
      env: {
        ...baseEnvironment,
        SSH_TTY: "/dev/pts/1",
        SSH_ORIGINAL_COMMAND: `deploy ${"a".repeat(40)} sha256:${"b".repeat(64)}`,
      },
    }),
    /deployment command rejected/i,
  );
});

test("migration ledger selects none, required, and immutable-history failure", async () => {
  const root = await temporaryRoot("axora-migration-status-");
  try {
    const release = path.join(root, "release");
    const bin = path.join(root, "bin");
    const migrations = path.join(release, "database/migrations");
    await mkdir(migrations, { recursive: true });
    await mkdir(bin);
    const migration = path.join(migrations, "001_test.sql");
    await writeFile(migration, "SELECT 1;\n");
    const { stdout: checksumOutput } = await execFile("sha256sum", [migration]);
    const checksum = checksumOutput.split(/\s+/u)[0];
    const fakeDocker = path.join(bin, "docker");
    await writeFile(fakeDocker, `#!/usr/bin/env bash
case "$*" in
  *to_regclass*) printf '%s\\n' "$MOCK_TABLE_EXISTS" ;;
  *) printf '%b' "$MOCK_MANIFEST" ;;
esac
`);
    await chmod(fakeDocker, 0o755);
    const script = new URL("../production/migration-status.sh", import.meta.url);
    const run = (table, manifest) => execFile("bash", [script.pathname, release, "db-test", "axora_test"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_TABLE_EXISTS: table, MOCK_MANIFEST: manifest },
    });
    assert.equal((await run("f", "")).stdout.trim(), "required");
    assert.equal((await run("t", `001_test.sql\t${checksum}\n`)).stdout.trim(), "none");
    assert.equal((await run("t", "")).stdout.trim(), "required");
    await assert.rejects(run("t", `001_test.sql\t${"0".repeat(64)}\n`), /immutable subset/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("controller rejects invalid revisions and digests before production work", async () => {
  const root = await temporaryRoot("axora-deploy-input-");
  try {
    const bin = path.join(root, "bin");
    await installFakeRootIdentity(bin);
    const config = await writePrivateConfig(root);
    const deploy = new URL("../production/deploy.sh", import.meta.url).pathname;
    const environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXORA_CONFIG_FILE: config };
    await assert.rejects(
      execFile("bash", [deploy, "--automatic", "bad", `sha256:${"0".repeat(64)}`], { env: environment }),
      /Invalid deployment commit SHA/,
    );
    await assert.rejects(
      execFile("bash", [deploy, "--automatic", "0".repeat(40), "bad"], { env: environment }),
      /valid sha256 image digest/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the production lock primitive refuses overlap", async () => {
  const root = await temporaryRoot("axora-deploy-lock-");
  let holder;
  try {
    const lock = path.join(root, "deploy.lock");
    await writeFile(lock, "");
    holder = spawn("flock", ["--exclusive", lock, "sleep", "10"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await assert.rejects(
      execFile("flock", ["--exclusive", "--nonblock", lock, "true"]),
    );
  } finally {
    holder?.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});

test("local health checks accept readiness contracts and reject invalid responses", async () => {
  const root = await temporaryRoot("axora-health-");
  try {
    const bin = path.join(root, "bin");
    await installFakeRootIdentity(bin);
    const curl = path.join(bin, "curl");
    await writeFile(curl, `#!/usr/bin/env bash
output=''
url=''
while (( $# > 0 )); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
status=ok
[[ "$url" == */ready ]] && status=ready
[[ "\${MOCK_BAD_RESPONSE:-false}" == true ]] && status=wrong
printf '{"status":"%s"}' "$status" > "$output"
printf '200'
`);
    await chmod(curl, 0o755);
    const config = await writePrivateConfig(root, {
      AXORA_ORIGIN_BIND: "127.0.0.1",
      AXORA_ORIGIN_PORT: "18080",
      AXORA_PUBLIC_URL: "https://axora.management",
    });
    const health = new URL("../production/health-check.sh", import.meta.url).pathname;
    const environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AXORA_CONFIG_FILE: config };
    await execFile("bash", [health, "--local"], { env: environment });
    await assert.rejects(
      execFile("bash", [health, "--local"], { env: { ...environment, MOCK_BAD_RESPONSE: "true" } }),
      /invalid response/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
