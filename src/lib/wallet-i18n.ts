import type { SupportedLocale } from "./i18n";
import {
  type ApproveAndPayResultStatus,
  type TopUpStatus,
} from "./finance-business-results";

export interface FinanceBusinessResultCopy {
  title: string;
  body: string;
}

export type FinanceBusinessResultTone = "success" | "information" | "warning";

export const APPROVE_AND_PAY_RESULT_TONES: Readonly<
  Record<ApproveAndPayResultStatus, FinanceBusinessResultTone>
> = {
  SUCCESS: "success",
  ALREADY_PROCESSED: "information",
  INSUFFICIENT_WALLET: "warning",
  INSUFFICIENT_BUDGET: "warning",
  STALE_REQUEST: "warning",
  NOT_READY: "warning",
};

export interface WalletMessages {
  companyWallet: string;
  walletIntro: string;
  walletFundsNote: string;
  availableBalance: string;
  selectCompany: string;
  openCompanyWallet: string;
  noWallets: string;
  ledger: string;
  noLedgerEntries: string;
  topUps: string;
  noTopUpRequests: string;
  requestTopUp: string;
  requestTopUpIntro: string;
  recordTopUp: string;
  recordTopUpIntro: string;
  amount: string;
  receivedDate: string;
  reference: string;
  optionalNote: string;
  reason: string;
  status: string;
  requestedOn: string;
  processedOn: string;
  postedOn: string;
  transactionType: string;
  ledgerTypes: Record<"TOP_UP" | "PAYMENT" | "REFUND" | "ADJUSTMENT", string>;
  directTopUp: string;
  submitTopUpRequest: string;
  recordReceivedTopUp: string;
  topUpRequested: string;
  topUpRecorded: string;
  topUpAlreadyRecorded: string;
  invalidSubmission: string;
  unavailable: string;
  approveAndPay: string;
  approveAndPayIntro: string;
  branchLocationRequired: FinanceBusinessResultCopy;
  topUpStatuses: Record<TopUpStatus, string>;
  approveAndPayResults: Record<ApproveAndPayResultStatus, FinanceBusinessResultCopy>;
}

const messages = {
  en: {
    companyWallet: "Company Wallet",
    walletIntro: "Review the actual funds credited to your company and their immutable transaction history.",
    walletFundsNote: "The Company Wallet contains actual funds. Branch budgets are spending limits and never create money.",
    availableBalance: "Available balance",
    selectCompany: "Company",
    openCompanyWallet: "Open wallet",
    noWallets: "No Company Wallet is available in your authorized scope.",
    ledger: "Wallet ledger",
    noLedgerEntries: "No wallet transactions have been recorded yet.",
    topUps: "Top-Ups",
    noTopUpRequests: "No top-up requests have been submitted yet.",
    requestTopUp: "Request Top-Up",
    requestTopUpIntro: "Ask Axora to review a requested addition to the Company Wallet. This request does not credit funds.",
    recordTopUp: "Record Top-Up",
    recordTopUpIntro: "Record funds only after Axora has confirmed that the money was received outside the platform.",
    amount: "Amount",
    receivedDate: "Received date",
    reference: "Reference",
    optionalNote: "Note (optional)",
    reason: "Business reason",
    status: "Status",
    requestedOn: "Requested on",
    processedOn: "Processed on",
    postedOn: "Posted on",
    transactionType: "Transaction type",
    ledgerTypes: { TOP_UP: "Top-up", PAYMENT: "Payment", REFUND: "Refund", ADJUSTMENT: "Adjustment" },
    directTopUp: "Record a direct top-up",
    submitTopUpRequest: "Submit top-up request",
    recordReceivedTopUp: "Record received funds",
    topUpRequested: "Your top-up request was submitted to Axora.",
    topUpRecorded: "The received funds were recorded in the Company Wallet.",
    topUpAlreadyRecorded: "This top-up was already recorded. No additional funds were credited.",
    invalidSubmission: "Check the amount and required details, then submit again.",
    unavailable: "This wallet operation is no longer available in your authorized scope.",
    approveAndPay: "Approve & Pay",
    approveAndPayIntro: "Final approval and payment are recorded together. Axora checks the branch allocation and Company Wallet before deducting funds.",
    branchLocationRequired: {
      title: "Branch delivery location required",
      body: "Configure the branch delivery location before Approve & Pay. No approval or funds were recorded.",
    },
    topUpStatuses: {
      REQUESTED: "Requested",
      ACKNOWLEDGED: "Acknowledged",
      RECEIVED: "Received",
      REJECTED: "Rejected",
      CANCELLED: "Cancelled",
    },
    approveAndPayResults: {
      SUCCESS: {
        title: "Request approved and paid",
        body: "The payment was recorded once and the invoice is ready for processing.",
      },
      ALREADY_PROCESSED: {
        title: "Already approved and paid",
        body: "This request was already processed. No additional funds were deducted.",
      },
      INSUFFICIENT_WALLET: {
        title: "Company balance is insufficient",
        body: "Company balance is insufficient. Contact your Company Administrator to arrange a top-up.",
      },
      INSUFFICIENT_BUDGET: {
        title: "Branch budget is insufficient",
        body: "This branch does not have enough available budget for the request. Contact your Company Administrator to review the allocation.",
      },
      STALE_REQUEST: {
        title: "Request details changed",
        body: "Refresh the page and review the latest request details before trying again.",
      },
      NOT_READY: {
        title: "Request is not ready",
        body: "This request is not currently ready for Approve & Pay. Review its latest status.",
      },
    },
  },
  ar: {
    companyWallet: "محفظة الشركة",
    walletIntro: "راجع الأموال الفعلية المضافة إلى شركتك وسجل معاملاتها غير القابل للتغيير.",
    walletFundsNote: "تحتوي محفظة الشركة على الأموال الفعلية. ميزانيات الفروع حدود للإنفاق ولا تنشئ أموالًا.",
    availableBalance: "الرصيد المتاح",
    selectCompany: "الشركة",
    openCompanyWallet: "فتح المحفظة",
    noWallets: "لا توجد محفظة شركة متاحة ضمن نطاقك المصرح به.",
    ledger: "دفتر محفظة الشركة",
    noLedgerEntries: "لم تُسجل أي معاملات في المحفظة بعد.",
    topUps: "إضافات الرصيد",
    noTopUpRequests: "لم تُرسل أي طلبات إضافة رصيد بعد.",
    requestTopUp: "طلب إضافة رصيد",
    requestTopUpIntro: "اطلب من أكسورا مراجعة إضافة مقترحة إلى محفظة الشركة. لا يضيف هذا الطلب أموالاً إلى الرصيد.",
    recordTopUp: "تسجيل إضافة رصيد",
    recordTopUpIntro: "سجّل الأموال فقط بعد أن تؤكد أكسورا استلامها خارج المنصة.",
    amount: "المبلغ",
    receivedDate: "تاريخ الاستلام",
    reference: "المرجع",
    optionalNote: "ملاحظة (اختيارية)",
    reason: "سبب العمل",
    status: "الحالة",
    requestedOn: "تاريخ الطلب",
    processedOn: "تاريخ المعالجة",
    postedOn: "تاريخ التسجيل",
    transactionType: "نوع المعاملة",
    ledgerTypes: { TOP_UP: "إضافة رصيد", PAYMENT: "دفع", REFUND: "استرداد", ADJUSTMENT: "تسوية" },
    directTopUp: "تسجيل إضافة رصيد مباشرة",
    submitTopUpRequest: "إرسال طلب إضافة الرصيد",
    recordReceivedTopUp: "تسجيل الأموال المستلمة",
    topUpRequested: "أُرسل طلب إضافة الرصيد إلى أكسورا.",
    topUpRecorded: "سُجلت الأموال المستلمة في محفظة الشركة.",
    topUpAlreadyRecorded: "سبق تسجيل إضافة الرصيد هذه. لم تُضف أي أموال أخرى.",
    invalidSubmission: "تحقق من المبلغ والتفاصيل المطلوبة ثم أرسل مرة أخرى.",
    unavailable: "لم تعد عملية المحفظة هذه متاحة ضمن نطاقك المصرح به.",
    approveAndPay: "اعتماد ودفع",
    approveAndPayIntro: "يُسجل الاعتماد النهائي والدفع معًا. تتحقق أكسورا من مخصص الفرع ومحفظة الشركة قبل خصم الأموال.",
    branchLocationRequired: {
      title: "موقع تسليم الفرع مطلوب",
      body: "اضبط موقع تسليم الفرع قبل الاعتماد والدفع. لم يُسجل أي اعتماد أو خصم أموال.",
    },
    topUpStatuses: {
      REQUESTED: "مطلوب",
      ACKNOWLEDGED: "تم الاستلام",
      RECEIVED: "مستلم",
      REJECTED: "مرفوض",
      CANCELLED: "ملغى",
    },
    approveAndPayResults: {
      SUCCESS: {
        title: "تم اعتماد الطلب ودفعه",
        body: "سُجل الدفع مرة واحدة وأصبحت الفاتورة جاهزة للمعالجة.",
      },
      ALREADY_PROCESSED: {
        title: "سبق اعتماد الطلب ودفعه",
        body: "سبق تنفيذ هذا الطلب. لم تُخصم أي أموال إضافية.",
      },
      INSUFFICIENT_WALLET: {
        title: "رصيد الشركة غير كافٍ",
        body: "رصيد الشركة غير كافٍ. تواصل مع مدير الشركة لترتيب إضافة رصيد.",
      },
      INSUFFICIENT_BUDGET: {
        title: "ميزانية الفرع غير كافية",
        body: "لا يملك هذا الفرع ميزانية متاحة كافية للطلب. تواصل مع مدير الشركة لمراجعة المخصص.",
      },
      STALE_REQUEST: {
        title: "تغيرت تفاصيل الطلب",
        body: "حدّث الصفحة وراجع أحدث تفاصيل الطلب قبل المحاولة مرة أخرى.",
      },
      NOT_READY: {
        title: "الطلب غير جاهز",
        body: "هذا الطلب غير جاهز حاليًا للاعتماد والدفع. راجع أحدث حالة له.",
      },
    },
  },
  ms: {
    companyWallet: "Dompet Syarikat",
    walletIntro: "Semak dana sebenar yang dikreditkan kepada syarikat anda dan sejarah transaksi kekalnya.",
    walletFundsNote: "Dompet Syarikat mengandungi dana sebenar. Bajet cawangan ialah had perbelanjaan dan tidak pernah mencipta wang.",
    availableBalance: "Baki tersedia",
    selectCompany: "Syarikat",
    openCompanyWallet: "Buka dompet",
    noWallets: "Tiada Dompet Syarikat tersedia dalam skop dibenarkan anda.",
    ledger: "Lejar dompet",
    noLedgerEntries: "Belum ada transaksi dompet direkodkan.",
    topUps: "Tambah Nilai",
    noTopUpRequests: "Belum ada permohonan tambah nilai dihantar.",
    requestTopUp: "Mohon Tambah Nilai",
    requestTopUpIntro: "Minta Axora menyemak cadangan tambahan kepada Dompet Syarikat. Permohonan ini tidak mengkreditkan dana.",
    recordTopUp: "Rekod Tambah Nilai",
    recordTopUpIntro: "Rekod dana hanya selepas Axora mengesahkan wang diterima di luar platform.",
    amount: "Amaun",
    receivedDate: "Tarikh diterima",
    reference: "Rujukan",
    optionalNote: "Nota (pilihan)",
    reason: "Sebab perniagaan",
    status: "Status",
    requestedOn: "Dimohon pada",
    processedOn: "Diproses pada",
    postedOn: "Direkod pada",
    transactionType: "Jenis transaksi",
    ledgerTypes: { TOP_UP: "Tambah nilai", PAYMENT: "Bayaran", REFUND: "Bayaran balik", ADJUSTMENT: "Pelarasan" },
    directTopUp: "Rekod tambah nilai langsung",
    submitTopUpRequest: "Hantar permohonan tambah nilai",
    recordReceivedTopUp: "Rekod dana diterima",
    topUpRequested: "Permohonan tambah nilai anda telah dihantar kepada Axora.",
    topUpRecorded: "Dana diterima telah direkodkan dalam Dompet Syarikat.",
    topUpAlreadyRecorded: "Tambah nilai ini telah direkodkan. Tiada dana tambahan dikreditkan.",
    invalidSubmission: "Semak amaun dan butiran wajib, kemudian hantar semula.",
    unavailable: "Operasi dompet ini tidak lagi tersedia dalam skop dibenarkan anda.",
    approveAndPay: "Luluskan & Bayar",
    approveAndPayIntro: "Kelulusan akhir dan bayaran direkodkan bersama. Axora menyemak peruntukan cawangan dan Dompet Syarikat sebelum menolak dana.",
    branchLocationRequired: {
      title: "Lokasi penghantaran cawangan diperlukan",
      body: "Konfigurasikan lokasi penghantaran cawangan sebelum Luluskan & Bayar. Tiada kelulusan atau dana direkodkan.",
    },
    topUpStatuses: {
      REQUESTED: "Dimohon",
      ACKNOWLEDGED: "Diakui",
      RECEIVED: "Diterima",
      REJECTED: "Ditolak",
      CANCELLED: "Dibatalkan",
    },
    approveAndPayResults: {
      SUCCESS: {
        title: "Permintaan diluluskan dan dibayar",
        body: "Bayaran direkodkan sekali dan invois sedia untuk diproses.",
      },
      ALREADY_PROCESSED: {
        title: "Telah diluluskan dan dibayar",
        body: "Permintaan ini telah diproses. Tiada dana tambahan ditolak.",
      },
      INSUFFICIENT_WALLET: {
        title: "Baki syarikat tidak mencukupi",
        body: "Baki syarikat tidak mencukupi. Hubungi Pentadbir Syarikat anda untuk mengatur tambah nilai.",
      },
      INSUFFICIENT_BUDGET: {
        title: "Bajet cawangan tidak mencukupi",
        body: "Cawangan ini tidak mempunyai bajet tersedia yang mencukupi untuk permintaan tersebut. Hubungi Pentadbir Syarikat anda untuk menyemak peruntukan.",
      },
      STALE_REQUEST: {
        title: "Butiran permintaan telah berubah",
        body: "Muat semula halaman dan semak butiran permintaan terkini sebelum mencuba lagi.",
      },
      NOT_READY: {
        title: "Permintaan belum sedia",
        body: "Permintaan ini belum sedia untuk Luluskan & Bayar. Semak status terkininya.",
      },
    },
  },
} satisfies Record<SupportedLocale, WalletMessages>;

export function walletMessages(locale: SupportedLocale): WalletMessages {
  return messages[locale];
}

export function approveAndPayResultCopy(
  locale: SupportedLocale,
  status: ApproveAndPayResultStatus,
  requestState?: string,
): FinanceBusinessResultCopy {
  if (status === "NOT_READY" && requestState === "BRANCH_LOCATION_REQUIRED") {
    return messages[locale].branchLocationRequired;
  }
  return messages[locale].approveAndPayResults[status];
}

export function topUpStatusLabel(locale: SupportedLocale, status: TopUpStatus): string {
  return messages[locale].topUpStatuses[status];
}
