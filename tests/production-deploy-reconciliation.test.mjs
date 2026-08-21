import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production deployment reconciliation", () => {
  it("mounts every migration-entrypoint secret read-only from the protected secret directory", async () => {
    const [deploy, entrypoint, dockerIgnore] = await Promise.all([
      readFile(new URL("../scripts/production/deploy.sh", import.meta.url), "utf8"),
      readFile(new URL("../database/init/01-run-migration.sh", import.meta.url), "utf8"),
      readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
    ]);
    const requiredSecrets = [...new Set(
      entrypoint.match(/\/run\/secrets\/[a-z0-9_]+/g) ?? [],
    )].sort();
    const migrationBranch = 'if [[ "$pending_migrations" == "required" ]]; then';
    const migrationStart = deploy.indexOf(migrationBranch);
    const migrationEnd = deploy.indexOf(
      '\nelif [[ "$pending_migrations" == "none" ]]; then',
      migrationStart,
    );
    expect(migrationStart).toBeGreaterThanOrEqual(0);
    expect(migrationEnd).toBeGreaterThan(migrationStart);
    const migrationCommand = deploy.slice(migrationStart, migrationEnd);
    expect(migrationCommand).toContain('log "Applying pending transactional migrations from the exact release."');
    expect(migrationCommand).toContain("docker run \\");
    expect(migrationCommand).toContain("/database/init/01-run-migration.sh");
    const mounts = [...migrationCommand.matchAll(
      /--mount "type=bind,source=\$AXORA_SECRETS_DIR\/([a-z0-9_]+),target=(\/run\/secrets\/[a-z0-9_]+),readonly"/g,
    )].map((match) => ({ source: match[1], target: match[2] }));

    expect(requiredSecrets).toEqual([
      "/run/secrets/axora_cleanup_worker_password",
      "/run/secrets/postgres_admin_password",
    ]);
    expect(mounts.map(({ target }) => target).sort()).toEqual(requiredSecrets);
    for (const { source, target } of mounts) {
      expect(target).toBe(`/run/secrets/${source}`);
    }
    expect(migrationCommand).toContain(
      '[[ -f "$migration_secret_path" && ! -L "$migration_secret_path" && -s "$migration_secret_path" ]]',
    );
    expect(entrypoint).toContain('if [ ! -r /run/secrets/axora_cleanup_worker_password ]; then');
    expect(entrypoint).not.toMatch(/echo .*PASSWORD|printf .*PASSWORD/);
    expect(dockerIgnore).toMatch(/^secrets$/m);
    expect(dockerIgnore).toMatch(/^\*\*\/secrets$/m);
  });

  it("starts newly introduced isolated workers without replacing stateful services", async () => {
    const deploy = await readFile(
      new URL("../scripts/production/deploy.sh", import.meta.url),
      "utf8",
    );
    const functionStart = deploy.indexOf("ensure_budget_worker_for_release() {");
    const functionEnd = deploy.indexOf("\n}\n\nensure_document_worker_for_release()", functionStart);
    const sameRevisionStart = deploy.indexOf(
      'if [[ "$current_sha" == "$target_sha" ]]; then',
    );
    const sameRevisionEnd = deploy.indexOf(
      '\nfi\n\nlog "Fetching exact trusted main commit',
      sameRevisionStart,
    );

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    expect(sameRevisionStart).toBeGreaterThanOrEqual(0);
    expect(sameRevisionEnd).toBeGreaterThan(sameRevisionStart);

    const reconciliation = deploy.slice(functionStart, functionEnd);
    const sameRevision = deploy.slice(sameRevisionStart, sameRevisionEnd);

    expect(reconciliation).toContain('release_has_budget_worker "$release"');
    expect(reconciliation).toContain(
      'remove_budget_worker_if_release_lacks_it "$release"',
    );
    expect(reconciliation).toContain(
      'if ! container="$(find_service_container budget-worker)"; then',
    );
    expect(reconciliation).toContain(
      'docker image inspect --format \'{{.Id}}\' "$expected_image"',
    );
    expect(reconciliation).toContain('export AXORA_IMAGE="$expected_image"');
    expect(reconciliation).toMatch(
      /compose_release "\$release" up -d --no-deps --no-build --wait[\s\S]*budget-worker/,
    );
    expect(reconciliation).toContain(
      'Running budget-worker image differs from the recorded content digest.',
    );
    expect(reconciliation).toContain(
      'Production budget-worker is not healthy (status: $health).',
    );
    expect(reconciliation).not.toMatch(/\bdown\b|--remove-orphans|docker volume|\s-v(?:\s|$)/);

    expect(sameRevision).toContain('release="$(release_path_for_sha "$target_sha")"');
    expect(sameRevision).toContain(
      'ensure_budget_worker_for_release "$release" "$recorded_image" "$recorded_image_id"',
    );
    const documentFunctionStart = deploy.indexOf("ensure_document_worker_for_release() {");
    const documentFunctionEnd = deploy.indexOf("\n}\n\nautomatic_revert()", documentFunctionStart);
    expect(documentFunctionStart).toBeGreaterThan(functionEnd);
    expect(documentFunctionEnd).toBeGreaterThan(documentFunctionStart);
    const documentReconciliation = deploy.slice(documentFunctionStart, documentFunctionEnd);
    expect(documentReconciliation).toContain('release_has_document_worker "$release"');
    expect(documentReconciliation).toContain(
      'remove_document_worker_if_release_lacks_it "$release"',
    );
    expect(documentReconciliation).toContain(
      'if ! container="$(find_service_container document-worker)"; then',
    );
    expect(documentReconciliation).toMatch(
      /compose_release "\$release" up -d --no-deps --no-build --wait[\s\S]*document-worker/,
    );
    expect(documentReconciliation).not.toMatch(/\bdown\b|--remove-orphans|docker volume|\s-v(?:\s|$)/);
    expect(sameRevision).toContain(
      'ensure_document_worker_for_release "$release" "$recorded_image" "$recorded_image_id"',
    );
  });
});
