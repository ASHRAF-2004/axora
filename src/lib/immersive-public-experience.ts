import type { SupportedLocale } from "@/lib/i18n";

export const WORKFLOW_STAGE_IDS = [
  "request",
  "approve",
  "pay",
  "invoice",
  "prepare",
  "deliver",
  "track",
  "complete",
] as const;

export type WorkflowStageId = (typeof WORKFLOW_STAGE_IDS)[number];
export const PUBLIC_ATMOSPHERES = ["Aurora", "Solar", "Ember", "Midnight"] as const;
export type PublicAtmosphere = (typeof PUBLIC_ATMOSPHERES)[number];
export type PublicAtmosphereId = "aurora" | "solar" | "ember" | "midnight";
export type PublicSceneRoute =
  | "home"
  | "how-it-works"
  | "procurement-process"
  | "solutions-by-role"
  | "security-and-privacy"
  | "about";

export type SemanticModelId =
  | WorkflowStageId
  | "road"
  | "shield"
  | "vault"
  | "person"
  | "workspace"
  | "company"
  | "network"
  | "flag";

export const SEMANTIC_MODEL_PATHS: Record<SemanticModelId, string> = {
  request: "/immersive/models/request.glb",
  approve: "/immersive/models/approve.glb",
  pay: "/immersive/models/pay.glb",
  invoice: "/immersive/models/invoice.glb",
  prepare: "/immersive/models/prepare.glb",
  deliver: "/immersive/models/deliver.glb",
  track: "/immersive/models/track.glb",
  complete: "/immersive/models/complete.glb",
  road: "/immersive/models/road.glb",
  shield: "/immersive/models/shield.glb",
  vault: "/immersive/models/vault.glb",
  person: "/immersive/models/person.glb",
  workspace: "/immersive/models/workspace.glb",
  company: "/immersive/models/company.glb",
  network: "/immersive/models/network.glb",
  flag: "/immersive/models/flag.glb",
};

export const STAGE_SOUND_PATHS: Record<SemanticModelId | "theme", string> = {
  request: "/immersive/sounds/request.ogg",
  approve: "/immersive/sounds/approve.ogg",
  pay: "/immersive/sounds/pay.ogg",
  invoice: "/immersive/sounds/invoice.ogg",
  prepare: "/immersive/sounds/prepare.ogg",
  deliver: "/immersive/sounds/delivery-engine.ogg",
  track: "/immersive/sounds/track.ogg",
  complete: "/immersive/sounds/complete.ogg",
  road: "/immersive/sounds/delivery-engine.ogg",
  shield: "/immersive/sounds/approve.ogg",
  vault: "/immersive/sounds/pay.ogg",
  person: "/immersive/sounds/request.ogg",
  workspace: "/immersive/sounds/approve.ogg",
  company: "/immersive/sounds/complete.ogg",
  network: "/immersive/sounds/track.ogg",
  flag: "/immersive/sounds/complete.ogg",
  theme: "/immersive/sounds/theme.ogg",
};

export const PUBLIC_ATMOSPHERE_SCENES = [
  {
    id: "aurora" as const,
    scene: {
      background: "#061a2f",
      surface: "#102f49",
      primary: "#48d6c5",
      secondary: "#61a7ff",
      glow: "#92fff1",
      ink: "#f2fbff",
    },
  },
  {
    id: "solar" as const,
    scene: {
      background: "#231506",
      surface: "#4a2a0b",
      primary: "#ffbf47",
      secondary: "#ff774d",
      glow: "#ffe4a1",
      ink: "#fff9eb",
    },
  },
  {
    id: "ember" as const,
    scene: {
      background: "#250f13",
      surface: "#4b1820",
      primary: "#ff6e4a",
      secondary: "#ffb34f",
      glow: "#ffd0a6",
      ink: "#fff6f1",
    },
  },
  {
    id: "midnight" as const,
    scene: {
      background: "#050a18",
      surface: "#121b38",
      primary: "#82a7ff",
      secondary: "#44d4ea",
      glow: "#b8c9ff",
      ink: "#f7f9ff",
    },
  },
] as const;

export const PUBLIC_SCENE_MODELS: Record<PublicSceneRoute, readonly SemanticModelId[]> = {
  home: WORKFLOW_STAGE_IDS,
  "how-it-works": ["request", "approve", "pay", "invoice", "track", "deliver", "complete"],
  "procurement-process": ["request", "approve", "pay", "invoice", "prepare", "deliver", "complete"],
  "solutions-by-role": ["person", "workspace", "company"],
  "security-and-privacy": ["shield", "vault", "network"],
  about: ["company", "network", "flag"],
};

type StageCopy = {
  id: WorkflowStageId;
  label: string;
  title: string;
  description: string;
};

type ImmersiveCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  explore: string;
  consoleLabel: string;
  sceneAlternative: string;
  soundOn: string;
  soundOff: string;
  themes: Record<PublicAtmosphereId, string>;
  stages: StageCopy[];
  sections: {
    howTitle: string;
    howItems: string[];
    rolesTitle: string;
    roles: string[];
    securityTitle: string;
    securityBody: string;
    deliveryTitle: string;
    deliveryBody: string;
    ctaTitle: string;
    ctaBody: string;
  };
  routeCopy: Record<Exclude<PublicSceneRoute, "home">, {
    eyebrow: string;
    title: string;
    lead: string;
    steps: string[];
  }>;
};

const stageCopy: Record<SupportedLocale, StageCopy[]> = {
  en: [
    { id: "request", label: "Request", title: "Build a clear request", description: "Choose approved catalogue items and submit the quantities your team needs." },
    { id: "approve", label: "Approve", title: "Company approval", description: "Your authorised company approver reviews scope, budget and approval limits." },
    { id: "pay", label: "Pay", title: "Confirm payment", description: "Axora confirms the server-authoritative payable total exactly once." },
    { id: "invoice", label: "Invoice", title: "Final invoice", description: "A permanent invoice and PDF are finalised from the approved snapshot." },
    { id: "prepare", label: "Prepare", title: "Order preparation", description: "Axora is preparing your approved order for fulfilment." },
    { id: "deliver", label: "Deliver", title: "Ready for delivery", description: "Your order moves into its secure delivery journey." },
    { id: "track", label: "Track", title: "Privacy-safe tracking", description: "See authorised status and ETA updates without exposing private operational detail." },
    { id: "complete", label: "Complete", title: "Verified completion", description: "Proof of receipt closes the request and preserves the final record." },
  ],
  ar: [
    { id: "request", label: "الطلب", title: "إنشاء طلب واضح", description: "اختر عناصر الكتالوج المعتمدة وأرسل الكميات التي يحتاجها فريقك." },
    { id: "approve", label: "الموافقة", title: "موافقة الشركة", description: "يراجع المعتمد المخول النطاق والميزانية وحدود الموافقة." },
    { id: "pay", label: "الدفع", title: "تأكيد الدفع", description: "تؤكد أكسورا المبلغ المستحق المعتمد من الخادم مرة واحدة." },
    { id: "invoice", label: "الفاتورة", title: "فاتورة نهائية", description: "تُعتمد فاتورة دائمة وملف PDF من اللقطة المعتمدة." },
    { id: "prepare", label: "التجهيز", title: "تجهيز الطلب", description: "تقوم أكسورا بتجهيز طلبك المعتمد للتنفيذ." },
    { id: "deliver", label: "التوصيل", title: "جاهز للتوصيل", description: "ينتقل طلبك إلى رحلة توصيل آمنة." },
    { id: "track", label: "التتبع", title: "تتبع يحفظ الخصوصية", description: "شاهد الحالة والوقت المتوقع المصرح بهما دون كشف تفاصيل تشغيلية خاصة." },
    { id: "complete", label: "الاكتمال", title: "اكتمال موثق", description: "يثبت الاستلام اكتمال الطلب ويحفظ السجل النهائي." },
  ],
  ms: [
    { id: "request", label: "Permintaan", title: "Bina permintaan yang jelas", description: "Pilih item katalog diluluskan dan hantar kuantiti yang diperlukan pasukan anda." },
    { id: "approve", label: "Lulus", title: "Kelulusan syarikat", description: "Pelulus syarikat menyemak skop, bajet dan had kelulusan." },
    { id: "pay", label: "Bayar", title: "Sahkan bayaran", description: "Axora mengesahkan jumlah berautoriti pelayan tepat sekali." },
    { id: "invoice", label: "Invois", title: "Invois muktamad", description: "Invois kekal dan PDF dimuktamadkan daripada syot kilat yang diluluskan." },
    { id: "prepare", label: "Sedia", title: "Penyediaan pesanan", description: "Axora sedang menyediakan pesanan anda yang diluluskan." },
    { id: "deliver", label: "Hantar", title: "Sedia untuk dihantar", description: "Pesanan anda memasuki perjalanan penghantaran yang selamat." },
    { id: "track", label: "Jejak", title: "Penjejakan privasi", description: "Lihat status dan ETA yang dibenarkan tanpa butiran operasi peribadi." },
    { id: "complete", label: "Selesai", title: "Penyelesaian disahkan", description: "Bukti penerimaan menutup permintaan dan menyimpan rekod akhir." },
  ],
};

const routeCopy: Record<SupportedLocale, ImmersiveCopy["routeCopy"]> = {
  en: {
    "how-it-works": { eyebrow: "One connected journey", title: "How Axora works", lead: "Move from a governed request to verified receipt without losing budget, invoice or delivery evidence.", steps: ["Submit and approve with company scope.", "Pay once and receive a final invoice.", "Track delivery through verified completion."] },
    "procurement-process": { eyebrow: "Procurement without noise", title: "A precise operational path", lead: "Every customer-visible state stays simple while Axora protects the controls underneath.", steps: ["Catalogue to approved request", "Payment to final invoice", "Preparation to delivered receipt"] },
    "solutions-by-role": { eyebrow: "The right view for every role", title: "Purpose-built workspaces", lead: "People see only the work and information their role, permissions and scope allow.", steps: ["Company request teams", "Approvers and administrators", "Axora operations and delivery"] },
    "security-and-privacy": { eyebrow: "Boundaries by design", title: "Security and privacy", lead: "Tenant isolation, least privilege and signed evidence protect every company journey.", steps: ["Server-authoritative access", "Private operational data", "Auditable completion evidence"] },
    about: { eyebrow: "A connected procurement world", title: "About Axora", lead: "Axora turns fragmented company purchasing into one accountable, understandable journey.", steps: ["Companies and teams", "Governed operations", "A trusted delivery record"] },
  },
  ar: {
    "how-it-works": { eyebrow: "رحلة مترابطة", title: "كيف تعمل أكسورا", lead: "انتقل من طلب محكوم إلى استلام موثق دون فقد دليل الميزانية أو الفاتورة أو التوصيل.", steps: ["إرسال وموافقة ضمن نطاق الشركة", "الدفع مرة واحدة واستلام الفاتورة", "تتبع التوصيل حتى الاكتمال"] },
    "procurement-process": { eyebrow: "مشتريات بلا تعقيد", title: "مسار تشغيلي دقيق", lead: "تبقى حالات العميل بسيطة بينما تحمي أكسورا الضوابط الداخلية.", steps: ["من الكتالوج إلى الطلب المعتمد", "من الدفع إلى الفاتورة النهائية", "من التجهيز إلى إثبات الاستلام"] },
    "solutions-by-role": { eyebrow: "الرؤية المناسبة لكل دور", title: "مساحات عمل مخصصة", lead: "يرى كل شخص فقط العمل والمعلومات المسموح بها حسب دوره وصلاحياته ونطاقه.", steps: ["فرق الطلب في الشركة", "المعتمدون والمديرون", "عمليات أكسورا والتوصيل"] },
    "security-and-privacy": { eyebrow: "حدود مصممة بعناية", title: "الأمن والخصوصية", lead: "يحمي عزل المستأجرين وأقل الصلاحيات والأدلة الموقعة رحلة كل شركة.", steps: ["وصول يحكمه الخادم", "بيانات تشغيلية خاصة", "دليل اكتمال قابل للتدقيق"] },
    about: { eyebrow: "عالم مشتريات مترابط", title: "عن أكسورا", lead: "تحول أكسورا مشتريات الشركات المتفرقة إلى رحلة واحدة مفهومة وخاضعة للمساءلة.", steps: ["الشركات والفرق", "عمليات محكومة", "سجل توصيل موثوق"] },
  },
  ms: {
    "how-it-works": { eyebrow: "Satu perjalanan bersambung", title: "Cara Axora berfungsi", lead: "Bergerak daripada permintaan terkawal kepada penerimaan disahkan tanpa kehilangan bukti bajet, invois atau penghantaran.", steps: ["Hantar dan lulus mengikut skop syarikat", "Bayar sekali dan terima invois akhir", "Jejak sehingga selesai"] },
    "procurement-process": { eyebrow: "Perolehan tanpa gangguan", title: "Laluan operasi tepat", lead: "Setiap keadaan pelanggan kekal mudah sementara Axora melindungi kawalan di belakangnya.", steps: ["Katalog kepada permintaan diluluskan", "Bayaran kepada invois akhir", "Penyediaan kepada bukti penerimaan"] },
    "solutions-by-role": { eyebrow: "Paparan tepat untuk setiap peranan", title: "Ruang kerja khusus", lead: "Setiap orang hanya melihat kerja dan maklumat yang dibenarkan oleh peranan, kebenaran dan skop.", steps: ["Pasukan permintaan syarikat", "Pelulus dan pentadbir", "Operasi dan penghantaran Axora"] },
    "security-and-privacy": { eyebrow: "Sempadan melalui reka bentuk", title: "Keselamatan dan privasi", lead: "Pengasingan penyewa, keistimewaan minimum dan bukti bertandatangan melindungi setiap perjalanan.", steps: ["Akses berautoriti pelayan", "Data operasi peribadi", "Bukti penyelesaian boleh audit"] },
    about: { eyebrow: "Dunia perolehan bersambung", title: "Tentang Axora", lead: "Axora mengubah pembelian syarikat yang berpecah kepada satu perjalanan yang jelas dan bertanggungjawab.", steps: ["Syarikat dan pasukan", "Operasi terkawal", "Rekod penghantaran dipercayai"] },
  },
};

export function immersivePublicCopy(locale: SupportedLocale): ImmersiveCopy {
  const common = {
    en: {
      eyebrow: "Intelligent procurement, in motion",
      title: "Enter the Axora world",
      lead: "A secure journey from request to verified completion, made visible and easy to follow.",
      explore: "Explore the workflow",
      consoleLabel: "Axora workflow world",
      sceneAlternative: "Interactive 3D workflow unavailable. The complete workflow remains available below.",
      soundOn: "Mute interface sound",
      soundOff: "Enable interface sound",
      sections: {
        howTitle: "One accountable flow",
        howItems: ["Company-controlled approval", "One final invoice", "Live delivery evidence"],
        rolesTitle: "Clarity for every role",
        roles: ["Customer teams", "Company approvers", "Axora operations"],
        securityTitle: "Private by default",
        securityBody: "Every response is filtered by role, explicit permission and assigned company scope.",
        deliveryTitle: "Delivery you can trust",
        deliveryBody: "Authorised status and ETA update without exposing private operational details.",
        ctaTitle: "Build a more accountable procurement journey",
        ctaBody: "Talk with Axora about your company workflow.",
      },
    },
    ar: {
      eyebrow: "مشتريات ذكية تتحرك معك",
      title: "ادخل عالم أكسورا",
      lead: "رحلة آمنة من الطلب إلى الاكتمال الموثق، واضحة وسهلة المتابعة.",
      explore: "استكشف سير العمل",
      consoleLabel: "عالم سير عمل أكسورا",
      sceneAlternative: "التجربة ثلاثية الأبعاد غير متاحة. يبقى سير العمل الكامل متاحاً أدناه.",
      soundOn: "كتم صوت الواجهة",
      soundOff: "تشغيل صوت الواجهة",
      sections: {
        howTitle: "مسار واحد خاضع للمساءلة",
        howItems: ["موافقة تتحكم بها الشركة", "فاتورة نهائية واحدة", "دليل توصيل مباشر"],
        rolesTitle: "وضوح لكل دور",
        roles: ["فرق العملاء", "معتمدو الشركة", "عمليات أكسورا"],
        securityTitle: "الخصوصية هي الأساس",
        securityBody: "تُصفى كل استجابة حسب الدور والصلاحية الصريحة ونطاق الشركة المعين.",
        deliveryTitle: "توصيل يمكنك الوثوق به",
        deliveryBody: "تتحدث الحالة والوقت المتوقع المصرح بهما دون كشف تفاصيل تشغيلية خاصة.",
        ctaTitle: "ابن رحلة مشتريات أكثر وضوحاً",
        ctaBody: "تحدث مع أكسورا عن سير عمل شركتك.",
      },
    },
    ms: {
      eyebrow: "Perolehan pintar yang bergerak",
      title: "Masuki dunia Axora",
      lead: "Perjalanan selamat daripada permintaan kepada penyelesaian disahkan, jelas dan mudah diikuti.",
      explore: "Terokai aliran kerja",
      consoleLabel: "Dunia aliran kerja Axora",
      sceneAlternative: "Pengalaman 3D tidak tersedia. Aliran kerja penuh kekal tersedia di bawah.",
      soundOn: "Senyapkan bunyi antara muka",
      soundOff: "Hidupkan bunyi antara muka",
      sections: {
        howTitle: "Satu aliran bertanggungjawab",
        howItems: ["Kelulusan dikawal syarikat", "Satu invois akhir", "Bukti penghantaran langsung"],
        rolesTitle: "Kejelasan untuk setiap peranan",
        roles: ["Pasukan pelanggan", "Pelulus syarikat", "Operasi Axora"],
        securityTitle: "Peribadi secara lalai",
        securityBody: "Setiap respons ditapis mengikut peranan, kebenaran jelas dan skop syarikat yang ditetapkan.",
        deliveryTitle: "Penghantaran yang dipercayai",
        deliveryBody: "Status dan ETA yang dibenarkan dikemas kini tanpa butiran operasi peribadi.",
        ctaTitle: "Bina perjalanan perolehan lebih bertanggungjawab",
        ctaBody: "Bercakap dengan Axora tentang aliran kerja syarikat anda.",
      },
    },
  }[locale];

  return {
    ...common,
    themes: locale === "ar"
      ? { aurora: "الشفق", solar: "الشمس", ember: "الجمر", midnight: "منتصف الليل" }
      : locale === "ms"
        ? { aurora: "Aurora", solar: "Suria", ember: "Bara", midnight: "Tengah malam" }
        : { aurora: "Aurora", solar: "Solar", ember: "Ember", midnight: "Midnight" },
    stages: stageCopy[locale],
    routeCopy: routeCopy[locale],
  };
}
