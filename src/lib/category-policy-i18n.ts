import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    eyebrow: "Procurement settings", title: "Category purchasing rules",
    description: "Limit which catalogue categories may be purchased at each authorized scope. Child rules can only narrow their parent.",
    inherited: "Inherited", enabled: "Restricted", save: "Save rule",
    categories: "Allowed categories", reason: "Reason for change",
    reasonHelp: "Required for the audit trail (at least 3 characters).",
    noScopes: "You do not have an authorized purchasing-policy scope.",
    saved: "Category purchasing rule saved.", stale: "This rule changed. Review the latest version and try again.",
    parent: "A child rule cannot allow a category blocked by its parent.",
    denied: "You are not authorized to manage this purchasing rule.",
    failed: "The purchasing rule could not be saved.",
    company: "Company", branch: "Branch", department: "Department",
    ruleHelp: "Turn on a restriction and select every category that remains allowed. Turning it off inherits the parent rule.",
  },
  ar: {
    eyebrow: "إعدادات المشتريات", title: "قواعد شراء الفئات",
    description: "حدّد فئات الكتالوج المسموح بشرائها في كل نطاق مصرح. يمكن للقواعد الفرعية أن تكون أكثر تقييداً فقط.",
    inherited: "موروثة", enabled: "مقيّدة", save: "حفظ القاعدة",
    categories: "الفئات المسموحة", reason: "سبب التغيير",
    reasonHelp: "مطلوب لسجل التدقيق (3 أحرف على الأقل).",
    noScopes: "لا يوجد نطاق مصرح لك لإدارة سياسة الشراء فيه.",
    saved: "تم حفظ قاعدة شراء الفئات.", stale: "تغيّرت هذه القاعدة. راجع أحدث نسخة وحاول مجدداً.",
    parent: "لا يمكن لقاعدة فرعية السماح بفئة حظرها النطاق الأب.",
    denied: "غير مصرح لك بإدارة قاعدة الشراء هذه.",
    failed: "تعذر حفظ قاعدة الشراء.",
    company: "الشركة", branch: "الفرع", department: "القسم",
    ruleHelp: "فعّل التقييد واختر كل الفئات التي تبقى مسموحة. إيقافه يرث قاعدة النطاق الأب.",
  },
  ms: {
    eyebrow: "Tetapan perolehan", title: "Peraturan pembelian kategori",
    description: "Hadkan kategori katalog yang boleh dibeli bagi setiap skop dibenarkan. Peraturan anak hanya boleh mengetatkan peraturan induk.",
    inherited: "Diwarisi", enabled: "Dihadkan", save: "Simpan peraturan",
    categories: "Kategori dibenarkan", reason: "Sebab perubahan",
    reasonHelp: "Diperlukan untuk jejak audit (sekurang-kurangnya 3 aksara).",
    noScopes: "Anda tiada skop polisi pembelian yang dibenarkan.",
    saved: "Peraturan pembelian kategori disimpan.", stale: "Peraturan ini telah berubah. Semak versi terkini dan cuba lagi.",
    parent: "Peraturan anak tidak boleh membenarkan kategori yang disekat oleh induknya.",
    denied: "Anda tidak dibenarkan mengurus peraturan pembelian ini.",
    failed: "Peraturan pembelian tidak dapat disimpan.",
    company: "Syarikat", branch: "Cawangan", department: "Jabatan",
    ruleHelp: "Hidupkan sekatan dan pilih semua kategori yang kekal dibenarkan. Mematikannya akan mewarisi peraturan induk.",
  },
} as const;

export function categoryPolicyMessages(locale: SupportedLocale) {
  return messages[locale] ?? messages.en;
}
