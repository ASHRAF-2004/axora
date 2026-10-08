import { AccountSetupClient } from "@/components/AccountSetupClient";
import { Brand } from "@/components/Brand";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { requestLocaleDecision } from "@/lib/locale-server";
import styles from "./Setup.module.css";

export const metadata: Metadata = {
  title: "Set up your account",
  robots: { index: false, follow: false },
};

const pageCopy = {
  en: { chip: "Private account setup", title: "Your Axora access starts here.", body: "Choose a password known only to you. Your administrator cannot see it, and this invitation can be used only once.", points: ["Single-use setup link", "Password protected with secure hashing", "Company and branch access already assigned"], footer: "Axora operations · Secure procurement management" },
  ar: { chip: "إعداد حساب خاص", title: "يبدأ وصولك إلى Axora من هنا.", body: "اختر كلمة مرور لا يعرفها سواك. لا يستطيع مديرك رؤيتها، ولا يمكن استخدام هذه الدعوة إلا مرة واحدة.", points: ["رابط إعداد للاستخدام مرة واحدة", "حماية كلمة المرور بتجزئة آمنة", "تم تعيين الشركة والفرع مسبقًا"], footer: "عمليات Axora · إدارة مشتريات آمنة" },
  ms: { chip: "Persediaan akaun peribadi", title: "Akses Axora anda bermula di sini.", body: "Pilih kata laluan yang hanya anda ketahui. Pentadbir tidak boleh melihatnya dan jemputan ini hanya boleh digunakan sekali.", points: ["Pautan persediaan sekali guna", "Kata laluan dilindungi dengan pencincangan selamat", "Akses syarikat dan cawangan telah ditetapkan"], footer: "Operasi Axora · Pengurusan perolehan selamat" },
} as const;

export default async function AccountSetupPage() {
  const { locale } = await requestLocaleDecision();
  const copy = pageCopy[locale];
  return (
    <main className={`simple-auth-page account-setup-shell ${styles.page}`} lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className={`simple-auth-wrap ${styles.workspace}`}>
        <header className={styles.intro}>
          <Link className="simple-auth-brand" href={`/${locale}`} aria-label="Axora"><Brand /></Link>
          <p className={styles.security}><ShieldCheck size={16} aria-hidden="true" />{copy.chip}</p>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
        </header>
        <AccountSetupClient initialLocale={locale} />
        <ul className={styles.assurances}>
          {copy.points.map((point) => <li key={point}><ShieldCheck size={16} aria-hidden="true" />{point}</li>)}
        </ul>
        <small className={styles.footer}>{copy.footer}</small>
      </div>
    </main>
  );
}
