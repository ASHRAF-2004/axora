import type { SupportedLocale } from "@/lib/i18n";
import type { BranchBudgetRefusalCode } from "@/lib/branch-budget-refusal";

const messages = {
  en: {
    CEILING_EXCEEDED: "This amount exceeds the company authorization limit. Enter an amount within the remaining authorization, or contact Axora to review the company limit.",
    BUDGET_UNAVAILABLE: "This branch has no active budget. Open View budget to review its setup.",
    FORBIDDEN: "Your account cannot add budget to this branch. Refresh to check your current access.",
    COMMAND_MISMATCH: "This request was already used for a different amount. Close and reopen Add budget to start a new request.",
    UNAVAILABLE: "Budget could not be added. Retry this same request, or refresh to check the branch budget.",
    ceiling: "Company authorization limit",allocated: "Allocated authorization",headroom: "Remaining authorization",
  },
  ar: {
    CEILING_EXCEEDED: "يتجاوز هذا المبلغ حد تفويض الشركة. أدخل مبلغاً ضمن التفويض المتبقي، أو تواصل مع أكسورا لمراجعة حد الشركة.",
    BUDGET_UNAVAILABLE: "لا توجد ميزانية نشطة لهذا الفرع. افتح عرض الميزانية لمراجعة إعدادها.",
    FORBIDDEN: "لا يمكن لحسابك إضافة ميزانية لهذا الفرع. حدّث الصفحة للتحقق من صلاحية وصولك الحالية.",
    COMMAND_MISMATCH: "استُخدم هذا الطلب بالفعل لمبلغ مختلف. أغلق إضافة ميزانية وأعد فتحها لبدء طلب جديد.",
    UNAVAILABLE: "تعذرت إضافة الميزانية. أعد محاولة الطلب نفسه، أو حدّث الصفحة للتحقق من ميزانية الفرع.",
    ceiling: "حد تفويض الشركة",allocated: "التفويض المخصص",headroom: "التفويض المتبقي",
  },
  ms: {
    CEILING_EXCEEDED: "Amaun ini melebihi had kebenaran syarikat. Masukkan amaun dalam baki kebenaran, atau hubungi Axora untuk menyemak had syarikat.",
    BUDGET_UNAVAILABLE: "Cawangan ini tiada bajet aktif. Buka Lihat bajet untuk menyemak persediaannya.",
    FORBIDDEN: "Akaun anda tidak boleh menambah bajet cawangan ini. Muat semula untuk menyemak akses semasa anda.",
    COMMAND_MISMATCH: "Permintaan ini telah digunakan untuk amaun lain. Tutup dan buka semula Tambah bajet untuk memulakan permintaan baharu.",
    UNAVAILABLE: "Bajet tidak dapat ditambah. Cuba semula permintaan yang sama, atau muat semula untuk menyemak bajet cawangan.",
    ceiling: "Had kebenaran syarikat",allocated: "Kebenaran yang diperuntukkan",headroom: "Baki kebenaran",
  },
} as const;

export function branchBudgetRefusalMessages(locale: SupportedLocale) { return messages[locale]; }
export function branchBudgetRefusalMessage(locale: SupportedLocale,code: BranchBudgetRefusalCode) {
  return messages[locale][code === "INVALID" ? "UNAVAILABLE" : code];
}
