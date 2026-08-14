import type { SupportedLocale } from "./i18n";
import {
  PUBLIC_SCENE_MODELS,
  immersivePublicCopy,
  type PublicSceneRoute,
  type SemanticModelId,
} from "./immersive-public-experience";
import type { ImmersiveSoundId } from "./immersive-audio";

export interface PublicSceneState {
  model: SemanticModelId;
  sound: ImmersiveSoundId;
  label: string;
  title: string;
  description: string;
  alternative: string;
  cameraAction?: "focus" | "orbit" | "travel";
}

type Route = Exclude<PublicSceneRoute, "home">;
type CopyTuple = readonly [label: string, title: string, description: string];
type LocalizedCopy = Record<SupportedLocale, Record<Route, readonly CopyTuple[]>>;

const localized: LocalizedCopy = {
  en: {
    "how-it-works": [
      ["Request", "Describe what your team needs", "Build a governed request from the approved catalogue while safe progress is saved."],
      ["Approve", "Company approval", "The right company approver reviews scope, budget and policy before approving."],
      ["Pay", "Confirm once", "Axora confirms the authoritative total and records one idempotent payment."],
      ["Invoice", "Final records", "A permanent invoice and PDF are finalized from the immutable transaction snapshot."],
      ["Track", "Privacy-safe progress", "Authorized customers see delivery status and ETA without private operational details."],
      ["Deliver", "On the way", "The assigned delivery moves through a controlled and auditable fulfilment journey."],
      ["Complete", "Verified receipt", "Proof of receipt closes the request while preserving invoice, delivery and audit evidence."],
    ],
    "procurement-process": [
      ["Catalogue", "Choose approved products", "Customer-visible products show useful details and authoritative prices without private supplier data."],
      ["Approved order", "Policy and budget checked", "Company approval validates scope, limits and available budget before work continues."],
      ["Pay", "One confirmed total", "The payable amount is recalculated on the server and committed exactly once."],
      ["Invoice", "Permanent transaction record", "One final invoice, PDF and transactional email are created idempotently."],
      ["Prepare", "Order preparation", "Axora prepares the approved order while customer views remain clear and privacy-safe."],
      ["Deliver", "Controlled delivery", "A delivery journey carries the prepared order to the authorized receiving point."],
      ["Complete", "Receipt confirmed", "Recipient evidence completes the operational and customer-visible journey."],
    ],
    "solutions-by-role": [
      ["People", "Work shaped by responsibility", "Each person starts with a role template, explicit permissions, assigned scope and approval limits."],
      ["Workspace", "Only the work you may perform", "Dashboards and actions adapt to effective access without exposing unrelated tenant or financial data."],
      ["Company", "A branded, isolated portal", "Company users receive their reviewed company theme and only their authorized company scope."],
    ],
    "security-and-privacy": [
      ["Protect", "Server-authoritative access", "Authentication, permissions and tenant scope are checked on the server for every sensitive operation."],
      ["Isolate", "Private by default", "Row-Level Security and least-privilege capabilities keep customer and internal operational data separated."],
      ["Verify", "Signed and auditable evidence", "Versioned records, signed provider events and immutable audit evidence support trustworthy operations."],
    ],
    about: [
      ["Axora", "Procurement with clarity", "Axora connects governed company requests, payment, invoicing and delivery in one accountable platform."],
      ["Connected", "A trusted operating network", "Companies, authorized teams and delivery operations share current state without losing boundaries."],
      ["Purpose", "Better work, verified completion", "The destination is less operational noise and stronger evidence from request to receipt."],
    ],
  },
  ar: {
    "how-it-works": [
      ["الطلب", "حدّد احتياج فريقك", "أنشئ طلباً من الكتالوج المعتمد مع حفظ التقدم الآمن."],
      ["الموافقة", "موافقة الشركة", "يراجع صاحب الصلاحية النطاق والميزانية والسياسة قبل الموافقة."],
      ["الدفع", "تأكيد واحد", "يؤكد أكسورا الإجمالي المعتمد ويسجل دفعة واحدة دون تكرار."],
      ["الفاتورة", "سجل نهائي", "تُعتمد فاتورة دائمة وملف PDF من لقطة المعاملة الثابتة."],
      ["التتبع", "تقدم يحمي الخصوصية", "يرى العميل المخوّل حالة التسليم والوقت المتوقع دون تفاصيل تشغيلية خاصة."],
      ["التسليم", "الطلب في الطريق", "تتحرك عملية التسليم عبر مسار مضبوط وقابل للتدقيق."],
      ["الإكمال", "استلام موثّق", "يغلق إثبات الاستلام الطلب مع حفظ أدلة الفاتورة والتسليم والتدقيق."],
    ],
    "procurement-process": [
      ["الكتالوج", "اختيار المنتجات المعتمدة", "تظهر للعميل المعلومات والأسعار اللازمة دون بيانات المورد الخاصة."],
      ["طلب معتمد", "فحص السياسة والميزانية", "تتحقق موافقة الشركة من النطاق والحدود والميزانية المتاحة."],
      ["الدفع", "إجمالي مؤكد مرة واحدة", "يعيد الخادم حساب المبلغ ويثبته مرة واحدة فقط."],
      ["الفاتورة", "سجل معاملة دائم", "تُنشأ فاتورة نهائية وPDF ورسالة واحدة بطريقة تمنع التكرار."],
      ["التجهيز", "تجهيز الطلب", "يجهز أكسورا الطلب المعتمد مع إبقاء عرض العميل واضحاً وآمناً."],
      ["التسليم", "تسليم مضبوط", "تنقل رحلة التسليم الطلب المجهز إلى نقطة الاستلام المصرح بها."],
      ["الإكمال", "تأكيد الاستلام", "يكمل دليل المستلم الرحلة التشغيلية والمرئية للعميل."],
    ],
    "solutions-by-role": [
      ["الأشخاص", "عمل حسب المسؤولية", "يبدأ كل شخص بقالب دور وصلاحيات صريحة ونطاق وحد موافقة."],
      ["مساحة العمل", "العمل المسموح فقط", "تتكيف الواجهات مع الوصول الفعلي دون كشف بيانات غير مصرح بها."],
      ["الشركة", "بوابة معزولة بهوية الشركة", "يحصل مستخدمو الشركة على الهوية المعتمدة ونطاق شركتهم فقط."],
    ],
    "security-and-privacy": [
      ["الحماية", "وصول يفرضه الخادم", "يفحص الخادم الهوية والصلاحيات ونطاق المستأجر لكل عملية حساسة."],
      ["العزل", "الخصوصية افتراضياً", "تعزل سياسات الصفوف وقدرات أقل صلاحية بيانات العملاء والعمليات."],
      ["التحقق", "أدلة موقعة وقابلة للتدقيق", "تدعم السجلات ذات الإصدارات والأحداث الموقعة عمليات موثوقة."],
    ],
    about: [
      ["أكسورا", "مشتريات بوضوح", "يربط أكسورا طلبات الشركة والدفع والفوترة والتسليم في منصة مسؤولة واحدة."],
      ["مترابط", "شبكة تشغيل موثوقة", "تشارك الشركات والفرق المخولة وعمليات التسليم الحالة الحالية مع حفظ الحدود."],
      ["الغاية", "عمل أفضل وإكمال موثّق", "الهدف هو ضوضاء تشغيلية أقل وأدلة أقوى من الطلب إلى الاستلام."],
    ],
  },
  ms: {
    "how-it-works": [
      ["Permintaan", "Nyatakan keperluan pasukan", "Bina permintaan terkawal daripada katalog diluluskan sambil kemajuan selamat disimpan."],
      ["Lulus", "Kelulusan syarikat", "Pelulus yang betul menyemak skop, bajet dan dasar sebelum meluluskan."],
      ["Bayar", "Sahkan sekali", "Axora mengesahkan jumlah berautoriti dan merekodkan satu bayaran idempoten."],
      ["Invois", "Rekod muktamad", "Invois kekal dan PDF dimuktamadkan daripada syot kilat transaksi."],
      ["Jejak", "Kemajuan menjaga privasi", "Pelanggan sah melihat status dan ETA tanpa butiran operasi peribadi."],
      ["Hantar", "Dalam perjalanan", "Penghantaran bergerak melalui perjalanan terkawal dan boleh diaudit."],
      ["Selesai", "Penerimaan disahkan", "Bukti penerimaan menutup permintaan sambil mengekalkan rekod."],
    ],
    "procurement-process": [
      ["Katalog", "Pilih produk diluluskan", "Pelanggan melihat maklumat dan harga tanpa data pembekal peribadi."],
      ["Pesanan diluluskan", "Dasar dan bajet disemak", "Kelulusan syarikat mengesahkan skop, had dan bajet tersedia."],
      ["Bayar", "Satu jumlah disahkan", "Jumlah perlu dibayar dikira semula oleh pelayan dan dikomit sekali."],
      ["Invois", "Rekod transaksi kekal", "Satu invois, PDF dan e-mel transaksi diwujudkan secara idempoten."],
      ["Sedia", "Penyediaan pesanan", "Axora menyediakan pesanan sambil paparan pelanggan kekal jelas dan selamat."],
      ["Hantar", "Penghantaran terkawal", "Perjalanan penghantaran membawa pesanan ke lokasi penerimaan dibenarkan."],
      ["Selesai", "Penerimaan disahkan", "Bukti penerima melengkapkan perjalanan operasi dan pelanggan."],
    ],
    "solutions-by-role": [
      ["Individu", "Kerja mengikut tanggungjawab", "Setiap individu bermula dengan templat peranan, kebenaran, skop dan had kelulusan."],
      ["Ruang kerja", "Hanya kerja yang dibenarkan", "Papan pemuka menyesuaikan akses tanpa mendedahkan data tidak berkaitan."],
      ["Syarikat", "Portal berjenama dan terasing", "Pengguna syarikat menerima tema diluluskan dan skop syarikat mereka sahaja."],
    ],
    "security-and-privacy": [
      ["Lindungi", "Akses berautoriti pelayan", "Pengesahan, kebenaran dan skop diperiksa pada pelayan untuk setiap tindakan sensitif."],
      ["Asingkan", "Peribadi secara lalai", "RLS dan keistimewaan minimum memisahkan data pelanggan dan operasi."],
      ["Sahkan", "Bukti ditandatangani dan boleh diaudit", "Rekod berversi dan peristiwa ditandatangani menyokong operasi dipercayai."],
    ],
    about: [
      ["Axora", "Perolehan dengan jelas", "Axora menghubungkan permintaan, bayaran, invois dan penghantaran dalam satu platform."],
      ["Terhubung", "Rangkaian operasi dipercayai", "Syarikat, pasukan sah dan operasi penghantaran berkongsi keadaan semasa tanpa kehilangan sempadan."],
      ["Tujuan", "Kerja lebih baik, siap disahkan", "Matlamatnya kurang gangguan operasi dan bukti lebih kukuh dari permintaan hingga penerimaan."],
    ],
  },
};

const soundByModel: Record<SemanticModelId, ImmersiveSoundId> = {
  request: "request", approve: "approve", pay: "pay", invoice: "invoice",
  prepare: "prepare", deliver: "deliver", track: "track", complete: "complete",
  road: "deliver", shield: "approve", vault: "pay", person: "request",
  workspace: "approve", company: "complete", network: "track", flag: "complete",
};

export function publicSceneStates(route: PublicSceneRoute, locale: SupportedLocale): readonly PublicSceneState[] {
  if (route === "home") {
    return immersivePublicCopy(locale).stages.map((stage) => ({
      model: stage.id,
      sound: stage.id,
      label: stage.label,
      title: stage.title,
      description: stage.description,
      alternative: stage.description,
      cameraAction: stage.id === "deliver" || stage.id === "track" ? "travel" : "focus",
    }));
  }
  return PUBLIC_SCENE_MODELS[route].map((model, index) => {
    const [label, title, description] = localized[locale][route][index];
    return { model, sound: soundByModel[model], label, title, description, alternative: description };
  });
}

export function validatePublicSceneStates() {
  for (const locale of ["en", "ar", "ms"] as const) {
    for (const route of Object.keys(PUBLIC_SCENE_MODELS) as PublicSceneRoute[]) {
      const routeStates = publicSceneStates(route, locale);
      if (routeStates.length !== PUBLIC_SCENE_MODELS[route].length
        || routeStates.some((state, index) => state.model !== PUBLIC_SCENE_MODELS[route][index])) {
        throw new Error(`Public scene states do not match ${locale}/${route}.`);
      }
    }
  }
  return true;
}

validatePublicSceneStates();
