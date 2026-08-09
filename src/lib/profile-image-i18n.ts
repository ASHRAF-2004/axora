import type { SupportedLocale } from "./i18n";

export interface ProfileImageMessages {
  title: string;
  optional: string;
  required: string;
  choose: string;
  replace: string;
  save: string;
  retry: string;
  cancel: string;
  remove: string;
  removing: string;
  cancelled: string;
  uncertain: string;
  reference: (value: string) => string;
  horizontal: string;
  vertical: string;
  zoom: string;
  preview: string;
  progress: (value: number) => string;
  processing: string;
  saved: string;
  removed: string;
  help: string;
  errors: Record<string, string>;
  settingsTitle: string;
  settingsBody: string;
  deliveryRequired: string;
  deliveryRequiredHelp: string;
  companyDisplay: string;
  companyDisplayHelp: string;
  savePolicy: string;
  policySaved: string;
  assignedAgent: string;
  removeFor: (name: string) => string;
}

const en: ProfileImageMessages = {
  title: "Profile photo",
  optional: "Optional for your role",
  required: "Required before a delivery can be assigned to you",
  choose: "Choose photo",
  replace: "Replace photo",
  save: "Crop and save",
  retry: "Retry upload",
  cancel: "Cancel upload",
  remove: "Remove photo",
  removing: "Removing the profile photo...",
  cancelled: "Upload cancelled before processing began.",
  uncertain: "The response was lost or timed out. The photo may have changed; verify it before retrying.",
  reference: (value) => `Reference: ${value}`,
  horizontal: "Horizontal position",
  vertical: "Vertical position",
  zoom: "Zoom",
  preview: "Profile photo crop preview",
  progress: (value) => `Uploading ${value}%`,
  processing: "Upload complete. Processing private thumbnails...",
  saved: "Your processed profile photo is active.",
  removed: "The profile photo was removed. Initials are now shown.",
  help: "Single-frame JPEG, PNG, or WebP; 5 MB maximum; 64 to 4096 pixels. Location and other metadata are removed.",
  errors: {
    size: "Choose an image between 1 byte and 5 MB.",
    type: "Use a single-frame JPEG, PNG, or WebP image whose content matches its type.",
    decode: "The image is damaged, animated, unsupported, or unsafe to decode.",
    dimensions: "Use an image between 64 and 4096 pixels in each dimension.",
    transparent: "Choose an image with a clearly visible subject, not an almost fully transparent image.",
    processing: "The image could not be processed. Your current photo is unchanged.",
    storage: "Private image storage is temporarily unavailable. Your current photo is unchanged.",
    interrupted: "The upload was interrupted. Your current photo is unchanged.",
    unavailable: "The profile photo action is unavailable.",
  },
  settingsTitle: "Profile photo policy",
  settingsBody: "Control delivery identity requirements and customer visibility without exposing private image files.",
  deliveryRequired: "Require a processed photo before assigning a Delivery Agent",
  deliveryRequiredHelp: "Existing assignments continue; every new assignment is rejected at the database boundary until the agent has an active photo.",
  companyDisplay: "Show the assigned agent photo during an active delivery",
  companyDisplayHelp: "Company receivers can see only the currently assigned agent and only while the assignment remains active.",
  savePolicy: "Save photo policy",
  policySaved: "Profile photo policy updated.",
  assignedAgent: "Assigned delivery agent",
  removeFor: (name) => `Deactivate profile photo for ${name}`,
};

const ar: ProfileImageMessages = {
  ...en,
  title: "صورة الملف الشخصي",
  optional: "اختيارية لدورك",
  required: "مطلوبة قبل إسناد عملية تسليم إليك",
  choose: "اختيار صورة",
  replace: "استبدال الصورة",
  save: "اقتصاص وحفظ",
  retry: "إعادة محاولة الرفع",
  cancel: "إلغاء الرفع",
  remove: "إزالة الصورة",
  removing: "جارٍ إزالة صورة الملف الشخصي...",
  cancelled: "أُلغي الرفع قبل بدء المعالجة.",
  uncertain: "فُقد الرد أو انتهت المهلة. ربما تغيرت الصورة؛ تحقق منها قبل إعادة المحاولة.",
  reference: (value) => `المرجع: ${value}`,
  horizontal: "الموضع الأفقي",
  vertical: "الموضع العمودي",
  zoom: "التكبير",
  preview: "معاينة اقتصاص صورة الملف الشخصي",
  progress: (value) => `جارٍ الرفع ${value}%`,
  processing: "اكتمل الرفع. جارٍ تجهيز الصور المصغرة الخاصة...",
  saved: "أصبحت صورة ملفك المعالجة نشطة.",
  removed: "تمت إزالة الصورة وتظهر الأحرف الأولى الآن.",
  help: "JPEG أو PNG أو WebP بإطار واحد؛ بحد أقصى 5 ميجابايت؛ ومن 64 إلى 4096 بكسل. تزال بيانات الموقع والبيانات الوصفية الأخرى.",
  errors: {
    size: "اختر صورة بين 1 بايت و5 ميجابايت.",
    type: "استخدم صورة JPEG أو PNG أو WebP بإطار واحد ويتطابق محتواها مع نوعها.",
    decode: "الصورة تالفة أو متحركة أو غير مدعومة أو غير آمنة للفك.",
    dimensions: "استخدم صورة بين 64 و4096 بكسل في كل بُعد.",
    transparent: "اختر صورة ذات عنصر واضح وليست شفافة بالكامل تقريباً.",
    processing: "تعذرت معالجة الصورة. صورتك الحالية لم تتغير.",
    storage: "تخزين الصور الخاص غير متاح مؤقتاً. صورتك الحالية لم تتغير.",
    interrupted: "انقطع رفع الصورة. صورتك الحالية لم تتغير.",
    unavailable: "إجراء صورة الملف غير متاح.",
  },
  settingsTitle: "سياسة صور الملفات الشخصية",
  settingsBody: "تحكم في متطلبات هوية التسليم وظهورها للعميل دون كشف ملفات الصور الخاصة.",
  deliveryRequired: "طلب صورة معالجة قبل إسناد التسليم إلى وكيل التسليم",
  deliveryRequiredHelp: "تستمر الإسنادات الحالية، وترفض قاعدة البيانات كل إسناد جديد حتى يملك الوكيل صورة نشطة.",
  companyDisplay: "إظهار صورة الوكيل المعين أثناء التسليم النشط",
  companyDisplayHelp: "يرى مستلمو الشركة الوكيل المعين حالياً فقط وما دام الإسناد نشطاً.",
  savePolicy: "حفظ سياسة الصور",
  policySaved: "تم تحديث سياسة صور الملفات الشخصية.",
  assignedAgent: "وكيل التسليم المعين",
  removeFor: (name) => `إلغاء تنشيط صورة الملف الشخصي لـ ${name}`,
};

const ms: ProfileImageMessages = {
  ...en,
  title: "Foto profil",
  optional: "Pilihan untuk peranan anda",
  required: "Diperlukan sebelum penghantaran boleh ditugaskan kepada anda",
  choose: "Pilih foto",
  replace: "Ganti foto",
  save: "Pangkas dan simpan",
  retry: "Cuba semula muat naik",
  cancel: "Batalkan muat naik",
  remove: "Buang foto",
  removing: "Membuang foto profil...",
  cancelled: "Muat naik dibatalkan sebelum pemprosesan bermula.",
  uncertain: "Respons hilang atau tamat masa. Foto mungkin telah berubah; sahkan sebelum mencuba semula.",
  reference: (value) => `Rujukan: ${value}`,
  horizontal: "Kedudukan mendatar",
  vertical: "Kedudukan menegak",
  zoom: "Zum",
  preview: "Pratonton pangkasan foto profil",
  progress: (value) => `Memuat naik ${value}%`,
  processing: "Muat naik selesai. Memproses imej kecil peribadi...",
  saved: "Foto profil yang diproses kini aktif.",
  removed: "Foto profil dibuang. Huruf awal kini dipaparkan.",
  help: "JPEG, PNG atau WebP satu bingkai; maksimum 5 MB; 64 hingga 4096 piksel. Lokasi dan metadata lain dibuang.",
  errors: {
    size: "Pilih imej antara 1 bait dan 5 MB.",
    type: "Gunakan imej JPEG, PNG atau WebP satu bingkai yang kandungannya sepadan dengan jenisnya.",
    decode: "Imej rosak, beranimasi, tidak disokong atau tidak selamat untuk dinyahkod.",
    dimensions: "Gunakan imej antara 64 dan 4096 piksel bagi setiap dimensi.",
    transparent: "Pilih imej dengan subjek yang jelas, bukan imej yang hampir lut sinar sepenuhnya.",
    processing: "Imej tidak dapat diproses. Foto semasa anda tidak berubah.",
    storage: "Storan imej peribadi tidak tersedia buat sementara. Foto semasa anda tidak berubah.",
    interrupted: "Muat naik terganggu. Foto semasa anda tidak berubah.",
    unavailable: "Tindakan foto profil tidak tersedia.",
  },
  settingsTitle: "Dasar foto profil",
  settingsBody: "Kawal keperluan identiti penghantaran dan paparan pelanggan tanpa mendedahkan fail imej peribadi.",
  deliveryRequired: "Wajibkan foto diproses sebelum menugaskan Ejen Penghantaran",
  deliveryRequiredHelp: "Tugasan sedia ada diteruskan; setiap tugasan baharu ditolak di sempadan pangkalan data sehingga ejen mempunyai foto aktif.",
  companyDisplay: "Paparkan foto ejen yang ditugaskan semasa penghantaran aktif",
  companyDisplayHelp: "Penerima syarikat hanya boleh melihat ejen semasa dan hanya ketika tugasan kekal aktif.",
  savePolicy: "Simpan dasar foto",
  policySaved: "Dasar foto profil dikemas kini.",
  assignedAgent: "Ejen penghantaran ditugaskan",
  removeFor: (name) => `Nyahaktifkan foto profil untuk ${name}`,
};

const messages = { en, ar, ms } satisfies Record<SupportedLocale, ProfileImageMessages>;

export function profileImageMessages(locale: SupportedLocale) {
  return messages[locale];
}
