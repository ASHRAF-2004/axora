import type { SupportedLocale } from "./i18n";

export type LegalPageKind = "terms-and-conditions" | "privacy-policy";

export interface LegalPageContent {
  eyebrow: string;
  title: string;
  intro: string;
  effectiveLabel: string;
  effectiveDate: string;
  versionLabel: string;
  version: string;
  sections: Array<{ title: string; body: string; points?: string[] }>;
  contactTitle: string;
  contactBody: string;
}

const pages: Record<SupportedLocale, Record<LegalPageKind, LegalPageContent>> = {
  en: {
    "terms-and-conditions": {
      eyebrow: "Legal",
      title: "Terms & Conditions",
      intro: "These terms describe the rules for accessing and using Axora's business procurement platform and public website.",
      effectiveLabel: "Effective",
      effectiveDate: "28 August 2026",
      versionLabel: "Version",
      version: "1.0",
      sections: [
        { title: "1. Scope and acceptance", body: "These terms apply when you visit Axora's public website, submit a Contact enquiry, register or use an Axora account, or act for a company through the platform. Your organization's written agreement with Axora may add or replace terms for a particular service; that agreement takes priority where it expressly conflicts with this public version." },
        { title: "2. Accounts and authorized users", body: "Company accounts are used by people authorized by their organization. You must provide accurate account information, keep access methods secure, use only your own account, and promptly report suspected unauthorized access. Invitations and recovery links are personal, time-limited security credentials and must not be shared." },
        { title: "3. Procurement and business records", body: "Authorized users may create and manage requests, approvals, company Wallet records, payment and invoice information, delivery records, Proof of Delivery, and related documents according to their role. Users are responsible for the accuracy and lawfulness of information they submit. Axora's recorded workflow, authorization, and audit history may be used to understand the state of an order or action." },
        { title: "4. Company Wallet and financial information", body: "A Company Wallet and branch budgets serve different purposes. Wallet entries record platform-recognized credits, debits, refunds, or adjustments; budgets are spending controls. Users must not treat an unapproved top-up request as credited funds. Any separate payment or commercial terms agreed with a company continue to apply." },
        { title: "5. Files, documents, delivery and proof", body: "Users may upload or generate documents and delivery evidence only for legitimate business purposes. Delivery Agent evidence does not by itself replace a customer's authorized receipt or acceptance where that confirmation is required. Proof of Delivery and tracking access remain subject to role, company, branch, and assignment controls." },
        { title: "6. Acceptable use", body: "You must not misuse Axora, attempt to bypass authorization, access another company's records, probe or disrupt the service, introduce malicious code, impersonate another person, submit unlawful or misleading material, reverse engineer protected service elements, or use the platform to infringe another person's rights." },
        { title: "7. Service operation and changes", body: "Axora may maintain, secure, update, suspend, or change platform functions to protect users, data, and service integrity. Availability can be affected by maintenance, communications networks, external providers, and events outside reasonable control. No unsupported uptime, savings, procurement outcome, delivery time, or regulatory certification is promised by this page." },
        { title: "8. Suspension, closure and retained records", body: "Access may be restricted or suspended when necessary for security, legal compliance, account administration, non-payment under an applicable agreement, or material misuse. Closing an account does not necessarily erase records that must remain for legitimate business, security, audit, dispute, recovery, or legal purposes." },
        { title: "9. Responsibility and limitations", body: "Each party remains responsible for matters within its control. To the extent permitted by applicable law and any governing written agreement, Axora is not responsible for indirect loss caused by unauthorized use, inaccurate user-provided information, third-party systems, or events outside reasonable control. Nothing here excludes a responsibility that cannot lawfully be excluded." },
        { title: "10. Privacy, updates and questions", body: "The Privacy Policy explains how information is handled. Axora may publish an updated version of these terms with a new effective date. Material contractual changes may also be communicated through the agreed business channel. Continued use after an update is subject to applicable law and any governing written agreement." },
      ],
      contactTitle: "Questions about these terms",
      contactBody: "Contact support@axora.management. Please do not send passwords, invitation links, payment evidence, or confidential procurement documents by public email or the Contact form.",
    },
    "privacy-policy": {
      eyebrow: "Legal",
      title: "Privacy Policy",
      intro: "This policy explains how Axora handles personal, contact, account, procurement, finance, delivery, and security information across the public website and platform.",
      effectiveLabel: "Effective",
      effectiveDate: "28 August 2026",
      versionLabel: "Version",
      version: "1.0",
      sections: [
        { title: "1. Scope", body: "This policy applies to public visitors, people who contact Axora, account holders, authorized company users, Axora operational users, and Delivery Agents when they use Axora services. A company may also provide its own privacy information to employees or representatives whose data it controls." },
        { title: "2. Information Axora handles", body: "Depending on how you use Axora, information may include your name, work contact details, profile preferences, company and branch association, permissions, requests, approvals, budgets, Company Wallet accounting entries, payments, invoices, uploaded or generated documents, delivery assignments, tracking status, Proof of Delivery, receipt information, support enquiries, security events, and audit history." },
        { title: "3. Sources and purposes", body: "Information comes from you, your organization, authorized Axora personnel, Delivery Agents, service providers, and the operation of the platform. It is used to create and secure accounts, provide procurement workflows, authorize actions, coordinate fulfilment and delivery, maintain business and accounting records, respond to enquiries, prevent abuse, investigate incidents, recover the service, and meet applicable obligations." },
        { title: "4. Public Contact enquiries", body: "The Contact form records the full name, email address, international phone number, message, chosen language, consent evidence, campaign metadata when present, timestamps, an idempotency key, Turnstile verification evidence, and keyed rate-limit fingerprints. It creates one internal notification for the configured contact recipient. It does not create a customer account, purchase, or hidden CRM lead." },
        { title: "5. Delivery, tracking and Proof of Delivery", body: "Delivery information can include assignment status, delivery times, reported quantities, handover details, authorized evidence images, and operational tracking data. Customer views are limited to customer-safe order and proof information. More sensitive telemetry and security evidence remain restricted to authorized operational purposes." },
        { title: "6. Sharing and service providers", body: "Information may be shared with authorized users of the relevant company, assigned Axora personnel, assigned Delivery Agents, and providers that support hosting, database, storage, email, security, document, and communications functions. Access is limited to the purpose and scope required. Axora does not publish private supplier information or one company's records to another company." },
        { title: "7. Security and access controls", body: "Axora uses server-side role, tenant, branch, assignment, and permission controls; secure account invitation and recovery processes; password hashing; audit records; rate limits; bot verification; private file authorization; and operational backup and recovery controls. No online service can guarantee absolute security, so suspected misuse should be reported promptly." },
        { title: "8. Retention and deletion", body: "Information is retained for as long as reasonably needed for the service, account administration, business records, security, audit, dispute handling, recovery, and applicable obligations. Different records may require different periods. Requests to delete or correct information are assessed against authorization, integrity, and record-preservation requirements; immutable financial or audit history is not rewritten merely because an account closes." },
        { title: "9. Choices and privacy requests", body: "You may update supported profile information in Axora. For access, correction, deletion, restriction, objection, or other privacy questions, contact Axora using the channel below. Axora may verify your identity and authority before acting, and an organization may need to handle requests concerning data it controls." },
        { title: "10. Cookies, updates and contact", body: "Axora uses necessary first-party browser storage for sessions, language, appearance, security, and supported visitor choices. The policy may be updated as the service changes; the effective date and version identify the current publication. Material contractual privacy changes may also be communicated through the relevant business channel." },
      ],
      contactTitle: "Privacy requests and questions",
      contactBody: "Email support@axora.management or use Contact Us. Do not include passwords, invitation links, payment evidence, or confidential procurement documents in a public enquiry.",
    },
  },
  ar: {
    "terms-and-conditions": {
      eyebrow: "قانوني", title: "الشروط والأحكام",
      intro: "توضح هذه الشروط قواعد الوصول إلى منصة أكسورا لمشتريات الأعمال وموقعها العام واستخدامهما.",
      effectiveLabel: "تاريخ السريان", effectiveDate: "28 أغسطس 2026", versionLabel: "الإصدار", version: "1.0",
      sections: [
        { title: "1. النطاق والموافقة", body: "تنطبق هذه الشروط عند زيارة موقع أكسورا العام أو إرسال استفسار أو تسجيل حساب أو استخدامه أو العمل نيابة عن شركة عبر المنصة. وقد تضيف اتفاقية مكتوبة بين شركتك وأكسورا شروطًا لخدمة معينة أو تستبدلها، وتكون لها الأولوية عند وجود تعارض صريح." },
        { title: "2. الحسابات والمستخدمون المخولون", body: "تستخدم حسابات الشركات من أشخاص خولتهم مؤسساتهم. يجب تقديم معلومات دقيقة وحماية وسائل الدخول واستخدام الحساب الشخصي فقط والإبلاغ سريعًا عن أي وصول مشتبه به. روابط الدعوة والاسترداد بيانات أمنية شخصية ومحدودة المدة ولا يجوز مشاركتها." },
        { title: "3. سجلات المشتريات والأعمال", body: "يمكن للمستخدم المخول إدارة الطلبات والاعتمادات وسجلات محفظة الشركة ومعلومات الدفع والفواتير والتسليم وإثبات التسليم والمستندات وفق دوره. ويتحمل المستخدم مسؤولية دقة ومشروعية ما يقدمه، ويُرجع إلى سجل سير العمل والصلاحيات والتدقيق لفهم حالة الإجراء." },
        { title: "4. محفظة الشركة والمعلومات المالية", body: "تختلف محفظة الشركة عن ميزانيات الفروع. تسجل المحفظة الإضافات والخصومات والاستردادات والتسويات المعترف بها في المنصة، بينما تمثل الميزانية حدًا للإنفاق. ولا يعد طلب إضافة رصيد غير المعتمد أموالًا مضافة. وتظل شروط الدفع أو التجارة المنفصلة المتفق عليها سارية." },
        { title: "5. الملفات والتسليم والإثبات", body: "يجوز رفع المستندات أو إنشاؤها وتسجيل أدلة التسليم لأغراض عمل مشروعة فقط. ولا يحل دليل مسؤول التوصيل وحده محل تأكيد استلام العميل المخول عندما يكون مطلوبًا. ويخضع الوصول إلى الإثبات والتتبع لضوابط الدور والشركة والفرع والإسناد." },
        { title: "6. الاستخدام المقبول", body: "يحظر إساءة استخدام أكسورا أو تجاوز الصلاحيات أو الوصول إلى سجلات شركة أخرى أو تعطيل الخدمة أو إدخال برمجيات ضارة أو انتحال الهوية أو تقديم محتوى غير مشروع أو مضلل أو انتهاك حقوق الآخرين." },
        { title: "7. تشغيل الخدمة وتغييرها", body: "يجوز لأكسورا صيانة وظائف المنصة أو تأمينها أو تحديثها أو تعليقها أو تغييرها لحماية المستخدمين والبيانات. وقد تتأثر الإتاحة بالصيانة والشبكات ومزودي الخدمات والظروف الخارجة عن السيطرة المعقولة. لا تتضمن هذه الصفحة وعدًا غير موثق بالتوافر أو التوفير أو نتائج الشراء أو أوقات التسليم أو الشهادات." },
        { title: "8. التعليق والإغلاق وحفظ السجلات", body: "قد يُقيد الوصول أو يُعلق لأسباب أمنية أو قانونية أو إدارية أو بسبب إساءة جوهرية أو عدم دفع وفق اتفاقية سارية. ولا يعني إغلاق الحساب بالضرورة حذف السجلات اللازمة للأعمال أو الأمن أو التدقيق أو النزاع أو الاسترداد أو الالتزامات النظامية." },
        { title: "9. المسؤولية والحدود", body: "يبقى كل طرف مسؤولًا عما يقع ضمن سيطرته. وبالقدر الذي يسمح به القانون والاتفاقية المكتوبة، لا تتحمل أكسورا الخسائر غير المباشرة الناتجة عن استخدام غير مخول أو معلومات غير دقيقة أو أنظمة خارجية أو أحداث خارجة عن السيطرة المعقولة. ولا تستبعد هذه الشروط مسؤولية لا يجوز استبعادها قانونًا." },
        { title: "10. الخصوصية والتحديثات", body: "توضح سياسة الخصوصية كيفية التعامل مع المعلومات. وقد تنشر أكسورا إصدارًا محدثًا بتاريخ سريان جديد، كما قد تُبلغ بالتغييرات التعاقدية الجوهرية عبر قناة العمل المتفق عليها." },
      ],
      contactTitle: "أسئلة حول الشروط", contactBody: "تواصل عبر support@axora.management. لا ترسل كلمات مرور أو روابط دعوة أو إثبات دفع أو مستندات مشتريات سرية عبر البريد العام أو نموذج التواصل.",
    },
    "privacy-policy": {
      eyebrow: "قانوني", title: "سياسة الخصوصية",
      intro: "توضح هذه السياسة كيفية تعامل أكسورا مع معلومات التواصل والحساب والمشتريات والمالية والتسليم والأمان عبر الموقع العام والمنصة.",
      effectiveLabel: "تاريخ السريان", effectiveDate: "28 أغسطس 2026", versionLabel: "الإصدار", version: "1.0",
      sections: [
        { title: "1. النطاق", body: "تنطبق السياسة على زوار الموقع ومن يتواصلون مع أكسورا وأصحاب الحسابات ومستخدمي الشركات المخولين وموظفي أكسورا التشغيليين ومسؤولي التوصيل. وقد تقدم الشركة إشعار خصوصية خاصًا لموظفيها أو ممثليها بشأن البيانات التي تتحكم بها." },
        { title: "2. المعلومات التي تعالجها أكسورا", body: "قد تشمل المعلومات الاسم وبيانات التواصل المهني وتفضيلات الملف الشخصي والارتباط بالشركة والفرع والصلاحيات والطلبات والاعتمادات والميزانيات وقيود محفظة الشركة والمدفوعات والفواتير والمستندات وأعمال التسليم وحالته وإثبات التسليم والاستلام والدعم وأحداث الأمان وسجل التدقيق." },
        { title: "3. المصادر والأغراض", body: "تأتي المعلومات منك أو من مؤسستك أو من موظفي أكسورا المخولين أو مسؤولي التوصيل أو مزودي الخدمة أو من تشغيل المنصة. وتستخدم لإنشاء الحسابات وتأمينها وتشغيل المشتريات وتفويض الإجراءات وتنسيق التجهيز والتسليم وحفظ السجلات والرد على الاستفسارات ومنع الإساءة والتحقيق والاسترداد والوفاء بالالتزامات السارية." },
        { title: "4. استفسارات التواصل العامة", body: "يسجل نموذج التواصل الاسم الكامل والبريد ورقم الهاتف الدولي والرسالة واللغة والموافقة وبيانات الحملة عند وجودها والتوقيت ومفتاح منع التكرار ودليل Turnstile وبصمات محددة المعدل. وينشئ إشعارًا داخليًا واحدًا للمستلم المضبوط، ولا ينشئ حساب عميل أو عملية شراء أو سجل عميل محتمل مخفي." },
        { title: "5. التسليم والتتبع وإثبات التسليم", body: "قد تشمل بيانات التسليم حالة الإسناد وأوقات التسليم والكميات المبلغ عنها وبيانات التسليم والأدلة المرئية المخولة والحالة التشغيلية للتتبع. تعرض واجهات العميل معلومات آمنة تخص الطلب والإثبات، بينما تظل بيانات القياس والأمان الأكثر حساسية مقيدة للأغراض التشغيلية المخولة." },
        { title: "6. المشاركة ومزودو الخدمة", body: "قد تشارك المعلومات مع المستخدمين المخولين في الشركة المعنية وموظفي أكسورا ومسؤولي التوصيل المسندين ومزودي الاستضافة وقواعد البيانات والتخزين والبريد والأمان والمستندات والاتصالات بحسب الحاجة. ولا تنشر أكسورا بيانات الموردين الخاصة أو سجلات شركة لشركة أخرى." },
        { title: "7. الأمان وضوابط الوصول", body: "تستخدم أكسورا صلاحيات من جانب الخادم حسب الدور والشركة والفرع والإسناد، وعمليات آمنة للدعوات والاسترداد، وتجزئة كلمات المرور، وسجلات التدقيق، وتحديد المعدل، والتحقق من الروبوت، وتفويض الملفات، والنسخ الاحتياطي والاسترداد. ولا يمكن ضمان الأمان المطلق لأي خدمة عبر الإنترنت." },
        { title: "8. الاحتفاظ والحذف", body: "تُحتفظ المعلومات للمدة المعقولة اللازمة للخدمة وإدارة الحساب وسجلات الأعمال والأمان والتدقيق والنزاعات والاسترداد والالتزامات السارية. وتختلف المدة باختلاف السجل. تُقيّم طلبات الحذف أو التصحيح مع متطلبات التفويض وسلامة السجل، ولا يُعاد تحرير السجل المالي أو التدقيقي غير القابل للتغيير لمجرد إغلاق الحساب." },
        { title: "9. الخيارات وطلبات الخصوصية", body: "يمكنك تحديث معلومات الملف المدعومة داخل أكسورا. ولطلبات الوصول أو التصحيح أو الحذف أو التقييد أو الاعتراض، تواصل مع أكسورا. وقد نتحقق من الهوية والصلاحية قبل التنفيذ، وقد تكون المؤسسة مسؤولة عن بعض البيانات التي تتحكم بها." },
        { title: "10. التخزين في المتصفح والتحديثات", body: "تستخدم أكسورا تخزينًا ضروريًا من الطرف الأول للجلسة واللغة والمظهر والأمان وخيارات الزائر المدعومة. وقد تتغير السياسة مع تطور الخدمة؛ يحدد تاريخ السريان والإصدار النسخة الحالية." },
      ],
      contactTitle: "طلبات الخصوصية والأسئلة", contactBody: "راسل support@axora.management أو استخدم صفحة التواصل. لا تضع كلمات مرور أو روابط دعوة أو إثبات دفع أو مستندات مشتريات سرية في استفسار عام.",
    },
  },
  ms: {
    "terms-and-conditions": {
      eyebrow: "Perundangan", title: "Terma & Syarat",
      intro: "Terma ini menerangkan peraturan untuk mengakses dan menggunakan platform perolehan perniagaan serta laman awam Axora.",
      effectiveLabel: "Berkuat kuasa", effectiveDate: "28 Ogos 2026", versionLabel: "Versi", version: "1.0",
      sections: [
        { title: "1. Skop dan penerimaan", body: "Terma ini terpakai apabila anda melawat laman awam Axora, menghantar pertanyaan, mendaftar atau menggunakan akaun, atau bertindak bagi pihak syarikat melalui platform. Perjanjian bertulis organisasi anda dengan Axora boleh menambah atau menggantikan terma untuk perkhidmatan tertentu dan diberi keutamaan apabila bercanggah secara nyata." },
        { title: "2. Akaun dan pengguna dibenarkan", body: "Akaun syarikat digunakan oleh orang yang diberi kuasa oleh organisasi mereka. Anda mesti memberikan maklumat tepat, melindungi kaedah akses, menggunakan akaun sendiri sahaja dan segera melaporkan akses yang disyaki. Pautan jemputan dan pemulihan ialah bukti keselamatan peribadi dan terhad masa yang tidak boleh dikongsi." },
        { title: "3. Rekod perolehan dan perniagaan", body: "Pengguna dibenarkan boleh mengurus permintaan, kelulusan, rekod Dompet Syarikat, maklumat bayaran dan invois, penghantaran, Bukti Penghantaran serta dokumen mengikut peranan. Pengguna bertanggungjawab atas ketepatan dan kesahan maklumat yang dihantar. Sejarah aliran kerja, kebenaran dan audit boleh digunakan untuk memahami keadaan tindakan." },
        { title: "4. Dompet Syarikat dan kewangan", body: "Dompet Syarikat dan bajet cawangan mempunyai tujuan berbeza. Catatan Dompet merekod kredit, debit, bayaran balik atau pelarasan yang diiktiraf platform; bajet ialah kawalan perbelanjaan. Permohonan tambah nilai yang belum diluluskan bukan dana yang telah dikreditkan. Terma pembayaran atau komersial berasingan terus terpakai." },
        { title: "5. Fail, penghantaran dan bukti", body: "Dokumen dan bukti penghantaran hanya boleh dimuat naik atau dijana untuk tujuan perniagaan yang sah. Bukti Ejen Penghantaran tidak dengan sendirinya menggantikan pengesahan penerimaan pelanggan yang dibenarkan jika diperlukan. Akses bukti dan penjejakan tertakluk kepada kawalan peranan, syarikat, cawangan dan tugasan." },
        { title: "6. Penggunaan yang boleh diterima", body: "Anda dilarang menyalahgunakan Axora, memintas kebenaran, mengakses rekod syarikat lain, mengganggu perkhidmatan, memasukkan kod hasad, menyamar, menghantar bahan menyalahi undang-undang atau mengelirukan, atau melanggar hak orang lain." },
        { title: "7. Operasi dan perubahan perkhidmatan", body: "Axora boleh menyelenggara, melindungi, mengemas kini, menggantung atau mengubah fungsi untuk melindungi pengguna, data dan integriti perkhidmatan. Ketersediaan boleh dipengaruhi penyelenggaraan, rangkaian, penyedia luar dan perkara di luar kawalan munasabah. Halaman ini tidak menjanjikan masa operasi, penjimatan, hasil perolehan, masa penghantaran atau pensijilan yang tidak disahkan." },
        { title: "8. Penggantungan, penutupan dan rekod", body: "Akses boleh dihadkan atau digantung untuk keselamatan, pematuhan, pentadbiran akaun, kegagalan membayar di bawah perjanjian atau penyalahgunaan ketara. Penutupan akaun tidak semestinya memadam rekod yang perlu disimpan untuk perniagaan, keselamatan, audit, pertikaian, pemulihan atau kewajipan yang berkenaan." },
        { title: "9. Tanggungjawab dan had", body: "Setiap pihak bertanggungjawab atas perkara dalam kawalannya. Setakat yang dibenarkan undang-undang dan perjanjian bertulis, Axora tidak bertanggungjawab atas kerugian tidak langsung akibat penggunaan tanpa kebenaran, maklumat pengguna yang tidak tepat, sistem pihak ketiga atau kejadian di luar kawalan munasabah. Tiada tanggungjawab yang tidak boleh dikecualikan secara sah diketepikan." },
        { title: "10. Privasi dan kemas kini", body: "Dasar Privasi menerangkan pengendalian maklumat. Axora boleh menerbitkan versi baharu dengan tarikh kuat kuasa baharu dan boleh menyampaikan perubahan kontrak penting melalui saluran perniagaan yang dipersetujui." },
      ],
      contactTitle: "Soalan mengenai terma", contactBody: "Hubungi support@axora.management. Jangan hantar kata laluan, pautan jemputan, bukti bayaran atau dokumen perolehan sulit melalui e-mel awam atau borang Hubungi Kami.",
    },
    "privacy-policy": {
      eyebrow: "Perundangan", title: "Dasar Privasi",
      intro: "Dasar ini menerangkan cara Axora mengendalikan maklumat hubungan, akaun, perolehan, kewangan, penghantaran dan keselamatan di laman awam dan platform.",
      effectiveLabel: "Berkuat kuasa", effectiveDate: "28 Ogos 2026", versionLabel: "Versi", version: "1.0",
      sections: [
        { title: "1. Skop", body: "Dasar ini terpakai kepada pelawat awam, orang yang menghubungi Axora, pemegang akaun, pengguna syarikat dibenarkan, pengguna operasi Axora dan Ejen Penghantaran. Syarikat juga boleh memberikan notis privasi sendiri kepada pekerja atau wakil bagi data yang dikawalnya." },
        { title: "2. Maklumat yang dikendalikan", body: "Maklumat mungkin merangkumi nama, butiran hubungan kerja, pilihan profil, kaitan syarikat dan cawangan, kebenaran, permintaan, kelulusan, bajet, catatan Dompet Syarikat, bayaran, invois, dokumen, tugasan dan status penghantaran, Bukti Penghantaran, penerimaan, sokongan, peristiwa keselamatan dan sejarah audit." },
        { title: "3. Sumber dan tujuan", body: "Maklumat datang daripada anda, organisasi anda, kakitangan Axora dibenarkan, Ejen Penghantaran, penyedia perkhidmatan dan operasi platform. Ia digunakan untuk mewujudkan dan melindungi akaun, menyediakan aliran perolehan, membenarkan tindakan, menyelaras pemenuhan dan penghantaran, mengekalkan rekod, menjawab pertanyaan, mencegah penyalahgunaan, menyiasat insiden, memulihkan perkhidmatan dan memenuhi kewajipan." },
        { title: "4. Pertanyaan Hubungi Kami", body: "Borang merekod nama penuh, alamat e-mel, nombor telefon antarabangsa, mesej, bahasa, bukti persetujuan, metadata kempen jika ada, cap masa, kunci idempotensi, bukti Turnstile dan cap jari kadar berasaskan kunci. Ia menghasilkan satu pemberitahuan dalaman kepada penerima yang dikonfigurasi dan tidak mewujudkan akaun pelanggan, pembelian atau rekod prospek CRM tersembunyi." },
        { title: "5. Penghantaran, penjejakan dan bukti", body: "Maklumat penghantaran boleh merangkumi status tugasan, masa, kuantiti dilaporkan, butiran serahan, imej bukti dibenarkan dan status penjejakan operasi. Paparan pelanggan dihadkan kepada maklumat pesanan dan bukti yang selamat, manakala telemetri dan bukti keselamatan lebih sensitif dihadkan kepada tujuan operasi dibenarkan." },
        { title: "6. Perkongsian dan penyedia", body: "Maklumat boleh dikongsi dengan pengguna syarikat berkaitan yang dibenarkan, kakitangan Axora, Ejen Penghantaran ditugaskan dan penyedia bagi pengehosan, pangkalan data, storan, e-mel, keselamatan, dokumen dan komunikasi mengikut keperluan. Axora tidak menerbitkan maklumat pembekal persendirian atau rekod satu syarikat kepada syarikat lain." },
        { title: "7. Keselamatan dan kawalan akses", body: "Axora menggunakan kawalan sebelah pelayan mengikut peranan, penyewa, cawangan, tugasan dan kebenaran; proses jemputan dan pemulihan selamat; pencincangan kata laluan; audit; had kadar; pengesahan bot; kebenaran fail peribadi; serta sandaran dan pemulihan operasi. Tiada perkhidmatan dalam talian boleh menjamin keselamatan mutlak." },
        { title: "8. Penyimpanan dan pemadaman", body: "Maklumat disimpan selama yang munasabah bagi perkhidmatan, pentadbiran akaun, rekod perniagaan, keselamatan, audit, pertikaian, pemulihan dan kewajipan berkenaan. Tempoh berbeza mengikut rekod. Permintaan pemadaman atau pembetulan dinilai bersama keperluan kebenaran dan integriti; sejarah kewangan atau audit tidak boleh diubah semata-mata kerana akaun ditutup." },
        { title: "9. Pilihan dan permintaan privasi", body: "Anda boleh mengemas kini maklumat profil yang disokong dalam Axora. Untuk akses, pembetulan, pemadaman, sekatan, bantahan atau soalan privasi, hubungi Axora. Identiti dan kuasa anda mungkin disahkan, dan organisasi mungkin perlu mengendalikan permintaan bagi data yang dikawalnya." },
        { title: "10. Storan pelayar dan kemas kini", body: "Axora menggunakan storan pihak pertama yang diperlukan untuk sesi, bahasa, penampilan, keselamatan dan pilihan pelawat disokong. Dasar boleh berubah apabila perkhidmatan berkembang; tarikh kuat kuasa dan versi mengenal pasti penerbitan semasa." },
      ],
      contactTitle: "Permintaan dan soalan privasi", contactBody: "E-mel support@axora.management atau gunakan Hubungi Kami. Jangan masukkan kata laluan, pautan jemputan, bukti bayaran atau dokumen perolehan sulit dalam pertanyaan awam.",
    },
  },
};

export function legalPageContent(locale: SupportedLocale, kind: LegalPageKind) {
  return pages[locale][kind];
}
