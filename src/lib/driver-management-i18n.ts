import type { SupportedLocale } from "./i18n";

const messages = {
  en: {
    eyebrow: "Delivery operations", title: "Manage Delivery Agents", intro: "Monitor Delivery Agent availability, current work, completed jobs and authorized live location.",
    driver: "Delivery Agent", state: "Account", active: "Active", deactivated: "Deactivated", availability: "Availability", available: "Available", unavailable: "Unavailable", offline: "Offline", availabilityUnknown: "Availability unavailable", current: "Current job", none: "No active job", completed: "Completed jobs", location: "Last location", noLocation: "No location", stale: "Stale / offline", profile: "Delivery Agent profile", contact: "Contact", vehicle: "Vehicle", notRecorded: "Not recorded", history: "Completed-job history", noHistory: "No completed jobs yet", actions: "Account actions", reset: "Send secure password reset", deactivate: "Deactivate Delivery Agent", activate: "Activate Delivery Agent", delete: "Delete Delivery Agent", reason: "Deletion reason", confirm: "I understand access is permanently revoked.", blocked: "Resolve the active job before deactivating or deleting this Delivery Agent.", recover: "Recover stuck job", release: "Return job to available pool", recoveryTerminal: "A finished or cancelled delivery cannot be recovered.", recoveryNoAssignment: "This delivery has no active assignment to recover.", recoveryDriverInactive: "The assigned Delivery Agent is no longer active.", recoveryAcceptanceExpired: "The assignment acceptance deadline has expired.", recoveryDriverOffline: "The assigned Delivery Agent has remained offline beyond the recovery threshold.", recoveryTrackingStale: "Tracking and delivery activity are stale beyond the recovery threshold.", recoveryWorkflowStale: "No delivery workflow activity was recorded within the recovery period.", recoveryHealthy: "The active delivery is healthy and cannot be released.", company: "Company", branch: "Branch", loading: "Loading live map…", map: "Live Delivery Agent map", mapHelp: "Authorized operational location only. Route points expire under the delivery tracking retention policy.", mapMissing: "No current Delivery Agent location is available.", mapOutsideCoverage: "The Delivery Agent location is outside the controlled MVP map coverage:", mapUnconfigured: "Operational street mapping is not configured. Location time and accuracy remain available; the regional overview is not presented as street navigation.", mapConfigurationInvalid: "The operational map configuration is invalid. No map is shown.", mapFailed: "The approved map source is unavailable. Location time and accuracy remain visible below.", mapAttribution: "Map attribution", routeMap: "Delivery Agent route map", back: "Back to Delivery Agents",
  },
  ar: {
    eyebrow: "عمليات التوصيل", title: "إدارة مسؤولي التوصيل", intro: "راقب توافر مسؤول التوصيل والعمل الحالي والمهام المكتملة والموقع المباشر المصرح به.",
    driver: "مسؤول التوصيل", state: "الحساب", active: "نشط", deactivated: "معطل", availability: "التوافر", available: "متاح", unavailable: "غير متاح", offline: "غير متصل", availabilityUnknown: "حالة التوافر غير متاحة", current: "المهمة الحالية", none: "لا توجد مهمة نشطة", completed: "المهام المكتملة", location: "آخر موقع", noLocation: "لا يوجد موقع", stale: "قديم / غير متصل", profile: "ملف مسؤول التوصيل", contact: "التواصل", vehicle: "المركبة", notRecorded: "غير مسجل", history: "سجل المهام المكتملة", noHistory: "لا توجد مهام مكتملة بعد", actions: "إجراءات الحساب", reset: "إرسال رابط آمن لإعادة تعيين كلمة المرور", deactivate: "تعطيل مسؤول التوصيل", activate: "تنشيط مسؤول التوصيل", delete: "حذف مسؤول التوصيل", reason: "سبب الحذف", confirm: "أفهم أن الوصول سيُلغى نهائياً.", blocked: "عالج المهمة النشطة قبل تعطيل مسؤول التوصيل هذا أو حذفه.", recover: "استعادة مهمة عالقة", release: "إعادة المهمة إلى قائمة المهام المتاحة", recoveryTerminal: "لا يمكن استعادة مهمة تسليم نهائية.", recoveryNoAssignment: "لا يوجد تعيين نشط يمكن استعادته لهذه المهمة.", recoveryDriverInactive: "مسؤول التوصيل المعيّن لم يعد نشطاً.", recoveryAcceptanceExpired: "انتهت مهلة قبول التعيين.", recoveryDriverOffline: "ظل مسؤول التوصيل المعيّن غير متصل بعد مهلة الاستعادة.", recoveryTrackingStale: "تجاوز نشاط التتبع والتسليم مهلة الاستعادة.", recoveryWorkflowStale: "لم يُسجل نشاط في سير التسليم خلال مهلة الاستعادة.", recoveryHealthy: "مهمة التسليم النشطة سليمة ولا يمكن تحريرها.", company: "الشركة", branch: "الفرع", loading: "جارٍ تحميل الخريطة المباشرة…", map: "خريطة مسؤول التوصيل المباشرة", mapHelp: "موقع تشغيلي مصرح به فقط. تنتهي نقاط المسار وفق سياسة الاحتفاظ بتتبع التوصيل.", mapMissing: "لا يتوفر موقع حالي لمسؤول التوصيل.", mapOutsideCoverage: "موقع مسؤول التوصيل خارج نطاق خريطة النسخة التجريبية المحدودة:", mapUnconfigured: "لم تُهيأ خرائط الشوارع التشغيلية. يبقى وقت الموقع ودقته متاحين، ولا تُعرض الخريطة الإقليمية على أنها خريطة شوارع.", mapConfigurationInvalid: "إعداد الخريطة التشغيلية غير صالح، لذلك لا تُعرض خريطة.", mapFailed: "مصدر الخريطة المعتمد غير متاح. يبقى وقت الموقع ودقته ظاهرين أدناه.", mapAttribution: "نَسب بيانات الخريطة", routeMap: "خريطة مسار مسؤول التوصيل", back: "العودة إلى مسؤولي التوصيل",
  },
  ms: {
    eyebrow: "Operasi penghantaran", title: "Urus Ejen Penghantaran", intro: "Pantau ketersediaan Ejen Penghantaran, kerja semasa, tugasan selesai dan lokasi langsung yang dibenarkan.",
    driver: "Ejen Penghantaran", state: "Akaun", active: "Aktif", deactivated: "Dinyahaktif", availability: "Ketersediaan", available: "Tersedia", unavailable: "Tidak tersedia", offline: "Luar talian", availabilityUnknown: "Ketersediaan tidak diketahui", current: "Tugasan semasa", none: "Tiada tugasan aktif", completed: "Tugasan selesai", location: "Lokasi terakhir", noLocation: "Tiada lokasi", stale: "Lapuk / luar talian", profile: "Profil Ejen Penghantaran", contact: "Hubungan", vehicle: "Kenderaan", notRecorded: "Belum direkod", history: "Sejarah tugasan selesai", noHistory: "Belum ada tugasan selesai", actions: "Tindakan akaun", reset: "Hantar tetapan semula kata laluan selamat", deactivate: "Nyahaktif Ejen Penghantaran", activate: "Aktifkan Ejen Penghantaran", delete: "Padam Ejen Penghantaran", reason: "Sebab pemadaman", confirm: "Saya faham akses dibatalkan secara kekal.", blocked: "Selesaikan tugasan aktif sebelum menyahaktif atau memadam Ejen Penghantaran ini.", recover: "Pulihkan kerja tersekat", release: "Kembalikan kerja ke senarai tersedia", recoveryTerminal: "Penghantaran yang selesai atau dibatalkan tidak boleh dipulihkan.", recoveryNoAssignment: "Penghantaran ini tiada tugasan aktif untuk dipulihkan.", recoveryDriverInactive: "Ejen Penghantaran yang ditugaskan tidak lagi aktif.", recoveryAcceptanceExpired: "Tempoh penerimaan tugasan telah tamat.", recoveryDriverOffline: "Ejen Penghantaran yang ditugaskan kekal di luar talian melebihi ambang pemulihan.", recoveryTrackingStale: "Aktiviti penjejakan dan penghantaran telah melepasi ambang pemulihan.", recoveryWorkflowStale: "Tiada aktiviti aliran penghantaran direkodkan dalam tempoh pemulihan.", recoveryHealthy: "Penghantaran aktif adalah sihat dan tidak boleh dilepaskan.", company: "Syarikat", branch: "Cawangan", loading: "Memuatkan peta langsung…", map: "Peta langsung Ejen Penghantaran", mapHelp: "Lokasi operasi yang dibenarkan sahaja. Titik laluan luput mengikut dasar pengekalan penjejakan.", mapMissing: "Tiada lokasi Ejen Penghantaran semasa.", mapOutsideCoverage: "Lokasi Ejen Penghantaran berada di luar liputan peta MVP terkawal:", mapUnconfigured: "Pemetaan jalan operasi belum dikonfigurasi. Masa dan ketepatan lokasi kekal tersedia; gambaran serantau tidak dipersembahkan sebagai navigasi jalan.", mapConfigurationInvalid: "Konfigurasi peta operasi tidak sah. Tiada peta dipaparkan.", mapFailed: "Sumber peta yang diluluskan tidak tersedia. Masa dan ketepatan lokasi kekal kelihatan di bawah.", mapAttribution: "Atribusi peta", routeMap: "Peta laluan Ejen Penghantaran", back: "Kembali ke Ejen Penghantaran",
  },
} as const;

export function driverManagementMessages(locale: SupportedLocale = "en") {
  return messages[locale] ?? messages.en;
}

type DriverMessageKey = keyof typeof messages.en;

const availabilityLabels = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  OFFLINE: "offline",
  DEACTIVATED: "deactivated",
} as const satisfies Record<string, DriverMessageKey>;

const recoveryReasonLabels = {
  TERMINAL_JOB: "recoveryTerminal",
  NO_ACTIVE_ASSIGNMENT: "recoveryNoAssignment",
  DRIVER_INACTIVE: "recoveryDriverInactive",
  ACCEPTANCE_EXPIRED: "recoveryAcceptanceExpired",
  DRIVER_OFFLINE: "recoveryDriverOffline",
  TRACKING_STALE: "recoveryTrackingStale",
  WORKFLOW_STALE: "recoveryWorkflowStale",
  HEALTHY_ACTIVE_JOB: "recoveryHealthy",
} as const satisfies Record<string, DriverMessageKey>;

export function driverAvailabilityLabel(value: string, locale: SupportedLocale = "en") {
  const key = availabilityLabels[value as keyof typeof availabilityLabels];
  return key ? messages[locale][key] : messages[locale].availabilityUnknown;
}

export function driverRecoveryReasonLabel(value: string, locale: SupportedLocale = "en") {
  const key = recoveryReasonLabels[value as keyof typeof recoveryReasonLabels];
  return key ? messages[locale][key] : messages[locale].blocked;
}
