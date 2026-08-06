from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f"Expected marker not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))


path = "tests/scoped-permission-management-migration.test.ts"
replace_once(
    path,
    """  otherTarget: \"a3000000-0000-4000-8000-000000000039\",
  secondOwner: \"a4000000-0000-4000-8000-000000000039\",
  actorAssignment: \"b1000000-0000-4000-8000-000000000039\",
""",
    """  otherTarget: \"a3000000-0000-4000-8000-000000000039\",
  secondOwner: \"a4000000-0000-4000-8000-000000000039\",
  ownerActor: \"a5000000-0000-4000-8000-000000000039\",
  actorAssignment: \"b1000000-0000-4000-8000-000000000039\",
""",
)
replace_once(
    path,
    """  otherAssignment: \"b3000000-0000-4000-8000-000000000039\",
  secondOwnerAssignment: \"b4000000-0000-4000-8000-000000000039\",
  secondCompany: \"c1000000-0000-4000-8000-000000000039\",
""",
    """  otherAssignment: \"b3000000-0000-4000-8000-000000000039\",
  secondOwnerAssignment: \"b4000000-0000-4000-8000-000000000039\",
  ownerActorAssignment: \"b5000000-0000-4000-8000-000000000039\",
  secondCompany: \"c1000000-0000-4000-8000-000000000039\",
""",
)
replace_once(
    path,
    """    requesterRoleId: string;
    ownerRoleId: string;
    existingOwnerId: string;
    existingOwnerAssignmentId: string;
  }>(`
""",
    """    requesterRoleId: string;
    ownerRoleId: string;
  }>(`
""",
)
replace_once(
    path,
    """      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS \"ownerRoleId\",
      owner.id::text AS \"existingOwnerId\",
      owner_assignment.id::text AS \"existingOwnerAssignmentId\"
    FROM companies first_company
    JOIN branches first_branch ON first_branch.company_id=first_company.id
    JOIN users owner ON owner.is_owner AND owner.active
    JOIN role_assignments owner_assignment
      ON owner_assignment.user_id=owner.id AND owner_assignment.active
    ORDER BY first_company.id,first_branch.id
""",
    """      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS \"ownerRoleId\"
    FROM companies first_company
    JOIN branches first_branch ON first_branch.company_id=first_company.id
    ORDER BY first_company.id,first_branch.id
""",
)
replace_once(
    path,
    """    ) VALUES
      ($1,'permission-actor@example.test','Permission actor','not-a-real-hash',
        $5,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'permission-target@example.test','Permission target','not-a-real-hash',
        $6,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'permission-other@example.test','Permission other','not-a-real-hash',
        $6,$10,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'permission-owner@example.test','Permission owner','not-a-real-hash',
        $7,NULL,true,now(),'PLATFORM','ACTIVE',true,1)
  `, [
    ids.actor,
    ids.target,
    ids.otherTarget,
    ids.secondOwner,
    value.companyAdminRoleId,
    value.requesterRoleId,
    value.ownerRoleId,
    null,
    value.companyId,
    value.secondCompanyId,
  ]);
""",
    """    ) VALUES
      ($1,'permission-actor@example.test','Permission actor','not-a-real-hash',
        $6,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'permission-target@example.test','Permission target','not-a-real-hash',
        $7,$9,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'permission-other@example.test','Permission other','not-a-real-hash',
        $7,$10,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'permission-owner-actor@example.test','Permission owner actor',
        'not-a-real-hash',$8,NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($5,'permission-owner-target@example.test','Permission owner target',
        'not-a-real-hash',$8,NULL,true,now(),'PLATFORM','ACTIVE',true,1)
  `, [
    ids.actor,
    ids.target,
    ids.otherTarget,
    ids.ownerActor,
    ids.secondOwner,
    value.companyAdminRoleId,
    value.requesterRoleId,
    value.ownerRoleId,
    value.companyId,
    value.secondCompanyId,
  ]);
""",
)
replace_once(
    path,
    """    ) VALUES
      ($1,$5,$8,'COMPANY',$9,NULL,true),
      ($2,$6,$10,'BRANCH',$9,$11,true),
      ($3,$7,$10,'BRANCH',$12,$13,true),
      ($4,$14,$15,'PLATFORM',NULL,NULL,true)
  `, [
    ids.actorAssignment,
    ids.targetAssignment,
    ids.otherAssignment,
    ids.secondOwnerAssignment,
    ids.actor,
    ids.target,
    ids.otherTarget,
    value.companyAdminRoleId,
    value.companyId,
    value.requesterRoleId,
    value.branchId,
    value.secondCompanyId,
    value.secondBranchId,
    ids.secondOwner,
    value.ownerRoleId,
  ]);
""",
    """    ) VALUES
      ($1,$6,$11,'COMPANY',$12,NULL,true),
      ($2,$7,$13,'BRANCH',$12,$14,true),
      ($3,$8,$13,'BRANCH',$15,$16,true),
      ($4,$9,$17,'PLATFORM',NULL,NULL,true),
      ($5,$10,$17,'PLATFORM',NULL,NULL,true)
  `, [
    ids.actorAssignment,
    ids.targetAssignment,
    ids.otherAssignment,
    ids.ownerActorAssignment,
    ids.secondOwnerAssignment,
    ids.actor,
    ids.target,
    ids.otherTarget,
    ids.ownerActor,
    ids.secondOwner,
    value.companyAdminRoleId,
    value.companyId,
    value.requesterRoleId,
    value.branchId,
    value.secondCompanyId,
    value.secondBranchId,
    value.ownerRoleId,
  ]);
""",
)
replace_once(
    path,
    """        context.existingOwnerId,
        context.existingOwnerAssignmentId,
        ids.secondOwner,
""",
    """        ids.ownerActor,
        ids.ownerActorAssignment,
        ids.secondOwner,
""",
)
