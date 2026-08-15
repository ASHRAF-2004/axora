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
    eyebrow: "One click. One spot in this browser.",
    title: "Which side are you on?",
    body: "Choose once for this browser. Axora remembers your choice while its signed first-party cookie remains available. Clearing site data or changing browser or device may allow a new choice.",
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
    alreadyClaimed: "This browser already has a claimed spot.",
    loading: "Loading the near-live count…",
    verifying: "Verifying your one-time browser choice…",
    unavailable: "Visitor claiming is temporarily unavailable. The latest totals will return shortly.",
    error: "Your choice could not be verified. Nothing was counted.",
    scriptError: "The security check could not load. Nothing was counted.",
    unsupported: "This browser cannot run the security check. Update it or use a supported browser, then retry.",
    timeout: "The security check took too long. Nothing was counted.",
    requestTimeout: "Axora could not confirm the result in time. Nothing new will be submitted until the current claim is checked.",
    rejected: "This browser could not be verified. Make sure first-party cookies are allowed, then try again.",
    rateLimited: "Too many verification attempts were received. Wait a moment, then retry.",
    retry: "Try again",
    protectedBy: "Protected by Turnstile and bounded abuse safeguards",
    privacy: "The signed cookie is the anonymous identity. Axora does not use a durable IP or device fingerprint; a short-lived network rate bucket is used only to prevent abuse.",
    privacyLink: "Privacy",
    groupLabel: "Choose your visitor side",
    result: (choice, visitorNumber) => `You chose ${choice === "EARLY_BIRD" ? "Early Birds" : "Night Owls"}. You are visitor #${visitorNumber.toLocaleString("en")}.`,
  },
  ar: {
    eyebrow: "نقرة واحدة. مكان واحد في هذا المتصفح.",
    title: "أيُّ فريق تختار؟",
    body: "اختر مرة واحدة لهذا المتصفح. تتذكر أكسورا اختيارك ما دام ملف ارتباط الطرف الأول الموقّع متاحًا. قد يسمح مسح بيانات الموقع أو تغيير المتصفح أو الجهاز باختيار جديد.",
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
    alreadyClaimed: "يوجد بالفعل مكان محجوز لهذا المتصفح.",
    loading: "جارٍ تحميل العدد شبه المباشر…",
    verifying: "جارٍ التحقق من اختيار هذا المتصفح لمرة واحدة…",
    unavailable: "حجز رقم الزائر غير متاح مؤقتًا. ستعود أحدث الأعداد قريبًا.",
    error: "تعذر التحقق من اختيارك، ولم تتم إضافة أي عدد.",
    scriptError: "تعذر تحميل فحص الأمان. لم تتم إضافة أي عدد.",
    unsupported: "هذا المتصفح لا يدعم فحص الأمان. حدّث المتصفح أو استخدم متصفحًا مدعومًا، ثم حاول مجددًا.",
    timeout: "استغرق فحص الأمان وقتًا أطول من اللازم. لم تتم إضافة أي عدد.",
    requestTimeout: "لم تتمكن أكسورا من تأكيد النتيجة في الوقت المحدد. لن يُرسل اختيار جديد قبل التحقق من المطالبة الحالية.",
    rejected: "تعذر التحقق من هذا المتصفح. تأكد من السماح بملفات ارتباط الطرف الأول، ثم حاول مجددًا.",
    rateLimited: "تم استلام محاولات تحقق كثيرة جدًا. انتظر قليلًا ثم حاول مجددًا.",
    retry: "المحاولة مجددًا",
    protectedBy: "محمي بواسطة Turnstile وضوابط محدودة لمنع الإساءة",
    privacy: "ملف الارتباط الموقّع هو الهوية المجهولة. لا تستخدم أكسورا بصمة دائمة لعنوان IP أو الجهاز؛ ويُستخدم نطاق شبكة قصير الأجل فقط لمنع الإساءة.",
    privacyLink: "الخصوصية",
    groupLabel: "اختر فريق الزوار",
    result: (choice, visitorNumber) => `اخترت ${choice === "EARLY_BIRD" ? "فريق الصباح الباكر" : "فريق السهر"}. أنت الزائر رقم #${visitorNumber.toLocaleString("ar")}.`,
  },
  ms: {
    eyebrow: "Satu klik. Satu tempat dalam pelayar ini.",
    title: "Anda di pihak mana?",
    body: "Pilih sekali untuk pelayar ini. Axora mengingati pilihan anda selagi kuki pihak pertama yang ditandatangani tersedia. Memadam data laman atau menukar pelayar atau peranti mungkin membolehkan pilihan baharu.",
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
    alreadyClaimed: "Pelayar ini sudah mempunyai tempat yang dituntut.",
    loading: "Memuatkan kiraan hampir langsung…",
    verifying: "Mengesahkan pilihan sekali sahaja untuk pelayar ini…",
    unavailable: "Tuntutan nombor pelawat tidak tersedia buat sementara waktu. Jumlah terkini akan kembali tidak lama lagi.",
    error: "Pilihan anda tidak dapat disahkan. Tiada kiraan ditambah.",
    scriptError: "Pemeriksaan keselamatan tidak dapat dimuatkan. Tiada kiraan ditambah.",
    unsupported: "Pelayar ini tidak menyokong pemeriksaan keselamatan. Kemas kini pelayar atau gunakan pelayar yang disokong, kemudian cuba lagi.",
    timeout: "Pemeriksaan keselamatan mengambil masa terlalu lama. Tiada kiraan ditambah.",
    requestTimeout: "Axora tidak dapat mengesahkan keputusan dalam masa yang ditetapkan. Tiada pilihan baharu akan dihantar sehingga tuntutan semasa diperiksa.",
    rejected: "Pelayar ini tidak dapat disahkan. Pastikan kuki pihak pertama dibenarkan, kemudian cuba lagi.",
    rateLimited: "Terlalu banyak percubaan pengesahan diterima. Tunggu sebentar, kemudian cuba lagi.",
    retry: "Cuba lagi",
    protectedBy: "Dilindungi oleh Turnstile dan kawalan penyalahgunaan terhad",
    privacy: "Kuki yang ditandatangani ialah identiti tanpa nama. Axora tidak menggunakan cap jari IP atau peranti yang kekal; baldi kadar rangkaian jangka pendek digunakan hanya untuk mencegah penyalahgunaan.",
    privacyLink: "Privasi",
    groupLabel: "Pilih pihak pelawat anda",
    result: (choice, visitorNumber) => `Anda memilih ${choice === "EARLY_BIRD" ? "Pasukan Awal Pagi" : "Pasukan Kaki Malam"}. Anda ialah pelawat #${visitorNumber.toLocaleString("ms-MY")}.`,
  },
};
