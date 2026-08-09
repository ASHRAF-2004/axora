import type { SupportedLocale } from "./i18n";
import type {
  DashboardComparison,
  DashboardPeriodIssue,
  DashboardPeriodPreset,
} from "./dashboard-period";

type PeriodMessages = {
  title: string;
  description: string;
  preset: string;
  presets: Record<DashboardPeriodPreset, string>;
  start: string;
  end: string;
  branch: string;
  allBranches: string;
  compare: string;
  apply: string;
  reset: string;
  export: string;
  inclusiveRule: string;
  generated: (value: string) => string;
  summary: (start: string, end: string, zone: string) => string;
  comparisonPeriod: (start: string, end: string) => string;
  currentSnapshot: string;
  issues: Record<DashboardPeriodIssue, string>;
  invalidBranch: string;
  comparison: (delta: DashboardComparison, value: string, percent: string) => string;
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
    compare: "Compare with the previous equivalent period",
    apply: "Apply period",
    reset: "Reset",
    export: "Export dashboard",
    inclusiveRule: "Start is inclusive; the day after the displayed end is the exclusive boundary.",
    generated: (value) => "Fresh data generated " + value,
    summary: (start, end, zone) => start + " to " + end + " · " + zone,
    comparisonPeriod: (start, end) => "Compared with " + start + " to " + end,
    currentSnapshot: "Current configuration snapshot; not period-filtered",
    issues: {
      "invalid-preset": "The requested preset was invalid. Current month was applied.",
      "invalid-custom-date": "Choose a valid custom start and end date. Current month was applied.",
      "start-after-end": "The custom start date must not be after the end date. Current month was applied.",
      "range-too-large": "Custom ranges cannot exceed ten years. Current month was applied.",
    },
    invalidBranch: "The requested branch scope is unavailable. Your authorized default scope was applied.",
    comparison: (delta, value, percent) => {
      if (delta.direction === "same") return "No change from " + value;
      if (delta.percentage === null) return (delta.direction === "up" ? "Up " : "Down ") + value + " · new from zero";
      return (delta.direction === "up" ? "Up " : "Down ") + value + " · " + percent;
    },
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
    compare: "مقارنة بالفترة السابقة المكافئة",
    apply: "تطبيق الفترة",
    reset: "إعادة ضبط",
    export: "تصدير لوحة المعلومات",
    inclusiveRule: "تاريخ البداية مشمول، واليوم التالي لتاريخ النهاية المعروض هو الحد غير المشمول.",
    generated: (value) => "بيانات محدثة تم إنشاؤها " + value,
    summary: (start, end, zone) => start + " إلى " + end + " · " + zone,
    comparisonPeriod: (start, end) => "مقارنة مع " + start + " إلى " + end,
    currentSnapshot: "لقطة الإعداد الحالي وليست مقيدة بالفترة",
    issues: {
      "invalid-preset": "الفترة المطلوبة غير صالحة. تم تطبيق الشهر الحالي.",
      "invalid-custom-date": "اختر تاريخ بداية ونهاية صالحين. تم تطبيق الشهر الحالي.",
      "start-after-end": "يجب ألا يكون تاريخ البداية بعد تاريخ النهاية. تم تطبيق الشهر الحالي.",
      "range-too-large": "لا يمكن أن يتجاوز النطاق المخصص عشر سنوات. تم تطبيق الشهر الحالي.",
    },
    invalidBranch: "نطاق الفرع المطلوب غير متاح. تم تطبيق نطاقك المخول الافتراضي.",
    comparison: (delta, value, percent) => {
      if (delta.direction === "same") return "لا تغيير عن " + value;
      if (delta.percentage === null) return (delta.direction === "up" ? "ارتفاع " : "انخفاض ") + value + " · جديد من الصفر";
      return (delta.direction === "up" ? "ارتفاع " : "انخفاض ") + value + " · " + percent;
    },
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
    compare: "Bandingkan dengan tempoh setara sebelumnya",
    apply: "Gunakan tempoh",
    reset: "Tetapkan semula",
    export: "Eksport papan pemuka",
    inclusiveRule: "Tarikh mula disertakan; hari selepas tarikh akhir yang dipaparkan ialah sempadan eksklusif.",
    generated: (value) => "Data baharu dijana " + value,
    summary: (start, end, zone) => start + " hingga " + end + " · " + zone,
    comparisonPeriod: (start, end) => "Dibandingkan dengan " + start + " hingga " + end,
    currentSnapshot: "Syot kilat konfigurasi semasa; tidak ditapis mengikut tempoh",
    issues: {
      "invalid-preset": "Pratetap yang diminta tidak sah. Bulan semasa digunakan.",
      "invalid-custom-date": "Pilih tarikh mula dan akhir tersuai yang sah. Bulan semasa digunakan.",
      "start-after-end": "Tarikh mula tersuai tidak boleh selepas tarikh akhir. Bulan semasa digunakan.",
      "range-too-large": "Julat tersuai tidak boleh melebihi sepuluh tahun. Bulan semasa digunakan.",
    },
    invalidBranch: "Skop cawangan yang diminta tidak tersedia. Skop lalai dibenarkan anda digunakan.",
    comparison: (delta, value, percent) => {
      if (delta.direction === "same") return "Tiada perubahan daripada " + value;
      if (delta.percentage === null) return (delta.direction === "up" ? "Naik " : "Turun ") + value + " · baharu daripada sifar";
      return (delta.direction === "up" ? "Naik " : "Turun ") + value + " · " + percent;
    },
  },
};

export function dashboardPeriodMessages(locale: SupportedLocale) {
  return messages[locale];
}
