"use server";

import { requirePermission, requireRecentStepUp } from "@/lib/auth";
import {
  addCompanyLeadNote,
  addCompanyLeadTask,
  anonymizeCompanyLead,
  assignCompanyLead,
  COMPANY_LEAD_STATUSES,
  completeCompanyLeadTask,
  convertCompanyLead,
  resolveCompanyLeadDuplicate,
  transitionCompanyLead,
} from "@/lib/company-leads";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function actor() {
  const current = await requirePermission("manage_companies");
  await requireRecentStepUp(current, "/companies/leads");
  return current;
}

function finish(notice: string, leadId: string) {
  revalidatePath("/companies/leads");
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  redirect(`/companies/leads?notice=${encodeURIComponent(notice)}&lead=${encodeURIComponent(leadId)}`);
}

export async function assignCompanyLeadAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), managerUserId: z.uuid(), reason: z.string().min(3).max(1000),
  }).parse({
    leadId: value(formData, "leadId"),
    managerUserId: value(formData, "managerUserId"),
    reason: value(formData, "reason"),
  });
  await assignCompanyLead(current, input.leadId, input.managerUserId, input.reason);
  finish("lead-assigned", input.leadId);
}

export async function transitionCompanyLeadAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), status: z.enum(COMPANY_LEAD_STATUSES),
    reason: z.string().min(3).max(1000),
  }).parse({
    leadId: value(formData, "leadId"), status: value(formData, "status"),
    reason: value(formData, "reason"),
  });
  await transitionCompanyLead(current, input.leadId, input.status, input.reason);
  finish("lead-status-updated", input.leadId);
}

export async function resolveCompanyLeadDuplicateAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), candidateId: z.uuid(), resolution: z.enum(["CLEAR", "CONFIRM"]),
    reason: z.string().min(3).max(1000),
  }).parse({
    leadId: value(formData, "leadId"), candidateId: value(formData, "candidateId"),
    resolution: value(formData, "resolution"), reason: value(formData, "reason"),
  });
  await resolveCompanyLeadDuplicate(current, input.leadId, input.candidateId, input.resolution, input.reason);
  finish("lead-duplicate-reviewed", input.leadId);
}

export async function addCompanyLeadNoteAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), noteType: z.enum(["INTERNAL", "CONTACT_ATTEMPT", "INFORMATION_RECEIVED"]),
    note: z.string().min(2).max(5000),
  }).parse({
    leadId: value(formData, "leadId"), noteType: value(formData, "noteType"),
    note: value(formData, "note"),
  });
  await addCompanyLeadNote(current, input.leadId, input.noteType, input.note);
  finish("lead-note-added", input.leadId);
}

export async function addCompanyLeadTaskAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), title: z.string().min(2).max(240), dueAt: z.coerce.date(),
    assignedUserId: z.uuid(),
  }).parse({
    leadId: value(formData, "leadId"), title: value(formData, "title"),
    dueAt: value(formData, "dueAt"), assignedUserId: value(formData, "assignedUserId"),
  });
  await addCompanyLeadTask(current, input.leadId, input.title, input.dueAt, input.assignedUserId);
  finish("lead-task-added", input.leadId);
}

export async function completeCompanyLeadTaskAction(formData: FormData) {
  const current = await actor();
  const input = z.object({
    leadId: z.uuid(), taskId: z.uuid(), completionNote: z.string().max(1000),
  }).parse({
    leadId: value(formData, "leadId"), taskId: value(formData, "taskId"),
    completionNote: value(formData, "completionNote"),
  });
  await completeCompanyLeadTask(current, input.leadId, input.taskId, input.completionNote);
  finish("lead-task-completed", input.leadId);
}

export async function convertCompanyLeadAction(formData: FormData) {
  const current = await actor();
  const leadId = z.uuid().parse(value(formData, "leadId"));
  const reason = z.string().min(3).max(1000).parse(value(formData, "reason"));
  await convertCompanyLead(current, leadId, reason);
  finish("lead-converted", leadId);
}

export async function anonymizeCompanyLeadAction(formData: FormData) {
  const current = await actor();
  const leadId = z.uuid().parse(value(formData, "leadId"));
  const reason = z.string().min(3).max(1000).parse(value(formData, "reason"));
  await anonymizeCompanyLead(current, leadId, reason);
  finish("lead-anonymized", leadId);
}
