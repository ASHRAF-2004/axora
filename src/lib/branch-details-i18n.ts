import type { SupportedLocale } from "@/lib/i18n";

const messages = {
  en: {
    edit: "Edit branch",
    editTitle: "Edit branch information",
    editBody: "Update the branch contact and operating details. Delivery location is managed separately.",
    contact: "Contact information",
    save: "Save branch",
    saving: "Saving branch…",
    cancel: "Cancel",
    invalid: "Check the branch details and try again.",
    duplicate: "Another branch in this company already uses that name.",
    unavailable: "The branch could not be updated. No changes were saved.",
    saved: "Branch information saved.",
    deliveryInstructions: "Delivery instructions",
    notes: "Notes",
    notProvided: "Not provided",
  },
  ar: {
    edit: "تعديل الفرع",
    editTitle: "تعديل معلومات الفرع",
    editBody: "حدّث بيانات الاتصال والتشغيل للفرع. يُدار موقع التسليم بشكل منفصل.",
    contact: "معلومات الاتصال",
    save: "حفظ الفرع",
    saving: "جارٍ حفظ الفرع…",
    cancel: "إلغاء",
    invalid: "تحقق من بيانات الفرع ثم حاول مرة أخرى.",
    duplicate: "يوجد فرع آخر في هذه الشركة يستخدم هذا الاسم.",
    unavailable: "تعذر تحديث الفرع. لم يتم حفظ أي تغييرات.",
    saved: "تم حفظ معلومات الفرع.",
    deliveryInstructions: "تعليمات التسليم",
    notes: "ملاحظات",
    notProvided: "غير متوفر",
  },
  ms: {
    edit: "Edit cawangan",
    editTitle: "Edit maklumat cawangan",
    editBody: "Kemas kini butiran hubungan dan operasi cawangan. Lokasi penghantaran diurus secara berasingan.",
    contact: "Maklumat hubungan",
    save: "Simpan cawangan",
    saving: "Menyimpan cawangan…",
    cancel: "Batal",
    invalid: "Semak butiran cawangan dan cuba lagi.",
    duplicate: "Cawangan lain dalam syarikat ini sudah menggunakan nama tersebut.",
    unavailable: "Cawangan tidak dapat dikemas kini. Tiada perubahan disimpan.",
    saved: "Maklumat cawangan disimpan.",
    deliveryInstructions: "Arahan penghantaran",
    notes: "Catatan",
    notProvided: "Tidak diberikan",
  },
} as const;

export function branchDetailsMessages(locale: SupportedLocale = "en") {
  return messages[locale];
}
