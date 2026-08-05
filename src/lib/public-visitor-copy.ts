import type { SupportedLocale } from "./i18n";
import type { VisitorChoice } from "./public-visitor-counter";

interface VisitorChoiceCopy {
  eyebrow: string;
  title: string;
  body: string;
  totalLabel: string;
  earlyTitle: string;
  earlyDescription: string;
  nightTitle: string;
  nightDescription: string;
  earlyCountLabel: string;
  nightCountLabel: string;
  chooseEarly: string;
  chooseNight: string;
  locked: string;
  alreadyClaimed: string;
  loading: string;
  verifying: string;
  unavailable: string;
  error: string;
  scriptError: string;
  unsupported: string;
  timeout: string;
  requestTimeout: string;
  rejected: string;
  rateLimited: string;
  retry: string;
  protectedBy: string;
  privacy: string;
  privacyLink: string;
  groupLabel: string;
  result: (choice: VisitorChoice, visitorNumber: number) => string;
}

export const publicVisitorCopy: Record<SupportedLocale, VisitorChoiceCopy> = {
  en: {
    eyebrow: "One click. One permanent spot.",
    title: "Which side are you on?",
    body: "Choose once. Axora verifies the claim on the server and keeps your visitor number tied to your anonymous claim.",
    totalLabel: "visitor spots claimed",
    earlyTitle: "Early Birds",
    earlyDescription: "The best ideas arrive before the day gets noisy.",
    nightTitle: "Night Owls",
    nightDescription: "Real focus starts after the day goes quiet.",
    earlyCountLabel: "Early Birds",
    nightCountLabel: "Night Owls",
    chooseEarly: "Choose Early Birds",
    chooseNight: "Choose Night Owls",
    locked: "LOCKED IN",
    alreadyClaimed: "Your spot is already claimed.",
    loading: "Loading the live count…",
    verifying: "Verifying your one-time choice…",
    unavailable: "Visitor claiming is temporarily unavailable. The live totals will return shortly.",
    error: "Your choice could not be verified. Nothing was counted.",
    scriptError: "The security check could not load. Nothing was counted.",
    unsupported: "This browser cannot run the security check. Update it or use a supported browser, then retry.",
    timeout: "The security check took too long. Nothing was counted.",
    requestTimeout: "Axora could not confirm the result in time. Nothing new will be submitted until the current claim is checked.",
    rejected: "Cloudflare could not verify this attempt. Nothing was counted.",
    rateLimited: "Too many verification attempts were received. Wait a moment, then retry.",
    retry: "Try again",
    protectedBy: "Protected by Cloudflare Turnstile",
    privacy: "Axora stores a signed first-party claim cookie and irreversible hashes of limited network and device signals. The counter does not store your raw IP address.",
    privacyLink: "Privacy",
    groupLabel: "Choose your visitor side",
    result: (choice, visitorNumber) => `You chose ${choice === "EARLY_BIRD" ? "Early Birds" : "Night Owls"}. You are visitor #${visitorNumber.toLocaleString("en")}.`,
  },
  ar: {
    eyebrow: "نقرة واحدة. مكان واحد دائم.",
    title: "أيُّ فريق تختار؟",
    body: "اختر مرة واحدة. تتحقق أكسورا من المطالبة على الخادم وتُبقي رقم زائرك مرتبطًا بمطالبتك المجهولة.",
    totalLabel: "مكانًا محجوزًا للزوار",
    earlyTitle: "فريق الصباح الباكر",
    earlyDescription: "تأتي أفضل الأفكار قبل أن يبدأ ضجيج اليوم.",
    nightTitle: "فريق السهر",
    nightDescription: "يبدأ التركيز الحقيقي بعد أن يهدأ اليوم.",
    earlyCountLabel: "فريق الصباح",
    nightCountLabel: "فريق السهر",
    chooseEarly: "اختيار فريق الصباح الباكر",
    chooseNight: "اختيار فريق السهر",
    locked: "تم تثبيت الاختيار",
    alreadyClaimed: "مكانك محجوز بالفعل.",
    loading: "جارٍ تحميل العدد المباشر…",
    verifying: "جارٍ التحقق من اختيارك لمرة واحدة…",
    unavailable: "حجز رقم الزائر غير متاح مؤقتًا. ستعود الأعداد المباشرة قريبًا.",
    error: "تعذر التحقق من اختيارك، ولم تتم إضافة أي عدد.",
    scriptError: "تعذر تحميل فحص الأمان. لم تتم إضافة أي عدد.",
    unsupported: "هذا المتصفح لا يدعم فحص الأمان. حدّث المتصفح أو استخدم متصفحًا مدعومًا، ثم حاول مجددًا.",
    timeout: "استغرق فحص الأمان وقتًا أطول من اللازم. لم تتم إضافة أي عدد.",
    requestTimeout: "لم تتمكن أكسورا من تأكيد النتيجة في الوقت المحدد. لن يُرسل اختيار جديد قبل التحقق من المطالبة الحالية.",
    rejected: "تعذر على Cloudflare التحقق من هذه المحاولة. لم تتم إضافة أي عدد.",
    rateLimited: "تم استلام محاولات تحقق كثيرة جدًا. انتظر قليلًا ثم حاول مجددًا.",
    retry: "المحاولة مجددًا",
    protectedBy: "محمي بواسطة Cloudflare Turnstile",
    privacy: "تخزن أكسورا ملف ارتباط موقّعًا من الطرف الأول وبصمات غير قابلة للعكس لإشارات محدودة من الشبكة والجهاز. لا يخزن العداد عنوان IP الخام.",
    privacyLink: "الخصوصية",
    groupLabel: "اختر فريق الزوار",
    result: (choice, visitorNumber) => `اخترت ${choice === "EARLY_BIRD" ? "فريق الصباح الباكر" : "فريق السهر"}. أنت الزائر رقم #${visitorNumber.toLocaleString("ar")}.`,
  },
  ms: {
    eyebrow: "Satu klik. Satu tempat kekal.",
    title: "Anda di pihak mana?",
    body: "Pilih sekali. Axora mengesahkan tuntutan pada pelayan dan mengekalkan nombor pelawat anda pada tuntutan tanpa nama tersebut.",
    totalLabel: "tempat pelawat telah dituntut",
    earlyTitle: "Pasukan Awal Pagi",
    earlyDescription: "Idea terbaik muncul sebelum hari menjadi sibuk.",
    nightTitle: "Pasukan Kaki Malam",
    nightDescription: "Fokus sebenar bermula selepas suasana menjadi tenang.",
    earlyCountLabel: "Awal Pagi",
    nightCountLabel: "Kaki Malam",
    chooseEarly: "Pilih Pasukan Awal Pagi",
    chooseNight: "Pilih Pasukan Kaki Malam",
    locked: "PILIHAN DIKUNCI",
    alreadyClaimed: "Tempat anda telah pun dituntut.",
    loading: "Memuatkan kiraan langsung…",
    verifying: "Mengesahkan pilihan sekali sahaja anda…",
    unavailable: "Tuntutan nombor pelawat tidak tersedia buat sementara waktu. Jumlah langsung akan kembali tidak lama lagi.",
    error: "Pilihan anda tidak dapat disahkan. Tiada kiraan ditambah.",
    scriptError: "Pemeriksaan keselamatan tidak dapat dimuatkan. Tiada kiraan ditambah.",
    unsupported: "Pelayar ini tidak menyokong pemeriksaan keselamatan. Kemas kini pelayar atau gunakan pelayar yang disokong, kemudian cuba lagi.",
    timeout: "Pemeriksaan keselamatan mengambil masa terlalu lama. Tiada kiraan ditambah.",
    requestTimeout: "Axora tidak dapat mengesahkan keputusan dalam masa yang ditetapkan. Tiada pilihan baharu akan dihantar sehingga tuntutan semasa diperiksa.",
    rejected: "Cloudflare tidak dapat mengesahkan percubaan ini. Tiada kiraan ditambah.",
    rateLimited: "Terlalu banyak percubaan pengesahan diterima. Tunggu sebentar, kemudian cuba lagi.",
    retry: "Cuba lagi",
    protectedBy: "Dilindungi oleh Cloudflare Turnstile",
    privacy: "Axora menyimpan kuki tuntutan pihak pertama yang ditandatangani serta cincangan tidak boleh dibalikkan bagi isyarat rangkaian dan peranti yang terhad. Kaunter tidak menyimpan alamat IP mentah anda.",
    privacyLink: "Privasi",
    groupLabel: "Pilih pihak pelawat anda",
    result: (choice, visitorNumber) => `Anda memilih ${choice === "EARLY_BIRD" ? "Pasukan Awal Pagi" : "Pasukan Kaki Malam"}. Anda ialah pelawat #${visitorNumber.toLocaleString("ms-MY")}.`,
  },
};
