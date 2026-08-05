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
    retry: "Cuba lagi",
    protectedBy: "Dilindungi oleh Cloudflare Turnstile",
    privacy: "Axora menyimpan kuki tuntutan pihak pertama yang ditandatangani serta cincangan tidak boleh dibalikkan bagi isyarat rangkaian dan peranti yang terhad. Kaunter tidak menyimpan alamat IP mentah anda.",
    privacyLink: "Privasi",
    groupLabel: "Pilih pihak pelawat anda",
    result: (choice, visitorNumber) => `Anda memilih ${choice === "EARLY_BIRD" ? "Pasukan Awal Pagi" : "Pasukan Kaki Malam"}. Anda ialah pelawat #${visitorNumber.toLocaleString("ms-MY")}.`,
  },
};
