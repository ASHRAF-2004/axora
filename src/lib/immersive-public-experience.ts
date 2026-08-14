import type { SupportedLocale } from "@/lib/i18n";

export const WORKFLOW_STAGE_IDS = [
  "request",
  "approve",
  "pay",
  "invoice",
  "buy",
  "deliver",
  "track",
  "complete",
] as const;

export type WorkflowStageId = (typeof WORKFLOW_STAGE_IDS)[number];
export type PublicAtmosphereId = "aurora" | "solar" | "ember" | "midnight";

export const PUBLIC_ATMOSPHERES: Array<{
  id: PublicAtmosphereId;
  scene: {
    base: string;
    surface: string;
    active: string;
    accent: string;
    particle: string;
    route: string;
  };
}> = [
  {
    id: "aurora",
    scene: {
      base: "#07182c",
      surface: "#173f5f",
      active: "#46d8d0",
      accent: "#e8a33d",
      particle: "#9ae8ff",
      route: "#38bdf8",
    },
  },
  {
    id: "solar",
    scene: {
      base: "#10243a",
      surface: "#31526d",
      active: "#ffd166",
      accent: "#ff9f43",
      particle: "#fff1b8",
      route: "#f6c453",
    },
  },
  {
    id: "ember",
    scene: {
      base: "#1d1517",
      surface: "#563128",
      active: "#ff9d6c",
      accent: "#ffd07a",
      particle: "#ffcfb8",
      route: "#ff7b54",
    },
  },
  {
    id: "midnight",
    scene: {
      base: "#030b18",
      surface: "#11223d",
      active: "#6bbcff",
      accent: "#73f2cf",
      particle: "#a8c7ff",
      route: "#4f8cff",
    },
  },
];

export interface ImmersivePublicCopy {
  consoleTitle: string;
  consoleDescription: string;
  sceneLoading: string;
  staticFallback: string;
  selectedStage: string;
  workflowControls: string;
  keyboardHint: string;
  exploreStage: string;
  atmosphereLabel: string;
  soundEnable: string;
  soundDisable: string;
  soundMuted: string;
  scrollProgress: string;
  themes: Record<PublicAtmosphereId, string>;
  stages: Array<{
    id: WorkflowStageId;
    title: string;
    body: string;
    detail: string;
  }>;
  sections: {
    workflowEyebrow: string;
    workflowTitle: string;
    workflowLead: string;
    howEyebrow: string;
    howTitle: string;
    howLead: string;
    howItems: Array<{ title: string; body: string }>;
    benefitsEyebrow: string;
    benefitsTitle: string;
    benefits: Array<{ title: string; body: string }>;
    rolesEyebrow: string;
    rolesTitle: string;
    roles: Array<{ title: string; body: string }>;
    deliveryEyebrow: string;
    deliveryTitle: string;
    deliveryBody: string;
    deliveryProofs: string[];
    securityEyebrow: string;
    securityTitle: string;
    securityBody: string;
    securityPoints: string[];
    portalEyebrow: string;
    portalTitle: string;
    portalBody: string;
    portalPreview: string;
    portalNavigation: string[];
    contactEyebrow: string;
    contactTitle: string;
    contactBody: string;
    contactAction: string;
  };
}

const english: ImmersivePublicCopy = {
  consoleTitle: "Axora Workflow Console",
  consoleDescription: "Explore the accountable path from request to verified completion.",
  sceneLoading: "Preparing the workflow console",
  staticFallback: "Interactive workflow available without 3D",
  selectedStage: "Selected workflow stage",
  workflowControls: "Workflow console controls",
  keyboardHint: "Use keys 1 to 8 or the controls below.",
  exploreStage: "Explore this stage",
  atmosphereLabel: "Choose atmosphere",
  soundEnable: "Enable interface sound",
  soundDisable: "Mute interface sound",
  soundMuted: "Sound is muted by default",
  scrollProgress: "Page scroll progress",
  themes: { aurora: "Aurora", solar: "Solar", ember: "Ember", midnight: "Midnight" },
  stages: [
    { id: "request", title: "Request", body: "Build a governed request from the company catalogue.", detail: "Clear quantities, scoped people and an authoritative budget start every request." },
    { id: "approve", title: "Approve", body: "Route the request to the right company approver.", detail: "Approval limits, company scope and separation of duties remain enforced server-side." },
    { id: "pay", title: "Pay", body: "Confirm the payable amount once.", detail: "One idempotent action commits the final amount without coupling payment to delivery." },
    { id: "invoice", title: "Invoice", body: "Finalize a permanent invoice and PDF.", detail: "The immutable invoice snapshot remains available in Axora and by transactional email." },
    { id: "buy", title: "Buy", body: "The assigned Delivery Guy buys the approved items.", detail: "Product and quantity progress stays visible without exposing private operational data." },
    { id: "deliver", title: "Deliver", body: "Move items through a concise delivery journey.", detail: "Assigned, buying, out for delivery and delivered states keep every handoff clear." },
    { id: "track", title: "Track", body: "Follow progress, exceptions and partial delivery.", detail: "Authorized company users see only their own scoped requests and delivery evidence." },
    { id: "complete", title: "Complete", body: "Close with verified proof of receipt.", detail: "Recipient, timestamp, signature or photo evidence completes an accountable record." },
  ],
  sections: {
    workflowEyebrow: "Live workflow",
    workflowTitle: "Eight controls. One accountable route.",
    workflowLead: "Select any stage to understand what Axora protects, records and moves forward.",
    howEyebrow: "How Axora works",
    howTitle: "Control the spend. Keep the work moving.",
    howLead: "Axora connects company governance to practical fulfilment without turning procurement into paperwork.",
    howItems: [
      { title: "Govern before spend", body: "People, scope, budgets and approval limits are checked before a request advances." },
      { title: "Commit once", body: "Pay, invoice and email operations are idempotent, traceable and independent from delivery." },
      { title: "Prove completion", body: "The final handoff includes delivery progress and verifiable proof of receipt." },
    ],
    benefitsEyebrow: "For customer companies",
    benefitsTitle: "Procurement clarity without the operational fog.",
    benefits: [
      { title: "Company-scoped control", body: "Branches, departments, budgets and permissions stay within the company boundary." },
      { title: "A catalogue people can use", body: "Requesters choose approved products while Axora protects private cost and margin data." },
      { title: "Evidence in one place", body: "Requests, decisions, invoices, notifications and delivery proof remain connected." },
    ],
    rolesEyebrow: "Role-based experience",
    rolesTitle: "Each person sees the work they are trusted to do.",
    roles: [
      { title: "Company teams", body: "Requesters, approvers and administrators work inside their assigned company and branch scope." },
      { title: "Axora agents", body: "Client Account Managers guide only the leads and companies assigned to them." },
      { title: "Delivery Guy", body: "One focused operational view covers buying, delivery progress, exceptions and proof." },
    ],
    deliveryEyebrow: "Delivery and proof",
    deliveryTitle: "The last mile stays visible and verifiable.",
    deliveryBody: "Axora separates payment from delivery while keeping authorized teams informed from assignment to completed receipt.",
    deliveryProofs: ["Recipient and timestamp", "Signature or photo evidence", "Partial delivery and exception notes"],
    securityEyebrow: "Security by architecture",
    securityTitle: "Every company boundary is enforced before data leaves PostgreSQL.",
    securityBody: "Axora combines least-privilege database capabilities, row-level filtering and non-revealing authorization behavior.",
    securityPoints: ["Tenant and branch isolation", "Append-only accountability evidence", "Single-use invitation security"],
    portalEyebrow: "Logo-generated company portals",
    portalTitle: "A company identity, reviewed before it becomes a theme.",
    portalBody: "Approved logo processing extracts accessible colors and creates a familiar portal without exposing raw theme editors.",
    portalPreview: "Reviewed company portal preview",
    portalNavigation: ["Dashboard", "Requests", "Budgets", "Deliveries"],
    contactEyebrow: "Enter the Axora world",
    contactTitle: "Build a clearer procurement route for your company.",
    contactBody: "Tell Axora how your people request, approve and receive what they need.",
    contactAction: "Start a conversation",
  },
};

const arabic: ImmersivePublicCopy = {
  consoleTitle: "لوحة مسار أكسورا",
  consoleDescription: "استكشف المسار الموثق من الطلب حتى الإكمال المتحقق منه.",
  sceneLoading: "جارٍ تجهيز لوحة المسار",
  staticFallback: "المسار التفاعلي متاح من دون عرض ثلاثي الأبعاد",
  selectedStage: "مرحلة المسار المحددة",
  workflowControls: "عناصر تحكم مسار العمل",
  keyboardHint: "استخدم الأرقام من 1 إلى 8 أو عناصر التحكم أدناه.",
  exploreStage: "استكشف هذه المرحلة",
  atmosphereLabel: "اختر الأجواء",
  soundEnable: "تشغيل صوت الواجهة",
  soundDisable: "كتم صوت الواجهة",
  soundMuted: "الصوت مكتوم افتراضيًا",
  scrollProgress: "تقدم التمرير في الصفحة",
  themes: { aurora: "الشفق", solar: "الشمس", ember: "الجمر", midnight: "منتصف الليل" },
  stages: [
    { id: "request", title: "الطلب", body: "أنشئ طلبًا منضبطًا من كتالوج الشركة.", detail: "تبدأ كل عملية بكميات واضحة ونطاق مستخدمين وميزانية موثوقة." },
    { id: "approve", title: "الموافقة", body: "وجّه الطلب إلى المعتمد المناسب في الشركة.", detail: "تُطبّق حدود الموافقة ونطاق الشركة وفصل المهام على الخادم." },
    { id: "pay", title: "الدفع", body: "أكد المبلغ المستحق مرة واحدة.", detail: "إجراء واحد مقاوم للتكرار يثبت المبلغ النهائي من دون ربط الدفع بالتسليم." },
    { id: "invoice", title: "الفاتورة", body: "ثبّت فاتورة دائمة وملف PDF.", detail: "تبقى نسخة الفاتورة النهائية متاحة في أكسورا وعبر البريد الآمن." },
    { id: "buy", title: "الشراء", body: "يشتري مسؤول التوصيل الأصناف المعتمدة.", detail: "يبقى تقدم المنتجات والكميات واضحًا من دون كشف بيانات تشغيلية خاصة." },
    { id: "deliver", title: "التسليم", body: "انقل الأصناف عبر رحلة تسليم موجزة.", detail: "حالات التعيين والشراء والخروج للتسليم والتسليم توضح كل انتقال." },
    { id: "track", title: "التتبع", body: "تابع التقدم والاستثناءات والتسليم الجزئي.", detail: "يرى مستخدمو الشركة المخولون طلباتهم وأدلة التسليم ضمن نطاقهم فقط." },
    { id: "complete", title: "الإكمال", body: "أغلق العملية بإثبات استلام موثق.", detail: "اسم المستلم والوقت والتوقيع أو الصورة تكمل سجلًا قابلًا للمساءلة." },
  ],
  sections: {
    workflowEyebrow: "مسار مباشر",
    workflowTitle: "ثمانية عناصر تحكم. مسار واحد موثق.",
    workflowLead: "اختر أي مرحلة لفهم ما تحميه أكسورا وتسجله وتنقله إلى الأمام.",
    howEyebrow: "كيف تعمل أكسورا",
    howTitle: "تحكم في الإنفاق وحافظ على تقدم العمل.",
    howLead: "تربط أكسورا حوكمة الشركة بالتنفيذ العملي من دون تحويل المشتريات إلى عبء ورقي.",
    howItems: [
      { title: "الحوكمة قبل الإنفاق", body: "يتم فحص الأشخاص والنطاق والميزانيات وحدود الموافقة قبل تقدم الطلب." },
      { title: "التثبيت مرة واحدة", body: "الدفع والفاتورة والبريد عمليات مقاومة للتكرار ومستقلة عن التسليم." },
      { title: "إثبات الإكمال", body: "يتضمن التسليم النهائي تقدم العملية وإثبات استلام يمكن التحقق منه." },
    ],
    benefitsEyebrow: "للشركات العملاء",
    benefitsTitle: "وضوح في المشتريات من دون ضباب تشغيلي.",
    benefits: [
      { title: "تحكم ضمن الشركة", body: "تبقى الفروع والأقسام والميزانيات والصلاحيات داخل حدود الشركة." },
      { title: "كتالوج عملي", body: "يختار مقدمو الطلبات منتجات معتمدة بينما تحمي أكسورا بيانات التكلفة والهامش." },
      { title: "الأدلة في مكان واحد", body: "تبقى الطلبات والقرارات والفواتير والإشعارات وإثبات التسليم مترابطة." },
    ],
    rolesEyebrow: "تجربة حسب الدور",
    rolesTitle: "يرى كل شخص العمل المخول له.",
    roles: [
      { title: "فرق الشركة", body: "يعمل مقدمو الطلبات والمعتمدون والمسؤولون ضمن نطاق الشركة والفرع المخصص." },
      { title: "وكلاء أكسورا", body: "يتابع مديرو حسابات العملاء العملاء المحتملين والشركات المسندة إليهم فقط." },
      { title: "مسؤول التوصيل", body: "واجهة تشغيلية مركزة للشراء والتقدم والاستثناءات والإثبات." },
    ],
    deliveryEyebrow: "التسليم والإثبات",
    deliveryTitle: "يبقى الميل الأخير واضحًا وقابلًا للتحقق.",
    deliveryBody: "تفصل أكسورا الدفع عن التسليم مع إبقاء الفرق المخولة على اطلاع من التعيين حتى الاستلام المكتمل.",
    deliveryProofs: ["المستلم والتوقيت", "توقيع أو صورة", "التسليم الجزئي وملاحظات الاستثناء"],
    securityEyebrow: "الأمان في البنية",
    securityTitle: "تُفرض حدود كل شركة قبل مغادرة البيانات لقاعدة PostgreSQL.",
    securityBody: "تجمع أكسورا بين صلاحيات قاعدة البيانات الأقل امتيازًا وتصفية الصفوف وسلوك تفويض لا يكشف المعلومات.",
    securityPoints: ["عزل الشركة والفرع", "أدلة مساءلة غير قابلة للمحو", "دعوات آمنة أحادية الاستخدام"],
    portalEyebrow: "بوابات مولدة من الشعار",
    portalTitle: "هوية الشركة تُراجع قبل أن تصبح سمة.",
    portalBody: "تستخرج معالجة الشعار المعتمدة ألوانًا ميسرة وتنشئ بوابة مألوفة من دون محرر ألوان خام.",
    portalPreview: "معاينة بوابة الشركة المعتمدة",
    portalNavigation: ["لوحة التحكم", "الطلبات", "الميزانيات", "التسليمات"],
    contactEyebrow: "ادخل عالم أكسورا",
    contactTitle: "أنشئ مسار مشتريات أوضح لشركتك.",
    contactBody: "أخبر أكسورا كيف يطلب فريقك احتياجاته ويوافق عليها ويستلمها.",
    contactAction: "ابدأ المحادثة",
  },
};

const malay: ImmersivePublicCopy = {
  consoleTitle: "Konsol Aliran Kerja Axora",
  consoleDescription: "Terokai laluan yang bertanggungjawab daripada permintaan hingga selesai disahkan.",
  sceneLoading: "Menyediakan konsol aliran kerja",
  staticFallback: "Aliran kerja interaktif tersedia tanpa 3D",
  selectedStage: "Peringkat aliran kerja dipilih",
  workflowControls: "Kawalan konsol aliran kerja",
  keyboardHint: "Gunakan kekunci 1 hingga 8 atau kawalan di bawah.",
  exploreStage: "Terokai peringkat ini",
  atmosphereLabel: "Pilih suasana",
  soundEnable: "Hidupkan bunyi antara muka",
  soundDisable: "Senyapkan bunyi antara muka",
  soundMuted: "Bunyi disenyapkan secara lalai",
  scrollProgress: "Kemajuan tatal halaman",
  themes: { aurora: "Aurora", solar: "Suria", ember: "Bara", midnight: "Tengah malam" },
  stages: [
    { id: "request", title: "Minta", body: "Bina permintaan terkawal daripada katalog syarikat.", detail: "Kuantiti, skop pengguna dan bajet berwibawa memulakan setiap permintaan." },
    { id: "approve", title: "Lulus", body: "Halakan permintaan kepada pelulus syarikat yang betul.", detail: "Had kelulusan, skop syarikat dan pengasingan tugas dikuatkuasakan di pelayan." },
    { id: "pay", title: "Bayar", body: "Sahkan jumlah perlu dibayar sekali sahaja.", detail: "Satu tindakan idempoten mengikat jumlah akhir tanpa mencampurkan bayaran dan penghantaran." },
    { id: "invoice", title: "Invois", body: "Muktamadkan invois kekal dan PDF.", detail: "Snapshot invois muktamad kekal tersedia di Axora dan melalui e-mel transaksi." },
    { id: "buy", title: "Beli", body: "Delivery Guy yang ditugaskan membeli barangan diluluskan.", detail: "Kemajuan produk dan kuantiti kelihatan tanpa mendedahkan data operasi peribadi." },
    { id: "deliver", title: "Hantar", body: "Gerakkan barangan melalui perjalanan penghantaran ringkas.", detail: "Status ditugaskan, membeli, dalam penghantaran dan dihantar menjelaskan setiap serahan." },
    { id: "track", title: "Jejak", body: "Ikuti kemajuan, pengecualian dan penghantaran separa.", detail: "Pengguna dibenarkan hanya melihat permintaan dan bukti dalam skop mereka." },
    { id: "complete", title: "Selesai", body: "Tutup dengan bukti penerimaan yang disahkan.", detail: "Penerima, masa, tandatangan atau foto melengkapkan rekod yang boleh diaudit." },
  ],
  sections: {
    workflowEyebrow: "Aliran langsung",
    workflowTitle: "Lapan kawalan. Satu laluan bertanggungjawab.",
    workflowLead: "Pilih mana-mana peringkat untuk memahami apa yang Axora lindungi, rekod dan gerakkan.",
    howEyebrow: "Cara Axora berfungsi",
    howTitle: "Kawal perbelanjaan. Pastikan kerja bergerak.",
    howLead: "Axora menghubungkan tadbir urus syarikat kepada pemenuhan praktikal tanpa menambah kerenah.",
    howItems: [
      { title: "Tadbir sebelum berbelanja", body: "Pengguna, skop, bajet dan had kelulusan diperiksa sebelum permintaan bergerak." },
      { title: "Komit sekali", body: "Bayaran, invois dan e-mel adalah idempoten, boleh dijejak dan berasingan daripada penghantaran." },
      { title: "Buktikan penyelesaian", body: "Serahan akhir merangkumi kemajuan penghantaran dan bukti penerimaan." },
    ],
    benefitsEyebrow: "Untuk syarikat pelanggan",
    benefitsTitle: "Kejelasan perolehan tanpa kekaburan operasi.",
    benefits: [
      { title: "Kawalan berskop syarikat", body: "Cawangan, jabatan, bajet dan kebenaran kekal dalam sempadan syarikat." },
      { title: "Katalog yang boleh digunakan", body: "Pemohon memilih produk diluluskan sementara Axora melindungi kos dan margin peribadi." },
      { title: "Bukti di satu tempat", body: "Permintaan, keputusan, invois, pemberitahuan dan bukti penghantaran kekal bersambung." },
    ],
    rolesEyebrow: "Pengalaman berasaskan peranan",
    rolesTitle: "Setiap orang melihat kerja yang diamanahkan.",
    roles: [
      { title: "Pasukan syarikat", body: "Pemohon, pelulus dan pentadbir bekerja dalam skop syarikat dan cawangan mereka." },
      { title: "Ejen Axora", body: "Pengurus Akaun Pelanggan mengurus hanya bakal pelanggan dan syarikat yang ditugaskan." },
      { title: "Delivery Guy", body: "Satu pandangan operasi untuk pembelian, kemajuan, pengecualian dan bukti." },
    ],
    deliveryEyebrow: "Penghantaran dan bukti",
    deliveryTitle: "Batu terakhir kekal kelihatan dan boleh disahkan.",
    deliveryBody: "Axora memisahkan bayaran daripada penghantaran sambil memaklumkan pasukan dibenarkan hingga penerimaan selesai.",
    deliveryProofs: ["Penerima dan masa", "Tandatangan atau bukti foto", "Penghantaran separa dan nota pengecualian"],
    securityEyebrow: "Keselamatan melalui seni bina",
    securityTitle: "Sempadan syarikat dikuatkuasakan sebelum data meninggalkan PostgreSQL.",
    securityBody: "Axora menggabungkan keupayaan pangkalan data hak minimum, penapisan baris dan kebenaran tanpa pendedahan.",
    securityPoints: ["Pengasingan penyewa dan cawangan", "Bukti akauntabiliti tambah sahaja", "Jemputan sekali guna yang selamat"],
    portalEyebrow: "Portal dijana daripada logo",
    portalTitle: "Identiti syarikat disemak sebelum menjadi tema.",
    portalBody: "Pemprosesan logo diluluskan mengekstrak warna mudah akses tanpa mendedahkan editor tema mentah.",
    portalPreview: "Pratonton portal syarikat yang disemak",
    portalNavigation: ["Papan pemuka", "Permintaan", "Bajet", "Penghantaran"],
    contactEyebrow: "Masuki dunia Axora",
    contactTitle: "Bina laluan perolehan yang lebih jelas.",
    contactBody: "Beritahu Axora cara pasukan anda meminta, meluluskan dan menerima keperluan mereka.",
    contactAction: "Mulakan perbualan",
  },
};

export function immersivePublicCopy(locale: SupportedLocale): ImmersivePublicCopy {
  if (locale === "ar") return arabic;
  if (locale === "ms") return malay;
  return english;
}
