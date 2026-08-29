"use server";

import { requirePermission } from "@/lib/auth";
import {
  createIntegrationApplication,
  disconnectIntegration,
  IntegrationManagementError,
  rotateIntegrationClientSecret,
  setIntegrationApplicationActive,
} from "@/lib/integrations/management";
import { integrationScopeSchema } from "@/lib/integrations/scopes";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export type IntegrationActionState = {
  status: "idle" | "success" | "error";
  operation?: "create" | "rotate" | "disconnect" | "status";
  credential?: { clientId?: string; clientSecret?: string };
};

function failed(operation: IntegrationActionState["operation"]): IntegrationActionState {
  return { status: "error", operation };
}

export async function createIntegrationApplicationAction(
  _previous: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const actor = await requirePermission("manage_integration_applications");
  const clientType = readFormText(formData, "clientType");
  const redirectUris = readFormText(formData, "redirectUris")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedScopes = formData.getAll("allowedScopes").flatMap((value) => {
    if (typeof value !== "string") return [];
    const parsed = integrationScopeSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  try {
    const result = await createIntegrationApplication(actor, {
      name: readFormText(formData, "name"),
      slug: readFormText(formData, "slug"),
      description: readFormText(formData, "description"),
      clientType: clientType === "PUBLIC" ? "PUBLIC" : "CONFIDENTIAL",
      tokenEndpointAuthMethod: clientType === "PUBLIC" ? "none" : "client_secret_basic",
      redirectUris,
      allowedScopes,
    });
    revalidatePath("/integrations");
    return {
      status: "success",
      operation: "create",
      credential: {
        clientId: result.clientId,
        ...(result.clientSecret ? { clientSecret: result.clientSecret } : {}),
      },
    };
  } catch (error) {
    if (error instanceof IntegrationManagementError) return failed("create");
    throw error;
  }
}

export async function rotateIntegrationClientSecretAction(
  _previous: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const actor = await requirePermission("manage_integration_applications");
  if (readFormText(formData, "confirmation") !== "yes") return failed("rotate");
  try {
    const result = await rotateIntegrationClientSecret(
      actor,
      readFormText(formData, "applicationId"),
    );
    revalidatePath("/integrations");
    return {
      status: "success",
      operation: "rotate",
      credential: { clientSecret: result.clientSecret },
    };
  } catch (error) {
    if (error instanceof IntegrationManagementError) return failed("rotate");
    throw error;
  }
}

export async function setIntegrationApplicationStatusAction(
  _previous: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const actor = await requirePermission("manage_integration_applications");
  const active = readFormText(formData, "active") === "true";
  if (!active && readFormText(formData, "confirmation") !== "yes") {
    return failed("status");
  }
  try {
    await setIntegrationApplicationActive(
      actor,
      readFormText(formData, "applicationId"),
      active,
    );
    revalidatePath("/integrations");
    return { status: "success", operation: "status" };
  } catch (error) {
    if (error instanceof IntegrationManagementError) return failed("status");
    throw error;
  }
}

export async function disconnectIntegrationAction(
  _previous: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const actor = await requirePermission("manage_company_integrations");
  if (readFormText(formData, "confirmation") !== "yes") {
    return failed("disconnect");
  }
  try {
    await disconnectIntegration(actor, readFormText(formData, "connectionId"));
    revalidatePath("/integrations");
    return { status: "success", operation: "disconnect" };
  } catch (error) {
    if (error instanceof IntegrationManagementError) return failed("disconnect");
    throw error;
  }
}
