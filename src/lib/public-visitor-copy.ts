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
    body: "Choose once. One public network can hold one permanent visitor spot, including in private browsing.",
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
    alreadyClaimed: "This browser or public network already has a claimed spot.",
    loading: "Loading the live count…",
    verifying: "Verifying your one-time choice…",
    unavailable: "Visitor claiming is temporarily unavailable. The live totals will return shortly.",
    error: "Your choice could not be verified. Nothing was counted.",
    scriptError: "The security check could not load. Nothing was counted.",
    unsupported: "This browser cannot run the security check. Update it or use a supported browser, then retry.",
    timeout: "The security check took too long. Nothing was counted.",
    requestTimeout: "Axora could not confirm the result in time. Nothing new will be submitted until the current claim is checked.",
    rejected: "This browser could not be verified. Make sure first-party cookies are allowed, then try again.",
    rateLimited: "Too many verification attempts were received. Wait a moment, then retry.",
    retry: "Try again",
    protectedBy: "Protected by Turnstile and Axora network safeguards",
    privacy: "Axora retains a permanent keyed hash of the server-observed public IP address, plus a signed first-party claim cookie and limited device hashes. The raw IP address is not stored. People sharing one public IP share one visitor spot.",
    privacyLink: "Privacy",
    groupLabel: "Choose your visitor side",
    result: (choice, visitorNumber) => `You chose ${choice === "EARLY_BIRD" ? "Early Birds" : "Night Owls"}. You are visitor #${visitorNumber.toLocaleString("en")}.`,
  },
  ar: {
    eyebrow: "نقرة واحدة. مكان واحد دائم.",
    title: "أيُّ فريق تختار؟",
    body: "اختر مرة واحدة. يمكن لكل شبكة عامة حجز مكان زائر دائم واحد، حتى عند استخدام التصفح الخاص.",
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
    alreadyClaimed: "يوجد بالفعل مكان محجوز لهذا المتصفح أو الشبكة العامة.",
    loading: "جارٍ تحميل العدد المباشر…",
    verifying: "جارٍ التحقق من اختيارك لمرة واحدة…",
    unavailable: "حجز رقم الزائر غير متاح مؤقتًا. ستعود الأعداد المباشرة قريبًا.",
    error: "تعذر التحقق من اختيارك، ولم تتم إضافة أي عدد.",
    scriptError: "تعذر تحميل فحص الأمان. لم تتم إضافة أي عدد.",
    unsupported: "هذا المتصفح لا يدعم فحص الأمان. حدّث المتصفح أو استخدم متصفحًا مدعومًا، ثم حاول مجددًا.",
    timeout: "استغرق فحص الأمان وقتًا أطول من اللازم. لم تتم إضافة أي عدد.",
    requestTimeout: "لم تتمكن أكسورا من تأكيد النتيجة في الوقت المحدد. لن يُرسل اختيار جديد قبل التحقق من المطالبة الحالية.",
    rejected: "تعذر التحقق من هذا المتصفح. تأكد من السماح بملفات ارتباط الطرف الأول، ثم حاول مجددًا.",
    rateLimited: "تم استلام محاولات تحقق كثيرة جدًا. انتظر قليلًا ثم حاول مجددًا.",
    retry: "المحاولة مجددًا",
    protectedBy: "محمي بواسطة Turnstile وضوابط شبكة أكسورا",
    privacy: "تحتفظ أكسورا ببصمة دائمة مُشفّرة بمفتاح لعنوان IP العام الذي يراه الخادم، إضافةً إلى ملف ارتباط موقّع من الطرف الأول وبصمات محدودة للجهاز. لا يُخزَّن عنوان IP الخام. يشترك الأشخاص الذين يستخدمون عنوان IP عامًا واحدًا في مكان زائر واحد.",
    privacyLink: "الخصوصية",
    groupLabel: "اختر فريق الزوار",
    result: (choice, visitorNumber) => `اخترت ${choice === "EARLY_BIRD" ? "فريق الصباح الباكر" : "فريق السهر"}. أنت الزائر رقم #${visitorNumber.toLocaleString("ar")}.`,
  },
  ms: {
    eyebrow: "Satu klik. Satu tempat kekal.",
    title: "Anda di pihak mana?",
    body: "Pilih sekali. Satu rangkaian awam boleh memegang satu tempat pelawat kekal, termasuk dalam pelayaran peribadi.",
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
    alreadyClaimed: "Pelayar atau rangkaian awam ini sudah mempunyai tempat yang dituntut.",
    loading: "Memuatkan kiraan langsung…",
    verifying: "Mengesahkan pilihan sekali sahaja anda…",
    unavailable: "Tuntutan nombor pelawat tidak tersedia buat sementara waktu. Jumlah langsung akan kembali tidak lama lagi.",
    error: "Pilihan anda tidak dapat disahkan. Tiada kiraan ditambah.",
    scriptError: "Pemeriksaan keselamatan tidak dapat dimuatkan. Tiada kiraan ditambah.",
    unsupported: "Pelayar ini tidak menyokong pemeriksaan keselamatan. Kemas kini pelayar atau gunakan pelayar yang disokong, kemudian cuba lagi.",
    timeout: "Pemeriksaan keselamatan mengambil masa terlalu lama. Tiada kiraan ditambah.",
    requestTimeout: "Axora tidak dapat mengesahkan keputusan dalam masa yang ditetapkan. Tiada pilihan baharu akan dihantar sehingga tuntutan semasa diperiksa.",
    rejected: "Pelayar ini tidak dapat disahkan. Pastikan kuki pihak pertama dibenarkan, kemudian cuba lagi.",
    rateLimited: "Terlalu banyak percubaan pengesahan diterima. Tunggu sebentar, kemudian cuba lagi.",
    retry: "Cuba lagi",
    protectedBy: "Dilindungi oleh Turnstile dan kawalan rangkaian Axora",
    privacy: "Axora menyimpan cincangan berkunci kekal bagi alamat IP awam yang dilihat oleh pelayan, bersama kuki tuntutan pihak pertama yang ditandatangani dan cincangan peranti terhad. Alamat IP mentah tidak disimpan. Orang yang berkongsi satu alamat IP awam berkongsi satu tempat pelawat.",
    privacyLink: "Privasi",
    groupLabel: "Pilih pihak pelawat anda",
    result: (choice, visitorNumber) => `Anda memilih ${choice === "EARLY_BIRD" ? "Pasukan Awal Pagi" : "Pasukan Kaki Malam"}. Anda ialah pelawat #${visitorNumber.toLocaleString("ms-MY")}.`,
  },
};
