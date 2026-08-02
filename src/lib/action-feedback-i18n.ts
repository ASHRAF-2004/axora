import type { SupportedLocale } from "./i18n";

export const ACTION_FEEDBACK_CODES = [
  "approval.reason_required", "approval.check_information", "approval.approved", "approval.rejected",
  "approval.decision_failed", "approval.choice_required", "approval.not_assigned", "approval.request_not_found",
  "approval.branch_inactive", "approval.not_pending", "approval.self_approval", "approval.final_decision", "approval.over_budget",
] as const;
export type ActionFeedbackCode = (typeof ACTION_FEEDBACK_CODES)[number];

const messages: Record<SupportedLocale, Record<ActionFeedbackCode, string>> = {
  en: {
    "approval.reason_required": "Enter a reason before rejecting this purchase request.", "approval.check_information": "Check the approval information and try again.", "approval.approved": "Purchase request approved.", "approval.rejected": "Purchase request rejected.", "approval.decision_failed": "The decision could not be saved. Please try again. If the problem continues, contact an administrator.", "approval.choice_required": "Choose Approve or Reject.", "approval.not_assigned": "Only an assigned company approver can decide this request.", "approval.request_not_found": "Request not found.", "approval.branch_inactive": "This branch is inactive and cannot approve new spending.", "approval.not_pending": "This request is not pending approval for your branch.", "approval.self_approval": "You cannot approve your own purchase request.", "approval.final_decision": "This purchase request already has a final company decision.", "approval.over_budget": "This request exceeds the branch's available monthly budget.",
  },
  ar: {
    "approval.reason_required": "أدخل سبباً قبل رفض طلب الشراء.", "approval.check_information": "تحقق من معلومات الاعتماد وحاول مرة أخرى.", "approval.approved": "تم اعتماد طلب الشراء.", "approval.rejected": "تم رفض طلب الشراء.", "approval.decision_failed": "تعذر حفظ القرار. حاول مرة أخرى، وإذا استمرت المشكلة فتواصل مع المدير.", "approval.choice_required": "اختر الاعتماد أو الرفض.", "approval.not_assigned": "لا يقرر هذا الطلب إلا معتمد معين من الشركة.", "approval.request_not_found": "لم يتم العثور على الطلب.", "approval.branch_inactive": "هذا الفرع غير نشط ولا يمكنه اعتماد إنفاق جديد.", "approval.not_pending": "هذا الطلب ليس بانتظار الاعتماد لفرعك.", "approval.self_approval": "لا يمكنك اعتماد طلب الشراء الخاص بك.", "approval.final_decision": "لدى طلب الشراء هذا قرار نهائي من الشركة بالفعل.", "approval.over_budget": "يتجاوز هذا الطلب الميزانية الشهرية المتاحة للفرع.",
  },
  ms: {
    "approval.reason_required": "Masukkan sebab sebelum menolak permintaan pembelian ini.", "approval.check_information": "Semak maklumat kelulusan dan cuba lagi.", "approval.approved": "Permintaan pembelian diluluskan.", "approval.rejected": "Permintaan pembelian ditolak.", "approval.decision_failed": "Keputusan tidak dapat disimpan. Cuba lagi. Jika masalah berterusan, hubungi pentadbir.", "approval.choice_required": "Pilih Luluskan atau Tolak.", "approval.not_assigned": "Hanya pelulus syarikat yang ditugaskan boleh memutuskan permintaan ini.", "approval.request_not_found": "Permintaan tidak ditemui.", "approval.branch_inactive": "Cawangan ini tidak aktif dan tidak boleh meluluskan perbelanjaan baharu.", "approval.not_pending": "Permintaan ini tidak menunggu kelulusan untuk cawangan anda.", "approval.self_approval": "Anda tidak boleh meluluskan permintaan pembelian sendiri.", "approval.final_decision": "Permintaan pembelian ini sudah mempunyai keputusan akhir syarikat.", "approval.over_budget": "Permintaan ini melebihi bajet bulanan cawangan yang tersedia.",
  },
};

const approvalErrorCodes = new Map<string, ActionFeedbackCode>([
  ["A rejection reason is required.", "approval.reason_required"], ["Choose Approve or Reject.", "approval.choice_required"],
  ["Only an assigned company approver can decide this request.", "approval.not_assigned"], ["Request not found.", "approval.request_not_found"],
  ["This branch is inactive and cannot approve new spending.", "approval.branch_inactive"], ["This request is not pending approval for your branch.", "approval.not_pending"],
  ["You cannot approve your own purchase request.", "approval.self_approval"], ["This purchase request already has a final company decision.", "approval.final_decision"],
  ["This request exceeds the branch's available monthly budget.", "approval.over_budget"],
]);

export function actionFeedback(code: ActionFeedbackCode, locale: SupportedLocale = "en") { return messages[locale][code]; }
export function publicApprovalErrorCode(message: string) { return approvalErrorCodes.get(message); }
export const ACTION_FEEDBACK_MESSAGES = messages;
