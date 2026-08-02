import { AccountSetupClient } from "@/components/AccountSetupClient";
import { Brand } from "@/components/Brand";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { requestLocaleDecision } from "@/lib/locale-server";

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
    <main className="login-shell account-setup-shell" lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="login-story">
        <div className="login-brand"><Brand /></div>
        <div>
          <span className="pilot-chip"><ShieldCheck size={15} /> {copy.chip}</span>
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <ul className="feature-list">
            {copy.points.map((point) => <li key={point}><ShieldCheck /> {point}</li>)}
          </ul>
        </div>
        <small>{copy.footer}</small>
      </section>

      <section className="login-panel">
        <AccountSetupClient initialLocale={locale} />
      </section>
    </main>
  );
}
