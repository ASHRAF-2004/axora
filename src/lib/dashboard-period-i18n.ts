import type { SupportedLocale } from "./i18n";
import type { DashboardPeriodIssue, DashboardPeriodPreset } from "./dashboard-period";

type PeriodMessages = {
  title: string;
  description: string;
  preset: string;
  presets: Record<DashboardPeriodPreset, string>;
  start: string;
  end: string;
  branch: string;
  allBranches: string;
  apply: string;
  reset: string;
  export: string;
  inclusiveRule: string;
  generated: (value: string) => string;
  summary: (start: string, end: string, zone: string) => string;
  currentSnapshot: string;
  issues: Record<DashboardPeriodIssue, string>;
  invalidBranch: string;
};

const messages: Record<SupportedLocale, PeriodMessages> = {
  en: {
    title: "Reporting period",
    description: "Every period metric below uses the same authorized request cohort.",
    preset: "Period",
    presets: {
      "current-month": "Current month",
      "previous-month": "Previous month",
      "last-3-months": "Last 3 months",
      "last-6-months": "Last 6 months",
      "year-to-date": "Year to date",
      "previous-year": "Previous year",
      custom: "Custom date range",
    },
    start: "Start date",
    end: "End date",
    branch: "Branch scope",
    allBranches: "All authorized branches",
    apply: "Apply period",
    reset: "Reset",
    export: "Export dashboard",
    inclusiveRule: "Start is inclusive; the day after the displayed end is the exclusive boundary.",
    generated: (value) => "Fresh data generated " + value,
    summary: (start, end, zone) => start + " to " + end + " · " + zone,
    currentSnapshot: "Current configuration snapshot; not period-filtered",
    issues: {
      "invalid-preset": "The requested preset was invalid. Current month was applied.",
      "invalid-custom-date": "Choose a valid custom start and end date. Current month was applied.",
      "start-after-end": "The custom start date must not be after the end date. Current month was applied.",
      "range-too-large": "Custom ranges cannot exceed ten years. Current month was applied.",
    },
    invalidBranch: "The requested branch scope is unavailable. Your authorized default scope was applied.",
  },
  ar: {
    title: "فترة التقارير",
    description: "تستخدم جميع مؤشرات الفترة أدناه مجموعة طلبات مخولة واحدة.",
    preset: "الفترة",
    presets: {
      "current-month": "الشهر الحالي",
      "previous-month": "الشهر السابق",
      "last-3-months": "آخر 3 أشهر",
      "last-6-months": "آخر 6 أشهر",
      "year-to-date": "من بداية السنة",
      "previous-year": "السنة السابقة",
      custom: "نطاق تاريخ مخصص",
    },
    start: "تاريخ البداية",
    end: "تاريخ النهاية",
    branch: "نطاق الفرع",
    allBranches: "جميع الفروع المخولة",
    apply: "تطبيق الفترة",
    reset: "إعادة ضبط",
    export: "تصدير لوحة المعلومات",
    inclusiveRule: "تاريخ البداية مشمول، واليوم التالي لتاريخ النهاية المعروض هو الحد غير المشمول.",
    generated: (value) => "بيانات محدثة تم إنشاؤها " + value,
    summary: (start, end, zone) => start + " إلى " + end + " · " + zone,
    currentSnapshot: "لقطة الإعداد الحالي وليست مقيدة بالفترة",
    issues: {
      "invalid-preset": "الفترة المطلوبة غير صالحة. تم تطبيق الشهر الحالي.",
      "invalid-custom-date": "اختر تاريخ بداية ونهاية صالحين. تم تطبيق الشهر الحالي.",
      "start-after-end": "يجب ألا يكون تاريخ البداية بعد تاريخ النهاية. تم تطبيق الشهر الحالي.",
      "range-too-large": "لا يمكن أن يتجاوز النطاق المخصص عشر سنوات. تم تطبيق الشهر الحالي.",
    },
    invalidBranch: "نطاق الفرع المطلوب غير متاح. تم تطبيق نطاقك المخول الافتراضي.",
  },
  ms: {
    title: "Tempoh pelaporan",
    description: "Semua metrik tempoh di bawah menggunakan kohort permintaan dibenarkan yang sama.",
    preset: "Tempoh",
    presets: {
      "current-month": "Bulan semasa",
      "previous-month": "Bulan sebelumnya",
      "last-3-months": "3 bulan terakhir",
      "last-6-months": "6 bulan terakhir",
      "year-to-date": "Tahun hingga kini",
      "previous-year": "Tahun sebelumnya",
      custom: "Julat tarikh tersuai",
    },
    start: "Tarikh mula",
    end: "Tarikh akhir",
    branch: "Skop cawangan",
    allBranches: "Semua cawangan dibenarkan",
    apply: "Gunakan tempoh",
    reset: "Tetapkan semula",
    export: "Eksport papan pemuka",
    inclusiveRule: "Tarikh mula disertakan; hari selepas tarikh akhir yang dipaparkan ialah sempadan eksklusif.",
    generated: (value) => "Data baharu dijana " + value,
    summary: (start, end, zone) => start + " hingga " + end + " · " + zone,
    currentSnapshot: "Syot kilat konfigurasi semasa; tidak ditapis mengikut tempoh",
    issues: {
      "invalid-preset": "Pratetap yang diminta tidak sah. Bulan semasa digunakan.",
      "invalid-custom-date": "Pilih tarikh mula dan akhir tersuai yang sah. Bulan semasa digunakan.",
      "start-after-end": "Tarikh mula tersuai tidak boleh selepas tarikh akhir. Bulan semasa digunakan.",
      "range-too-large": "Julat tersuai tidak boleh melebihi sepuluh tahun. Bulan semasa digunakan.",
    },
    invalidBranch: "Skop cawangan yang diminta tidak tersedia. Skop lalai dibenarkan anda digunakan.",
  },
};

export function dashboardPeriodMessages(locale: SupportedLocale) {
  return messages[locale];
}
