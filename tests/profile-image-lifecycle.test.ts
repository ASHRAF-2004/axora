import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

interface Principal {
  userId: string;
  assignmentId: string;
}

function paths(userId: string, versionId: string) {
  return [64, 128, 256].map(() => (
    `profile-images/${userId}/${versionId}/${randomUUID()}.webp`
  ));
}

describe("profile image SQL lifecycle and isolation", () => {
  it("keeps replacement, duplicate, failure, read, removal, and deactivation atomic", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);
      const companies = await db.query<{ id: string; branchId: string }>(`
        SELECT company.id::text,branch.id::text AS "branchId"
        FROM companies company JOIN branches branch ON branch.company_id=company.id
        WHERE company.active AND branch.active ORDER BY company.id,branch.id LIMIT 2
      `);
      expect(companies.rows).toHaveLength(2);
      const targetUserId = randomUUID();
      const intruderUserId = randomUUID();
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,branch_id,is_owner,
          account_kind,account_status,email_verified_at
        ) SELECT $1,'profile-target@example.test','Profile target',
          'not-a-real-hash',id,$2,$3,false,'COMPANY','ACTIVE',now()
        FROM roles WHERE role_key='REQUESTER'
      `, [targetUserId, companies.rows[0].id, companies.rows[0].branchId]);
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,branch_id,is_owner,
          account_kind,account_status,email_verified_at
        ) SELECT $1,'profile-intruder@example.test','Profile intruder',
          'not-a-real-hash',id,$2,$3,false,'COMPANY','ACTIVE',now()
        FROM roles WHERE role_key='REQUESTER'
      `, [intruderUserId, companies.rows[1].id, companies.rows[1].branchId]);
      await db.query(`
        INSERT INTO user_profiles(user_id,display_name) VALUES
          ($1,'Profile target'),($2,'Profile intruder')
      `, [targetUserId, intruderUserId]);
      await db.query(`
        INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
        VALUES ($1,$2,'ACTIVE',true,now()),($3,$4,'ACTIVE',true,now())
      `, [targetUserId, companies.rows[0].id, intruderUserId, companies.rows[1].id]);
      await db.query(`
        INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
        VALUES ($1,$2,$3,'ACTIVE',true),($4,$5,$6,'ACTIVE',true)
      `, [
        targetUserId, companies.rows[0].id, companies.rows[0].branchId,
        intruderUserId, companies.rows[1].id, companies.rows[1].branchId,
      ]);
      const targetAssignment = await db.query<{ id: string }>(`
        INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,branch_id)
        SELECT $1,id,'BRANCH',$2,$3 FROM roles WHERE role_key='REQUESTER'
        RETURNING id::text
      `, [targetUserId, companies.rows[0].id, companies.rows[0].branchId]);
      const intruderAssignment = await db.query<{ id: string }>(`
        INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,branch_id)
        SELECT $1,id,'BRANCH',$2,$3 FROM roles WHERE role_key='REQUESTER'
        RETURNING id::text
      `, [intruderUserId, companies.rows[1].id, companies.rows[1].branchId]);
      const owner: Principal = {
        userId: targetUserId,
        assignmentId: targetAssignment.rows[0].id,
      };

      const activate = async (versionId: string, hash: string, width = 320) => {
        const storage = paths(owner.userId, versionId);
        return db.query<{ value: { status: string; versionId: string } | null }>(`
          SELECT axora_activate_profile_image(
            $1,$2,$1,$3,'image/png',$4,240,45,55,1.25,$5,$6,$7,$8,now()
          ) AS value
        `, [owner.userId, owner.assignmentId, versionId, width, hash, ...storage]);
      };

      const firstId = randomUUID();
      const first = await activate(firstId, "a".repeat(64));
      expect(first.rows[0]?.value).toEqual({ status: "ACTIVATED", versionId: firstId });

      const companyActor: Principal = {
        userId: intruderUserId,
        assignmentId: intruderAssignment.rows[0].id,
      };
      const hidden = await db.query(`
        SELECT * FROM axora_profile_image_file($1,$2,$3,NULL,64,now())
      `, [companyActor.userId, companyActor.assignmentId, owner.userId]);
      expect(hidden.rows).toHaveLength(0);

      const duplicateId = randomUUID();
      const duplicate = await activate(duplicateId, "a".repeat(64));
      expect(duplicate.rows[0]?.value).toEqual({ status: "UNCHANGED", versionId: firstId });
      const invalid = await activate(randomUUID(), "b".repeat(64), 32);
      expect(invalid.rows[0]?.value).toBeNull();

      const secondId = randomUUID();
      const second = await activate(secondId, "b".repeat(64));
      expect(second.rows[0]?.value).toEqual({ status: "ACTIVATED", versionId: secondId });
      const versions = await db.query<{ id: string; status: string }>(`
        SELECT id::text,status FROM profile_image_versions WHERE user_id=$1 ORDER BY created_at,id
      `, [owner.userId]);
      expect(versions.rows).toEqual(expect.arrayContaining([
        { id: firstId, status: "RETIRED" },
        { id: secondId, status: "ACTIVE" },
      ]));
      expect(versions.rows.some((row) => row.id === duplicateId)).toBe(false);

      const ownRead = await db.query<{ versionId: string; storagePath: string }>(`
        SELECT version_id::text AS "versionId",storage_path AS "storagePath"
        FROM axora_profile_image_file($1,$2,$1,NULL,128,now())
      `, [owner.userId, owner.assignmentId]);
      expect(ownRead.rows[0]?.versionId).toBe(secondId);
      expect(ownRead.rows[0]?.storagePath).toMatch(/profile-images\/.+\.webp$/);

      const removed = await db.query<{ value: boolean }>(`
        SELECT axora_remove_profile_image($1,$2,$1,'REMOVED_BY_USER',now()) AS value
      `, [owner.userId, owner.assignmentId]);
      expect(removed.rows[0]?.value).toBe(true);
      expect((await db.query(`SELECT * FROM axora_profile_image_file($1,$2,$1,NULL,64,now())`, [owner.userId, owner.assignmentId])).rows).toHaveLength(0);

      const thirdId = randomUUID();
      await activate(thirdId, "c".repeat(64));
      await db.query("UPDATE users SET active=false,account_status='SUSPENDED' WHERE id=$1", [owner.userId]);
      const deactivated = await db.query<{ activeVersion: string | null; status: string }>(`
        SELECT profile.active_avatar_version_id::text AS "activeVersion",image.status
        FROM user_profiles profile
        JOIN profile_image_versions image ON image.id=$2
        WHERE profile.user_id=$1
      `, [owner.userId, thirdId]);
      expect(deactivated.rows[0]).toEqual({ activeVersion: null, status: "RETIRED" });
    } finally {
      await db.close();
    }
  }, 30_000);
});
