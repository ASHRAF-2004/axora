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
import {
  createManagedWebhookSubscription,
  retryManagedWebhookDelivery,
  revokeManagedWebhookSubscription,
  rotateManagedWebhookCredential,
  WebhookManagementError,
} from "@/lib/integrations/webhooks";
import {
  INTEGRATION_EVENT_TYPE_SET,
  type IntegrationEventType,
} from "@/lib/integrations/events";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";

export type IntegrationActionState = {
  status: "idle" | "success" | "error";
  operation?: "create" | "rotate" | "disconnect" | "status";
  credential?: { clientId?: string; clientSecret?: string };
};

export type WebhookActionState = {
  status: "idle" | "success" | "error";
  operation?: "create" | "rotate" | "revoke" | "retry";
  credential?: { secret: string; version: number };
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

function webhookFailed(
  operation: WebhookActionState["operation"],
): WebhookActionState {
  return { status: "error",operation };
}

export async function createWebhookSubscriptionAction(
  _previous: WebhookActionState,
  formData: FormData,
): Promise<WebhookActionState> {
  const actor=await requirePermission("manage_company_integrations");
  const eventTypes=formData.getAll("eventTypes").flatMap((value)=>
    typeof value==="string"&&INTEGRATION_EVENT_TYPE_SET.has(value)
      ? [value as IntegrationEventType]:[]);
  try{
    const result=await createManagedWebhookSubscription({
      actor,connectionId:readFormText(formData,"connectionId"),
      payload:{
        endpoint_url:readFormText(formData,"endpointUrl"),
        event_types:eventTypes,
      },
    });
    revalidatePath("/integrations");
    return {status:"success",operation:"create",
      ...(result.credential?{
        credential:{secret:result.credential,version:1},
      }:{}),
    };
  }catch(error){
    if(error instanceof WebhookManagementError)return webhookFailed("create");
    throw error;
  }
}

export async function rotateWebhookCredentialAction(
  _previous: WebhookActionState,
  formData: FormData,
): Promise<WebhookActionState> {
  const actor=await requirePermission("manage_company_integrations");
  if(readFormText(formData,"confirmation")!=="yes")return webhookFailed("rotate");
  try{
    const result=await rotateManagedWebhookCredential(
      actor,readFormText(formData,"subscriptionId"),
      readFormText(formData,"companyId"),
    );
    revalidatePath("/integrations");
    return {status:"success",operation:"rotate",
      ...(result.credential?{credential:{
        secret:result.credential,version:result.credentialVersion,
      }}:{}),
    };
  }catch(error){
    if(error instanceof WebhookManagementError)return webhookFailed("rotate");
    throw error;
  }
}

export async function revokeWebhookSubscriptionAction(
  _previous: WebhookActionState,
  formData: FormData,
): Promise<WebhookActionState> {
  const actor=await requirePermission("manage_company_integrations");
  if(readFormText(formData,"confirmation")!=="yes")return webhookFailed("revoke");
  try{
    await revokeManagedWebhookSubscription(
      actor,readFormText(formData,"subscriptionId"),
      readFormText(formData,"companyId"),
    );
    revalidatePath("/integrations");
    return {status:"success",operation:"revoke"};
  }catch(error){
    if(error instanceof WebhookManagementError)return webhookFailed("revoke");
    throw error;
  }
}

export async function retryWebhookDeliveryAction(
  _previous: WebhookActionState,
  formData: FormData,
): Promise<WebhookActionState> {
  const actor=await requirePermission("manage_company_integrations");
  if(readFormText(formData,"confirmation")!=="yes")return webhookFailed("retry");
  try{
    await retryManagedWebhookDelivery(
      actor,readFormText(formData,"deliveryId"),
      readFormText(formData,"companyId"),
    );
    revalidatePath("/integrations");
    return {status:"success",operation:"retry"};
  }catch(error){
    if(error instanceof WebhookManagementError)return webhookFailed("retry");
    throw error;
  }
}
