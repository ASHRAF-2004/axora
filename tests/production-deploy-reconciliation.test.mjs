import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production deployment reconciliation", () => {
  it("starts a newly introduced budget worker without replacing stateful services", async () => {
    const deploy = await readFile(
      new URL("../scripts/production/deploy.sh", import.meta.url),
      "utf8",
    );
    const functionStart = deploy.indexOf("ensure_budget_worker_for_release() {");
    const functionEnd = deploy.indexOf("\n}\n\nautomatic_revert()", functionStart);
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
  });
});
