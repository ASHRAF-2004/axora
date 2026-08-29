import { requireSession } from "@/lib/auth";
import {
  getIntegrationRequestDraftReview,
  IntegrationDraftReviewError,
} from "@/lib/integrations/request-drafts";
import { canAccess } from "@/lib/permissions";
import { AlertTriangle, ArrowRight, FileCheck2, PackageCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { importIntegrationRequestDraftAction } from "./actions";
import styles from "./DraftReview.module.css";

export const dynamic = "force-dynamic";

const messages = {
  en: {
    eyebrow:"Integration draft",title:"Review request draft",safe:"Review required",
    description:"This external draft has not submitted a purchase request, reserved budget, debited a Wallet, created an invoice, or started a delivery.",
    source:"Source app",company:"Company",branch:"Branch",needed:"Needed by",urgency:"Urgency",
    department:"External department reference",status:"Status",created:"Created",expires:"Expires",
    items:"Draft items",product:"Product",reference:"Reference",quantity:"Quantity",specification:"Specification",
    none:"None",pending:"Pending review",inReview:"In review",consumed:"Submitted",cancelled:"Cancelled",expired:"Expired",
    import:"Import into my empty cart",continue:"Continue Axora review",openRequest:"Open submitted request",
    importHelp:"Importing populates your empty Axora cart. You will still review current prices, budget, request details, and explicitly submit through Axora.",
    directUnsafe:"Company Administrator direct purchase is intentionally unavailable for external drafts. An authorized requester must review and submit this draft through Axora's request workflow.",
    unavailable:"This draft cannot be imported in its current state.",cartNotEmpty:"Your cart already contains items. Finish or clear that cart before importing this draft.",
    alreadyReviewed:"Another authorized user is already reviewing this draft.",error:"The draft could not be imported. Refresh and verify your current access.",
    back:"Back to Integrations",backRequests:"Back to requests",reviewedBy:"Reviewed by",notes:"Notes",
  },
  ar: {
    eyebrow:"مسودة تكامل",title:"مراجعة مسودة الطلب",safe:"المراجعة مطلوبة",
    description:"لم ترسل هذه المسودة الخارجية طلب شراء، ولم تحجز ميزانية، ولم تخصم من المحفظة، ولم تنشئ فاتورة أو تبدأ تسليمًا.",
    source:"التطبيق المصدر",company:"الشركة",branch:"الفرع",needed:"مطلوب بحلول",urgency:"الأولوية",
    department:"مرجع القسم الخارجي",status:"الحالة",created:"تاريخ الإنشاء",expires:"تاريخ الانتهاء",
    items:"عناصر المسودة",product:"المنتج",reference:"المرجع",quantity:"الكمية",specification:"المواصفات",
    none:"لا يوجد",pending:"بانتظار المراجعة",inReview:"قيد المراجعة",consumed:"تم الإرسال",cancelled:"ملغاة",expired:"منتهية",
    import:"استيراد إلى سلتي الفارغة",continue:"متابعة المراجعة في أكسورا",openRequest:"فتح الطلب المرسل",
    importHelp:"يملأ الاستيراد سلة أكسورا الفارغة. ستراجع الأسعار الحالية والميزانية وتفاصيل الطلب ثم ترسله صراحةً داخل أكسورا.",
    directUnsafe:"الشراء المباشر لمسؤول الشركة غير متاح عمدًا للمسودات الخارجية. يجب على طالب مخوّل مراجعة المسودة وإرسالها عبر مسار الطلب في أكسورا.",
    unavailable:"لا يمكن استيراد هذه المسودة في حالتها الحالية.",cartNotEmpty:"تحتوي سلتك على عناصر. أكملها أو أفرغها قبل استيراد المسودة.",
    alreadyReviewed:"يقوم مستخدم مخوّل آخر بمراجعة هذه المسودة.",error:"تعذر استيراد المسودة. حدّث الصفحة وتحقق من صلاحيتك الحالية.",
    back:"العودة إلى التكاملات",backRequests:"العودة إلى الطلبات",reviewedBy:"تمت المراجعة بواسطة",notes:"ملاحظات",
  },
  ms: {
    eyebrow:"Draf integrasi",title:"Semak draf permintaan",safe:"Semakan diperlukan",
    description:"Draf luaran ini belum menghantar permintaan pembelian, menempah bajet, mendebit Dompet, mencipta invois atau memulakan penghantaran.",
    source:"Aplikasi sumber",company:"Syarikat",branch:"Cawangan",needed:"Diperlukan pada",urgency:"Keutamaan",
    department:"Rujukan jabatan luaran",status:"Status",created:"Dicipta",expires:"Tamat tempoh",
    items:"Item draf",product:"Produk",reference:"Rujukan",quantity:"Kuantiti",specification:"Spesifikasi",
    none:"Tiada",pending:"Menunggu semakan",inReview:"Dalam semakan",consumed:"Dihantar",cancelled:"Dibatalkan",expired:"Tamat tempoh",
    import:"Import ke troli kosong saya",continue:"Teruskan semakan Axora",openRequest:"Buka permintaan dihantar",
    importHelp:"Import mengisi troli Axora anda yang kosong. Anda masih akan menyemak harga semasa, bajet dan butiran permintaan sebelum menghantar secara nyata melalui Axora.",
    directUnsafe:"Pembelian terus Pentadbir Syarikat sengaja tidak tersedia untuk draf luaran. Pemohon yang dibenarkan mesti menyemak dan menghantar draf melalui aliran permintaan Axora.",
    unavailable:"Draf ini tidak boleh diimport dalam keadaan semasa.",cartNotEmpty:"Troli anda sudah mempunyai item. Selesaikan atau kosongkan troli itu sebelum mengimport draf ini.",
    alreadyReviewed:"Pengguna lain yang dibenarkan sedang menyemak draf ini.",error:"Draf tidak dapat diimport. Muat semula dan sahkan akses semasa anda.",
    back:"Kembali ke Integrasi",backRequests:"Kembali ke permintaan",reviewedBy:"Disemak oleh",notes:"Nota",
  },
} as const;

export default async function IntegrationDraftReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requireSession();
  const canManageIntegrations = canAccess(actor,"manage_company_integrations");
  if (!canManageIntegrations && !canAccess(actor,"create_requests")) {
    redirect("/access-denied");
  }
  const [{ id },query] = await Promise.all([params,searchParams]);
  let draft;
  try {
    draft = await getIntegrationRequestDraftReview(actor,id);
  } catch (error) {
    if (error instanceof IntegrationDraftReviewError) notFound();
    throw error;
  }
  const locale = actor.preferredLocale ?? "en";
  const copy = messages[locale];
  const date = new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:actor.timezone ?? "Asia/Kuala_Lumpur"});
  const number = new Intl.NumberFormat(locale,{maximumFractionDigits:0});
  const statusText = draft.status === "PENDING_REVIEW" ? copy.pending
    : draft.status === "IN_REVIEW" ? copy.inReview
      : draft.status === "CONSUMED" ? copy.consumed
        : draft.status === "CANCELLED" ? copy.cancelled : copy.expired;
  const notice = query.notice === "cart_not_empty" ? copy.cartNotEmpty
    : query.notice === "already_reviewed" ? copy.alreadyReviewed
      : query.notice ? copy.error : undefined;
  const continueHref = `/requests/new?${new URLSearchParams({branch:draft.branchId,integrationDraft:draft.id}).toString()}`;
  return <div className={styles.workspace}>
    <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
      <span className={styles.safeBadge}><ShieldCheck size={18} aria-hidden="true" />{copy.safe}</span>
    </header>
    {notice ? <div className={styles.errorNotice} role="alert"><AlertTriangle size={18} aria-hidden="true" />{notice}</div> : null}
    <section className={styles.summary} aria-label={copy.title}>
      <dl className={styles.summaryGrid}>
        <div><dt>{copy.status}</dt><dd><span className={styles.statusBadge} data-status={draft.status.toLowerCase()}>{statusText}</span></dd></div>
        <div><dt>{copy.source}</dt><dd>{draft.applicationName ?? "Axora API"}</dd></div>
        <div><dt>{copy.company}</dt><dd>{draft.companyName}</dd></div>
        <div><dt>{copy.branch}</dt><dd>{draft.branchName}</dd></div>
        <div><dt>{copy.needed}</dt><dd><bdi dir="ltr">{draft.neededByDate}</bdi></dd></div>
        <div><dt>{copy.urgency}</dt><dd>{draft.urgency}</dd></div>
        <div><dt>{copy.department}</dt><dd>{draft.departmentReference}</dd></div>
        <div><dt>{copy.created}</dt><dd><time dateTime={draft.createdAt}>{date.format(new Date(draft.createdAt))}</time></dd></div>
        <div><dt>{copy.expires}</dt><dd><time dateTime={draft.expiresAt}>{date.format(new Date(draft.expiresAt))}</time></dd></div>
        {draft.reviewedByName ? <div><dt>{copy.reviewedBy}</dt><dd>{draft.reviewedByName}</dd></div> : null}
        {draft.notes ? <div className={styles.fullDetail}><dt>{copy.notes}</dt><dd>{draft.notes}</dd></div> : null}
      </dl>
    </section>
    <section className={styles.itemsPanel} aria-labelledby="draft-items-title">
      <header><PackageCheck size={20} aria-hidden="true" /><h2 id="draft-items-title">{copy.items}</h2></header>
      <div className={styles.tableWrap}><table><thead><tr><th>{copy.product}</th><th>{copy.reference}</th><th>{copy.quantity}</th><th>{copy.specification}</th></tr></thead>
        <tbody>{draft.items.map((item) => <tr key={item.id}>
          <td data-label={copy.product}>{item.productName}<small>{item.unit}</small></td>
          <td data-label={copy.reference}><code dir="ltr">{item.productReference}</code></td>
          <td data-label={copy.quantity}><bdi dir="ltr">{number.format(item.quantity)}</bdi></td>
          <td data-label={copy.specification}>{item.specification ?? copy.none}</td>
        </tr>)}</tbody></table></div>
    </section>
    <section className={styles.reviewPanel} aria-labelledby="safe-review-title">
      <div><FileCheck2 size={22} aria-hidden="true" /><div><h2 id="safe-review-title">{copy.safe}</h2><p>{draft.canImport || draft.canContinue ? copy.importHelp : copy.directUnsafe}</p></div></div>
      <div className={styles.actions}>
        <Link className="button button-secondary" href={canManageIntegrations ? "/integrations" : "/requests"}>
          {canManageIntegrations ? copy.back : copy.backRequests}
        </Link>
        {draft.canImport ? <form action={importIntegrationRequestDraftAction.bind(null,draft.id)}>
          <button className="button button-primary" type="submit">{copy.import}<ArrowRight className="directional-icon" size={16} aria-hidden="true" /></button>
        </form> : draft.canContinue ? <Link className="button button-primary" href={continueHref}>{copy.continue}<ArrowRight className="directional-icon" size={16} aria-hidden="true" /></Link>
          : draft.submittedRequestId ? <Link className="button button-primary" href={`/requests/${draft.submittedRequestId}`}>{copy.openRequest}<ArrowRight className="directional-icon" size={16} aria-hidden="true" /></Link>
            : <span className={styles.unavailable}>{copy.unavailable}</span>}
      </div>
    </section>
  </div>;
}
