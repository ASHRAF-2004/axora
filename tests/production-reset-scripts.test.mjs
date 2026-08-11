import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionScripts = join(repositoryRoot, "scripts", "production");
const libPath = join(productionScripts, "lib.sh");
const installPath = join(productionScripts, "install.sh");
const resetPath = join(productionScripts, "reset-baseline.sh");
const ownerRetainingResetPath = join(productionScripts, "owner-retaining-reset.sql");
const encryptedBackupPath = join(productionScripts, "encrypted-reset-backup.sh");
const verifyPath = join(productionScripts, "verify-encrypted-backup.sh");
const deployEnvExample = join(repositoryRoot, "deploy", "systemd", "deploy.env.example");

function runBash(source, args = [], options = {}) {
  return spawnSync("bash", ["-c", source, "production-reset-test", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
}

function writeExecutable(path, source) {
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createRootCommandWrappers(root, dockerLog) {
  const bin = join(root, "bin");
  mkdirSync(bin, { mode: 0o700 });

  writeExecutable(join(bin, "id"), `#!/usr/bin/env bash
if [[ "\${1:-}" == "-u" ]]; then
  printf '0\\n'
else
  exec /usr/bin/id "$@"
fi
`);

  writeExecutable(join(bin, "stat"), `#!/usr/bin/env bash
if [[ "\${1:-}" == "-c" && "\${2:-}" == "%u" ]]; then
  printf '0\\n'
else
  exec /usr/bin/stat "$@"
fi
`);

  writeExecutable(join(bin, "install"), `#!/usr/bin/env bash
args=()
while (( $# > 0 )); do
  case "$1" in
    -o|-g) shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
exec /usr/bin/install "\${args[@]}"
`);

  writeExecutable(join(bin, "find"), `#!/usr/bin/env bash
if [[ "$*" == *"! -user root"* ]]; then
  exit 0
fi
exec /usr/bin/find "$@"
`);

  writeExecutable(join(bin, "docker"), `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "\${AXORA_TEST_DOCKER_LOG:?}"
case "\${1:-}" in
  ps)
    if [[ "$*" == *"com.docker.compose.service=app"* ]]; then
      printf 'fake-app\\n'
    else
      printf 'fake-db\\n'
    fi
    ;;
  inspect)
    if [[ "$*" == *"{{.Image}}"* ]]; then
      printf '%s\\n' "\${AXORA_TEST_IMAGE_ID:?}"
    else
      printf 'healthy\\n'
    fi
    ;;
  exec)
    shift
    if [[ "\${1:-}" == "-i" ]]; then shift; fi
    [[ "\${1:-}" == "fake-db" ]] || exit 91
    shift
    command="\${1:-}"
    shift || true
    case "$command" in
      pg_restore)
        if [[ ! -t 0 ]]; then /usr/bin/cat >/dev/null; fi
        ;;
      createdb|dropdb)
        ;;
      psql)
        arguments="$*"
        if [[ "$arguments" == *"information_schema.tables"* ]]; then
          printf '25\\n'
        elif [[ "$arguments" == *"schema_migrations"* ]]; then
          printf '%b\\n' "\${AXORA_TEST_MIGRATION_LINE:-001_initial.sql\\t$(printf 'b%.0s' {1..64})}"
        else
          input="$(/usr/bin/cat)"
          if [[ "$input" == *"information_schema.tables"* ]]; then
            printf '%b' "\${AXORA_TEST_TABLE_COUNTS:?}"
          else
            exit 92
          fi
        fi
        ;;
      *) exit 93 ;;
    esac
    ;;
  *) exit 94 ;;
esac
`, { env: { AXORA_TEST_DOCKER_LOG: dockerLog } });

  return bin;
}

function createMinimalConfig(root) {
  const config = join(root, "deploy.env");
  const runtime = join(root, "runtime.env");
  const state = join(root, "state");
  const secrets = join(root, "secrets");
  const uploads = join(root, "uploads");
  const logs = join(root, "logs");
  for (const path of [state, secrets, uploads, logs]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  writeFileSync(runtime, "AXORA_HYBRID_DB_NAME=axora_hybrid\n", { mode: 0o600 });
  writeFileSync(config, [
    `AXORA_RUNTIME_ROOT=${root}`,
    `AXORA_RUNTIME_ENV_FILE=${runtime}`,
    `AXORA_SECRETS_DIR=${secrets}`,
    `AXORA_UPLOADS_DIR=${uploads}`,
    `AXORA_STATE_ROOT=${state}`,
    `AXORA_LOG_ROOT=${logs}`,
    "AXORA_COMPOSE_PROJECT=axora-reset-test",
    "AXORA_DATABASE_NAME=axora_hybrid",
    'AXORA_RESET_DATABASE_ALLOWLIST="axora_hybrid"',
    `AXORA_RESET_BACKUP_PASSPHRASE_FILE=${join(secrets, "reset_backup_passphrase")}`,
    "AXORA_MIN_TABLE_COUNT=15",
    "",
  ].join("\n"), { mode: 0o600 });
  chmodSync(config, 0o600);
  chmodSync(runtime, 0o600);
  return { config, runtime, state, secrets, uploads };
}

describe("guarded production reset controls", () => {
  it("accepts only an explicit expected database allowlist", () => {
    const accepted = runBash(
      'source "$1"; database_in_allowlist "$2" "$3"',
      [libPath, "axora_hybrid", "axora_hybrid axora_recovery"],
    );
    expect(accepted.status).toBe(0);

    for (const [database, allowlist] of [
      ["axora_hybrid", "axora_recovery"],
      ["postgres", "postgres"],
      ["template1", "axora_hybrid template1"],
      ["axora_hybrid", "axora_hybrid\npostgres"],
      ["unsafe-name", "unsafe-name"],
    ]) {
      const rejected = runBash(
        'source "$1"; database_in_allowlist "$2" "$3"',
        [libPath, database, allowlist],
      );
      expect(rejected.status, `${database} in ${JSON.stringify(allowlist)}`).not.toBe(0);
    }
  });

  it("requires the exact one-shot environment authorization and derives the typed phrase", () => {
    const exact = runBash(
      'source "$1"; reset_authorization_is_exact',
      [libPath],
      { env: { ...process.env, AXORA_BASELINE_RESET_AUTHORIZATION: "I_ACKNOWLEDGE_AXORA_BASELINE_RESET" } },
    );
    expect(exact.status).toBe(0);

    for (const value of ["", "true", "I_ACKNOWLEDGE_AXORA_BASELINE_RESET "]) {
      const rejected = runBash(
        'source "$1"; reset_authorization_is_exact',
        [libPath],
        { env: { ...process.env, AXORA_BASELINE_RESET_AUTHORIZATION: value } },
      );
      expect(rejected.status).not.toBe(0);
    }

    const sha = "a".repeat(40);
    const phrase = runBash(
      'source "$1"; reset_confirmation_phrase "$2" "$3" "$4" "$5"',
      [libPath, "axora_hybrid", "560", "25", sha],
    );
    expect(phrase.status).toBe(0);
    expect(phrase.stdout).toBe(
      `RESET axora_hybrid TO MIGRATION-ONLY BASELINE OMIT 560 ROWS ACROSS 25 TABLES AT ${sha}`,
    );
  });

  it("fails --apply before Docker without the exact flag or a real TTY", () => {
    const root = mkdtempSync(join(tmpdir(), "axora-reset-guard-"));
    try {
      const dockerLog = join(root, "docker.log");
      writeFileSync(dockerLog, "", { mode: 0o600 });
      const bin = createRootCommandWrappers(root, dockerLog);
      const { config } = createMinimalConfig(root);
      const baseEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        AXORA_CONFIG_FILE: config,
        AXORA_TEST_DOCKER_LOG: dockerLog,
      };

      const missingFlag = spawnSync("bash", [resetPath, "--apply"], {
        cwd: repositoryRoot,
        env: baseEnv,
        encoding: "utf8",
      });
      expect(missingFlag.status).not.toBe(0);
      expect(missingFlag.stderr).toMatch(/exact one-shot AXORA_BASELINE_RESET_AUTHORIZATION/);
      expect(readFileSync(dockerLog, "utf8")).toBe("");

      const noTty = spawnSync("bash", [resetPath, "--apply"], {
        cwd: repositoryRoot,
        env: {
          ...baseEnv,
          AXORA_BASELINE_RESET_AUTHORIZATION: "I_ACKNOWLEDGE_AXORA_BASELINE_RESET",
        },
        encoding: "utf8",
      });
      expect(noTty.status).not.toBe(0);
      expect(noTty.stderr).toMatch(/real interactive terminal/);
      expect(readFileSync(dockerLog, "utf8")).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("executes the default plan with read-only Docker operations only", () => {
    const root = mkdtempSync(join(tmpdir(), "axora-reset-plan-"));
    try {
      const dockerLog = join(root, "docker.log");
      writeFileSync(dockerLog, "", { mode: 0o600 });
      const bin = createRootCommandWrappers(root, dockerLog);
      const { config, state } = createMinimalConfig(root);
      const sha = "a".repeat(40);
      const imageId = `sha256:${"c".repeat(64)}`;
      const release = join(state, "releases", sha);
      const migrationDir = join(release, "database", "migrations");
      const initDir = join(release, "database", "init");
      const adminDir = join(release, "database", "admin");
      for (const path of [migrationDir, initDir, adminDir]) {
        mkdirSync(path, { recursive: true, mode: 0o700 });
      }
      const migration = join(migrationDir, "001_test.sql");
      writeFileSync(migration, "SELECT 1;\n", { mode: 0o600 });
      writeFileSync(join(initDir, "01-run-migration.sh"), "#!/bin/sh\n", { mode: 0o600 });
      writeFileSync(join(adminDir, "apply-app-grants.sql"), "SELECT 1;\n", { mode: 0o600 });
      writeFileSync(join(release, ".axora-commit"), `${sha}\n`, { mode: 0o600 });

      const stateValues = new Map([
        ["current.sha", `${sha}\n`],
        ["current.release", `${release}\n`],
        ["current.image", `axora-app:${sha}\n`],
        ["current.image-id", `${imageId}\n`],
      ]);
      for (const [name, value] of stateValues) {
        writeFileSync(join(state, name), value, { mode: 0o600 });
      }
      const counts = Array.from({ length: 15 }, (_, index) => (
        `table_${String(index + 1).padStart(2, "0")}\t${index === 0 ? 5 : 0}\n`
      )).join("");

      const planned = spawnSync("bash", [resetPath, "--plan"], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          AXORA_CONFIG_FILE: config,
          AXORA_TEST_DOCKER_LOG: dockerLog,
          AXORA_TEST_IMAGE_ID: imageId,
          AXORA_TEST_MIGRATION_LINE: `001_test.sql\t${sha256(migration)}`,
          AXORA_TEST_TABLE_COUNTS: counts,
        },
        encoding: "utf8",
      });
      expect(planned.status, planned.stderr).toBe(0);
      expect(planned.stdout).toMatch(/Baseline reset plan: database=axora_hybrid/);
      expect(planned.stdout).toMatch(/Plan only: no service, database, upload, backup, or Docker volume was changed/);

      const commands = readFileSync(dockerLog, "utf8");
      expect(commands).toMatch(/ps .*com\.docker\.compose\.service=db/);
      expect(commands).toMatch(/ps .*com\.docker\.compose\.service=app/);
      expect(commands).toMatch(/psql .*schema_migrations/);
      expect(commands).not.toMatch(/^(?:stop|run|volume|compose)\b/m);
      expect(commands).not.toMatch(/\b(?:createdb|dropdb|pg_dump|pg_restore)\b/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("decrypts and validates a GPG AES256 fixture through a fake disposable restore", () => {
    const root = mkdtempSync(join(tmpdir(), "axora-reset-verify-"));
    try {
      const dockerLog = join(root, "docker.log");
      writeFileSync(dockerLog, "", { mode: 0o600 });
      const bin = createRootCommandWrappers(root, dockerLog);
      const { config, state, secrets } = createMinimalConfig(root);
      const passphrase = join(secrets, "reset_backup_passphrase");
      writeFileSync(passphrase, "A".repeat(86), { mode: 0o600 });
      chmodSync(passphrase, 0o600);

      const backupName = "axora-20260802T120000Z";
      const stagingRoot = join(root, "staging");
      const backupDir = join(stagingRoot, backupName);
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(backupDir, "database.dump"), "fake-custom-format-dump\n", { mode: 0o600 });
      writeFileSync(join(backupDir, "migrations.tsv"), `001_initial.sql\t${"b".repeat(64)}\n`, { mode: 0o600 });
      writeFileSync(join(backupDir, "uploads-files.list"), Buffer.alloc(0), { mode: 0o600 });
      writeFileSync(join(backupDir, "uploads.sha256"), Buffer.alloc(0), { mode: 0o600 });
      writeFileSync(join(backupDir, "uploads-directories.list"), Buffer.from([0]), { mode: 0o600 });

      const emptyUploads = join(root, "empty-uploads");
      mkdirSync(emptyUploads, { mode: 0o700 });
      execFileSync("tar", [
        "--create",
        "--gzip",
        `--file=${join(backupDir, "uploads.tar.gz")}`,
        `--directory=${emptyUploads}`,
        ".",
      ]);

      const commit = "a".repeat(40);
      const innerManifest = [
        "format=axora-production-backup-v1",
        "created_utc=2026-08-02T12:00:00+00:00",
        "host=disposable-test",
        "database=axora_hybrid",
        "source_table_count=25",
        "migration_count=1",
        "migration_manifest=migrations.tsv",
        `commit=${commit}`,
        "database_archive=postgresql-custom",
        "persistent_files=uploads.tar.gz",
        "persistent_file_manifest=uploads-files.list,uploads.sha256,uploads-directories.list",
        "credentials_included=no",
        "",
      ].join("\n");
      writeFileSync(join(backupDir, "manifest.txt"), innerManifest, { mode: 0o600 });

      const checksumFiles = [
        "database.dump",
        "uploads.tar.gz",
        "uploads-files.list",
        "uploads.sha256",
        "uploads-directories.list",
        "migrations.tsv",
        "manifest.txt",
      ];
      writeFileSync(
        join(backupDir, "checksums.sha256"),
        checksumFiles.map((name) => `${sha256(join(backupDir, name))}  ${name}\n`).join(""),
        { mode: 0o600 },
      );

      const packageTar = join(root, "package.tar");
      execFileSync("tar", [
        "--create",
        "--format=posix",
        `--file=${packageTar}`,
        `--directory=${stagingRoot}`,
        backupName,
      ]);

      const resetBackups = join(state, "reset-backups");
      mkdirSync(resetBackups, { recursive: true, mode: 0o700 });
      const artifact = join(resetBackups, `axora-reset-20260802T120000Z-${commit.slice(0, 12)}.tar.gpg`);
      const gnupgHome = join(root, "gnupg-encrypt");
      mkdirSync(gnupgHome, { mode: 0o700 });
      execFileSync("gpg", [
        "--batch",
        "--quiet",
        "--no-tty",
        "--pinentry-mode", "loopback",
        "--passphrase-file", passphrase,
        "--symmetric",
        "--cipher-algo", "AES256",
        "--compress-algo", "none",
        "--output", artifact,
        packageTar,
      ], { env: { ...process.env, GNUPGHOME: gnupgHome } });
      chmodSync(artifact, 0o600);

      const outerManifest = artifact.replace(/\.tar\.gpg$/, ".manifest");
      writeFileSync(outerManifest, [
        "format=axora-encrypted-reset-backup-v1",
        "created_utc=2026-08-02T12:00:00+00:00",
        "database=axora_hybrid",
        `commit=${commit}`,
        "purpose=baseline-reset",
        "initiator_uid=1000",
        "initiator_user=test-operator",
        `source_backup=${backupName}`,
        `source_manifest_sha256=${sha256(join(backupDir, "manifest.txt"))}`,
        `ciphertext_sha256=${sha256(artifact)}`,
        "credentials_included=no",
        "",
      ].join("\n"), { mode: 0o600 });
      chmodSync(outerManifest, 0o600);

      const verified = spawnSync("bash", [verifyPath, "--artifact", artifact], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          AXORA_CONFIG_FILE: config,
          AXORA_TEST_DOCKER_LOG: dockerLog,
        },
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      expect(verified.status, verified.stderr).toBe(0);
      expect(verified.stdout).not.toContain("A".repeat(20));

      const verifiedMarker = artifact.replace(/\.tar\.gpg$/, ".verified");
      expect(existsSync(verifiedMarker)).toBe(true);
      const marker = readFileSync(verifiedMarker, "utf8");
      expect(marker).toContain("format=axora-encrypted-reset-verification-v1");
      expect(marker).toContain(`ciphertext_sha256=${sha256(artifact)}`);
      expect(marker).toContain("source_table_count=25");

      const commands = readFileSync(dockerLog, "utf8");
      expect(commands).toMatch(/createdb --username postgres axora_reset_verify_/);
      expect(commands).toMatch(/pg_restore --username postgres --dbname axora_reset_verify_/);
      expect(commands).toMatch(/dropdb --username postgres axora_reset_verify_/);
      expect(commands).not.toMatch(/\bvolume\b|compose down|--remove-orphans/);

      writeFileSync(passphrase, `${"A".repeat(86)}\n`, { mode: 0o600 });
      const malformedPassphrase = spawnSync("bash", [verifyPath, "--artifact", artifact], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          AXORA_CONFIG_FILE: config,
          AXORA_TEST_DOCKER_LOG: dockerLog,
        },
        encoding: "utf8",
      });
      expect(malformedPassphrase.status).not.toBe(0);
      expect(malformedPassphrase.stderr).toMatch(/without whitespace/);
      expect(readFileSync(dockerLog, "utf8")).toBe(commands);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("keeps reset implementation free of Docker-volume and destructive Compose commands", () => {
    const installSource = readFileSync(installPath, "utf8");
    const resetSource = readFileSync(resetPath, "utf8");
    const encryptedSource = readFileSync(encryptedBackupPath, "utf8");
    const verifySource = readFileSync(verifyPath, "utf8");
    const deployConfigSource = readFileSync(deployEnvExample, "utf8");
    const combined = [resetSource, encryptedSource, verifySource].join("\n");
    const logicalCommands = combined.replaceAll("\\\n", " ");

    for (const source of [resetSource, encryptedSource, verifySource]) {
      expect(source).toMatch(/require_root/);
    }
    expect(encryptedSource).toMatch(/--symmetric[\s\S]*--cipher-algo AES256/);
    expect(encryptedSource).toMatch(/--passphrase-file "\$AXORA_RESET_BACKUP_PASSPHRASE_FILE"/);
    expect(verifySource).toMatch(/--decrypt "\$artifact"/);
    expect(verifySource).toMatch(/createdb[\s\S]*pg_restore[\s\S]*dropdb/);
    expect(resetSource).toMatch(/encrypted-reset-backup\.sh" --purpose baseline-reset/);
    expect(resetSource).toMatch(/\$release\/database\/migrations,target=\/migrations,readonly/);
    expect(resetSource).toMatch(/\/database\/init\/01-run-migration\.sh/);
    expect(resetSource).toMatch(/initiator_uid=.*SUDO_UID/);
    expect(resetSource).toMatch(/mv -- "\$AXORA_UPLOADS_DIR" "\$quarantine_dir\/uploads"/);
    expect(resetSource).toContain("seed_users=no");
    expect(resetSource).toContain("seed_demo=no");
    for (const script of [
      "encrypted-reset-backup.sh",
      "reset-baseline.sh",
      "verify-encrypted-backup.sh",
    ]) {
      expect(installSource).toContain(script);
    }
    expect(installSource).toMatch(/reset_backup_passphrase[\s\S]*-m 0600/);
    expect(deployConfigSource).toContain('AXORA_RESET_DATABASE_ALLOWLIST="axora_hybrid"');
    expect(deployConfigSource).toContain(
      "AXORA_RESET_BACKUP_PASSPHRASE_FILE=/etc/axora-production/secrets/reset_backup_passphrase",
    );

    expect(logicalCommands).not.toMatch(/\bdocker\s+compose\b[^\n]*\bdown\b/);
    expect(logicalCommands).not.toMatch(/\bdocker\s+volume\b/);
    expect(logicalCommands).not.toContain("--remove-orphans");
    expect(logicalCommands).not.toMatch(/\b(?:docker|compose_release)\b[^\n]*\s-v(?:\s|$)/);
    expect(combined).not.toMatch(/create-admin|seed-(?:user|demo)|TRUNCATE|DROP DATABASE/i);
  });

  it("guards owner-retaining reset work inside an isolated candidate", () => {
    const installSource = readFileSync(installPath, "utf8");
    const resetSource = readFileSync(resetPath, "utf8");
    const ownerResetSource = readFileSync(ownerRetainingResetPath, "utf8");

    expect(resetSource).toContain("--retain-owner-id");
    expect(resetSource).toMatch(/createdb[\s\S]*--template "\$AXORA_DATABASE_NAME"[\s\S]*"\$candidate_database"/);
    expect(resetSource).toMatch(/--dbname "\$candidate_database"[\s\S]*owner-retaining-reset\.sql/);
    expect(resetSource).toContain("assert_retained_owner_source");
    expect(resetSource).toContain("assert_owner_retaining_candidate");
    expect(resetSource).toMatch(
      /assert_retained_owner_source\(\)[\s\S]*?docker exec -i "\$db_container" psql/,
    );
    expect(resetSource).toMatch(
      /assert_owner_retaining_candidate\(\)[\s\S]*?docker exec -i "\$db_container" psql/,
    );
    expect(resetSource).toContain("encrypted-reset-backup.sh\" --purpose baseline-reset");
    expect(installSource).toContain("owner-retaining-reset.sql");
    expect(installSource).toMatch(/-m 0640[\s\S]*owner-retaining-reset\.sql/);

    expect(ownerResetSource).toMatch(/^\\set ON_ERROR_STOP on/m);
    expect(ownerResetSource).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(ownerResetSource).not.toContain("owner@axora.management");
    expect(ownerResetSource).toContain(":'canonical_email'");
    expect(ownerResetSource).toContain("TRUNCATE TABLE");
    expect(ownerResetSource).toContain("reset_preserved_tables");
    expect(ownerResetSource).toContain("'suppliers'");
    expect(ownerResetSource).toContain("'product_suppliers'");
    expect(ownerResetSource).toContain("PRODUCTION_BASELINE_RESET");
    expect(ownerResetSource).not.toMatch(/DROP DATABASE|compose down|--remove-orphans|docker volume/i);
  });
});
