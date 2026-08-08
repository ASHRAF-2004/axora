from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if new in source:
        return
    if source.count(old) != 1:
        raise RuntimeError(
            f"Expected one patch anchor in {path}, found {source.count(old)}"
        )
    file.write_text(source.replace(old, new, 1))


replace_once(
    "src/lib/account-setup.ts",
    '  type UserCreationInput,\n} from "./users";\n',
    '  type UserCreationInput,\n} from "./users";\n'
    'import {\n'
    '  lockAuthorizedInvitationCreationScope,\n'
    '  lockAuthorizedInvitationTarget,\n'
    '} from "./account-invitation-isolation";\n',
)
replace_once(
    "src/lib/account-setup.ts",
    '    async (client) => {\n'
    '      await enforceInvitationQuota(client, actor.id, resolved.companyId);',
    '    async (client) => {\n'
    '      await lockAuthorizedInvitationCreationScope(client, actor, resolved);\n'
    '      await enforceInvitationQuota(client, actor.id, resolved.companyId);',
)
replace_once(
    "src/lib/account-setup.ts",
    '    async (client) => {\n'
    '      const targetResult = await client.query<ExistingInvitationTarget>(',
    '    async (client) => {\n'
    '      await lockAuthorizedInvitationTarget(client, actor, userId);\n'
    '      const targetResult = await client.query<ExistingInvitationTarget>(',
)

replace_once(
    "src/app/(portal)/users/actions.ts",
    'import {\n'
    '  lockAuthorizedUserTarget,\n'
    '  setAuthorizedUserActive,\n'
    '} from "@/lib/user-isolation";',
    'import { setAuthorizedUserActive } from "@/lib/user-isolation";',
)
replace_once(
    "src/app/(portal)/users/actions.ts",
    '  await lockAuthorizedUserTarget(actor, safeUserId, "user.invite");\n',
    '',
)

replace_once(
    "src/lib/scoped-operations.ts",
    'import { randomUUID } from "node:crypto";\n',
    '',
)
replace_once(
    "src/lib/scoped-operations.ts",
    'import { roundMoney } from "./domain";\n',
    '',
)

replace_once(
    "tests/account-setup-lifecycle.test.ts",
    '    notifyWorkflowUsers: vi.fn(),\n',
    '    notifyWorkflowUsers: vi.fn(),\n'
    '    lockInvitationCreation: vi.fn(),\n'
    '    lockInvitationTarget: vi.fn(),\n',
)
replace_once(
    "tests/account-setup-lifecycle.test.ts",
    'vi.mock("@/lib/workflow-repository", () => ({\n'
    '  appendWorkflowEvent: mocks.appendWorkflowEvent,\n'
    '  notifyWorkflowUsers: mocks.notifyWorkflowUsers,\n'
    '}));\n',
    'vi.mock("@/lib/workflow-repository", () => ({\n'
    '  appendWorkflowEvent: mocks.appendWorkflowEvent,\n'
    '  notifyWorkflowUsers: mocks.notifyWorkflowUsers,\n'
    '}));\n\n'
    'vi.mock("@/lib/account-invitation-isolation", () => ({\n'
    '  lockAuthorizedInvitationCreationScope: mocks.lockInvitationCreation,\n'
    '  lockAuthorizedInvitationTarget: mocks.lockInvitationTarget,\n'
    '}));\n',
)
