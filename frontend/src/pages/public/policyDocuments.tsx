import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type PolicySection = {
  id: string;
  title: string;
  paragraphs?: ReactNode[];
  items?: ReactNode[];
  note?: ReactNode;
};

export type PlatformPolicyDocument = {
  title: string;
  shortTitle: string;
  path: `/${string}`;
  summary: string;
  effectiveDate: string;
  lastUpdated: string;
  sections: readonly PolicySection[];
};

const publicationDate = "29 September 2026";

export const platformPolicyDocuments: readonly PlatformPolicyDocument[] = [
  {
    title: "GETFIT4U Terms & Conditions",
    shortTitle: "Terms & Conditions",
    path: "/terms-and-conditions",
    summary:
      "The rules that apply when members, gym owners, trainers, staff, and visitors use the GETFIT4U platform.",
    effectiveDate: publicationDate,
    lastUpdated: publicationDate,
    sections: [
      {
        id: "acceptance",
        title: "1. Acceptance and scope",
        paragraphs: [
          <>
            These Terms &amp; Conditions (the <strong>Terms</strong>) govern access to and use of the
            GETFIT4U website, applications, and related services (together, the <strong>Platform</strong>).
            In these Terms, <strong>GETFIT4U</strong>, <strong>we</strong>, <strong>us</strong>, and
            <strong> our</strong> mean the operator of the Platform.
          </>,
          "By creating an account, accepting these Terms, or using the Platform, you agree to these Terms. If you use GETFIT4U for a gym or other organisation, you confirm that you are authorised to bind that organisation. If you do not agree, do not use the Platform.",
          <>
            These Terms apply to the Platform. A gym may publish separate membership, safety, cancellation,
            or house rules. Those gym-specific terms apply to services delivered by that gym and do not replace
            these Terms. Our <Link to="/privacy-policy">Privacy Policy</Link> and applicable notices form part
            of your relationship with GETFIT4U.
          </>,
        ],
      },
      {
        id: "eligibility",
        title: "2. Eligibility and accounts",
        paragraphs: [
          "You must be legally capable of entering into these Terms. If applicable law requires a parent or guardian to authorise a minor's use, that authorisation must be obtained before the minor uses the Platform.",
          "You must provide accurate, current information, keep it updated, protect your password and verification codes, and promptly report suspected unauthorised access. You are responsible for activity performed through your account unless applicable law provides otherwise.",
        ],
        items: [
          "Do not share passwords, one-time codes, payment credentials, or authenticated sessions.",
          "Do not create an account for another person without their authority.",
          "Use only the roles and gym workspaces that you are authorised to access.",
          "Tell us promptly if your account, phone, or email may have been compromised.",
        ],
      },
      {
        id: "roles",
        title: "3. Roles, gyms, and authority",
        paragraphs: [
          "GETFIT4U supports members, trainers, gym owners, gym staff, and platform administrators. Features and access depend on the active role and the permissions assigned to it.",
          "Gym owners and authorised staff are responsible for the accuracy of their gym profile, plans, pricing, trainer information, schedules, membership decisions, offline payment records, and operational rules. They may access only data belonging to gyms they are authorised to manage.",
          "Gyms and trainers are independent providers unless GETFIT4U expressly states otherwise. GETFIT4U provides platform technology and does not employ, supervise, certify, or guarantee every listed gym or trainer.",
        ],
      },
      {
        id: "memberships",
        title: "4. Memberships, classes, and attendance",
        paragraphs: [
          "Plan price, duration, joining fee, benefits, trial terms, eligibility, renewal rules, freeze rules, and cancellation conditions are shown during the relevant flow or supplied by the gym. Review them before joining or paying.",
          "Membership status may include pending, active, frozen, expired, cancelled, or deactivated. Status changes must follow the gym's configured rules and applicable law. Freezing or reactivating a membership may adjust validity dates according to the applicable plan or gym policy.",
          "Class reservations and attendance are subject to availability, gym opening times, membership eligibility, duplicate-check-in controls, and other displayed rules. A gym QR code is an attendance credential, not proof of identity or an unconditional right to enter. You must not copy, alter, share, or misuse QR credentials.",
        ],
      },
      {
        id: "payments",
        title: "5. Payments, subscriptions, and billing",
        paragraphs: [
          "Prices, taxes, fees, billing periods, renewal information, and accepted payment methods are displayed before payment where applicable. Online payments may be processed by a payment provider; offline payments may be collected and recorded by the gym.",
          "You authorise the applicable payment provider to process the payment information you submit. GETFIT4U does not require you to disclose a card PIN, UPI PIN, password, or one-time payment code to support personnel.",
          <>
            Refunds, reversals, failed or duplicate payments, and cancellations are handled under our
            <Link to="/refund-cancellation-policy"> Refund &amp; Cancellation Policy</Link>, the relevant
            gym terms, provider rules, and applicable law. A pending payment or confirmation screen is not
            final proof of settlement.
          </>,
        ],
      },
      {
        id: "communications",
        title: "6. Messages and notifications",
        paragraphs: [
          "The Platform may send account, security, membership, attendance, class, payment, support, and service communications through in-app messages, push notifications, email, SMS, or WhatsApp where configured and permitted.",
          "Some transactional messages are necessary to operate your account. Marketing messages are sent only where permitted, and you may use the available preference or opt-out method. Opting out of marketing does not stop essential account or transaction notices.",
          "Messages between users, gyms, trainers, and support must be lawful and respectful. Do not send spam, threats, harassment, unlawful content, malware, deceptive offers, or another person's confidential information without authority.",
        ],
      },
      {
        id: "content",
        title: "7. User content, reviews, and media",
        paragraphs: [
          "You retain ownership of content you lawfully submit, such as profile details, posts, reviews, messages, photographs, and documents. You grant GETFIT4U a limited, non-exclusive licence to host, process, reproduce, display, transmit, and adapt that content only as reasonably necessary to operate, secure, improve, and provide the Platform.",
          "You must have the rights and permissions needed for content you submit. Reviews must reflect genuine experiences and must not be manipulated, defamatory, discriminatory, fraudulent, or posted in exchange for an undisclosed benefit.",
          "We may restrict or remove content where reasonably necessary to enforce these Terms, comply with law, protect users, investigate abuse, or maintain Platform integrity. Moderation does not make GETFIT4U responsible for all user content.",
        ],
      },
      {
        id: "acceptable-use",
        title: "8. Acceptable use",
        items: [
          "Do not access data, accounts, cameras, APIs, or gym workspaces without authorisation.",
          "Do not scrape, reverse engineer, probe, overload, disrupt, or bypass Platform security or rate limits except where applicable law expressly permits.",
          "Do not falsify attendance, payment, membership, review, identity, location, or verification information.",
          "Do not upload malicious code, illegal material, or content that infringes intellectual-property, privacy, publicity, or other rights.",
          "Do not use the Platform to harm, exploit, stalk, discriminate against, or harass another person.",
          "Do not resell, impersonate, or misrepresent GETFIT4U services or use GETFIT4U branding without permission.",
        ],
      },
      {
        id: "health-safety",
        title: "9. Health and safety",
        paragraphs: [
          "GETFIT4U is a gym-management and discovery platform, not a medical service. Workout, nutrition, fitness, trainer, and gym information is general information and is not a diagnosis or medical advice.",
          "Exercise involves risk. Consider your health, ability, equipment, environment, and professional medical advice before starting or changing an exercise programme. Follow gym safety rules and stop activity if you feel unwell. In an emergency, contact local emergency services.",
        ],
      },
      {
        id: "third-parties",
        title: "10. Third-party services",
        paragraphs: [
          "The Platform may connect to mapping, identity, payment, storage, messaging, analytics, notification, and communication providers. Their services may be governed by their own terms and privacy notices. GETFIT4U is not responsible for an external service outside its reasonable control.",
          "Links to third-party websites or services do not imply endorsement. You are responsible for reviewing external terms before using them.",
        ],
      },
      {
        id: "availability",
        title: "11. Availability, changes, and security",
        paragraphs: [
          "We work to keep GETFIT4U available, accurate, and secure, but no online service is uninterrupted or error-free. Features may be changed, suspended, limited, or discontinued for maintenance, security, legal, operational, or product reasons.",
          "To the extent permitted by law, the Platform is provided on an 'as available' basis. We do not guarantee a particular gym result, fitness outcome, trainer performance, membership approval, revenue result, or uninterrupted third-party service.",
        ],
      },
      {
        id: "suspension",
        title: "12. Suspension and termination",
        paragraphs: [
          "You may stop using the Platform at any time. Account closure and data deletion are separate from cancelling a gym membership or platform subscription. Follow the applicable cancellation process before closing an account.",
          "We may restrict, suspend, or terminate access where reasonably necessary for security, fraud prevention, non-payment, serious or repeated breach, legal compliance, risk to users, or protection of the Platform. Where appropriate and lawful, we will provide notice or an opportunity to remedy the issue.",
          "Terms that by their nature should continue—including payment obligations, ownership, lawful record retention, disclaimers, and dispute provisions—survive termination.",
        ],
      },
      {
        id: "liability-law",
        title: "13. Liability and applicable law",
        paragraphs: [
          "Nothing in these Terms excludes or limits liability, remedies, warranties, or consumer rights that cannot lawfully be excluded or limited. Subject to that rule, each party is responsible for loss it causes through its breach, negligence, fraud, wilful misconduct, or violation of law.",
          "GETFIT4U is not responsible for indirect or consequential loss that was not reasonably foreseeable, or for loss caused solely by a gym, trainer, user, network, device, payment provider, or other third party outside GETFIT4U's reasonable control.",
          "These Terms are governed by the applicable laws of India, without taking away any mandatory rights or forum available to you under applicable consumer or other law. The parties should first try to resolve concerns through support before starting formal proceedings.",
        ],
      },
      {
        id: "changes-contact",
        title: "14. Changes and contact",
        paragraphs: [
          "We may update these Terms to reflect service, legal, security, or operational changes. The current version will show its effective and last-updated dates. We will provide additional notice where required by law or where a change materially affects your rights.",
          <>
            Questions, complaints, or notices about these Terms can be submitted through the
            <Link to="/contact"> Contact page</Link>. Current support methods displayed there are the
            authoritative contact channels for GETFIT4U.
          </>,
        ],
      },
    ],
  },
  {
    title: "GETFIT4U Privacy Policy",
    shortTitle: "Privacy Policy",
    path: "/privacy-policy",
    summary:
      "How GETFIT4U collects, uses, shares, protects, retains, and deletes personal information across the app and website.",
    effectiveDate: publicationDate,
    lastUpdated: publicationDate,
    sections: [
      {
        id: "scope",
        title: "1. Scope and who we are",
        paragraphs: [
          "This Privacy Policy explains how the operator of GETFIT4U collects and processes personal information when you visit or use the GETFIT4U website, applications, communications, and related services (the Platform). It covers visitors, members, gym owners, gym staff, trainers, and people who contact support.",
          "A gym may separately collect or control information for its own services. For example, a gym may decide why it needs health declarations, facility-access records, or offline payment details. Review the gym's own privacy information where it acts independently from GETFIT4U.",
        ],
      },
      {
        id: "information",
        title: "2. Information we process",
        paragraphs: [
          "The information we process depends on how you use GETFIT4U. It may include:",
        ],
        items: [
          <><strong>Identity and account information:</strong> name, email address, phone number, profile image, date of birth, gender, account role, verification state, and account status.</>,
          <><strong>Fitness and profile information:</strong> height, weight, goals, interests, biography, location, timezone, emergency contact, and other details you choose to provide.</>,
          <><strong>Gym and professional information:</strong> gym ownership and staff records, trainer specialisation, experience, certifications, availability, business profile, facilities, schedules, and uploaded documents.</>,
          <><strong>Membership and activity information:</strong> plans, start and end dates, status changes, freezes and reactivations, class bookings, attendance, QR validation results, trainer assignments, and reviews.</>,
          <><strong>Payment and transaction information:</strong> price, amount, payment method category, provider transaction identifiers, status, invoices, refunds, collector, reference number, and notes. Payment providers process sensitive payment credentials; GETFIT4U support will never ask for your PIN, password, or one-time payment code.</>,
          <><strong>Content and communications:</strong> posts, stories, reviews, messages, support conversations, attachments, notification choices, marketing consent, and delivery/read status.</>,
          <><strong>Device, usage, and security information:</strong> IP-derived or coarse location, device and browser type, user agent, session and device identifiers, push tokens, timestamps, log and diagnostic events, security signals, and hashed or otherwise protected identifiers where used.</>,
          <><strong>Location, camera, and media:</strong> precise device location only when you grant permission for a location feature; camera access when you scan a gym QR or capture media; and images, video, or documents you choose to upload.</>,
        ],
      },
      {
        id: "sources",
        title: "3. Where information comes from",
        items: [
          "Directly from you when you register, complete a profile, join a gym, pay, scan a QR, communicate, post content, or contact support.",
          "From authorised gym owners, staff, trainers, and administrators when they manage legitimate Platform records.",
          "Automatically from your browser, device, session, and interactions with the Platform.",
          "From service providers such as identity, payment, mapping, storage, notification, and communication providers when they return transaction or delivery information.",
          "From other users when they send you a message, add authorised records, report content, or interact with your public or shared content.",
        ],
      },
      {
        id: "purposes",
        title: "4. Why we use information",
        items: [
          "Create, verify, secure, and administer accounts and role-based access.",
          "Display gyms, plans, trainers, classes, profiles, social content, and reviews.",
          "Create and manage memberships, subscriptions, payments, invoices, refunds, attendance, and bookings.",
          "Provide messaging, support, service announcements, and opted-in communications.",
          "Personalise settings such as theme, language, timezone, nearby gyms, and notification preferences.",
          "Detect fraud, unauthorised access, spam, duplicate check-ins, abuse, and security incidents.",
          "Debug, measure, maintain, and improve reliability, accessibility, performance, and product features.",
          "Comply with law, enforce our terms, resolve disputes, protect people and property, and keep required business records.",
        ],
        note: "We process information with your consent where required, to provide services you request, to comply with legal duties, to protect the Platform and its users, and on other grounds allowed by applicable law. You may withdraw consent for future processing where processing depends on consent, subject to legal and operational limits.",
      },
      {
        id: "sharing",
        title: "5. When information is shared",
        paragraphs: [
          "We do not sell your personal information. We share information only as reasonably necessary for the purposes described in this policy, subject to role permissions and contractual or legal safeguards where applicable.",
        ],
        items: [
          <><strong>Gyms, trainers, and members:</strong> information needed to deliver memberships, attendance, bookings, training, reviews, profiles, payments, and communications. Access is limited to the applicable relationship and role.</>,
          <><strong>Service providers:</strong> hosting and private object storage, media processing, authentication, email, SMS, push notifications, payments, maps/geocoding, analytics, security, support, and communication services.</>,
          <><strong>Payment and financial participants:</strong> payment gateways, banks, networks, and gyms where needed to process, reconcile, refund, or investigate a transaction.</>,
          <><strong>Legal and safety recipients:</strong> regulators, courts, law enforcement, professional advisers, or affected parties when disclosure is lawfully required or reasonably necessary to protect rights, safety, and security.</>,
          <><strong>Business changes:</strong> a buyer, successor, investor, or adviser in a proposed or completed merger, financing, reorganisation, or transfer, subject to confidentiality and applicable law.</>,
        ],
      },
      {
        id: "meta-whatsapp",
        title: "6. Meta and WhatsApp Business Platform data",
        paragraphs: [
          "Where enabled and permitted, GETFIT4U may use the WhatsApp Business Platform to send or receive support, verification, account, membership, payment, attendance, booking, and other service communications, as well as marketing communications where you have provided any consent required by law and platform rules.",
          "For those communications, GETFIT4U may process and transmit your phone number, display or account name, message content, template and campaign identifiers, timestamps, consent records, and delivery, read, failure, or reply status. Meta and WhatsApp process information under their own terms and privacy policies when providing the service.",
          "You can stop optional WhatsApp marketing through the opt-out method in the message or by contacting us. Blocking or opting out of WhatsApp may prevent delivery through that channel but does not cancel your GETFIT4U account or stop essential notices through other available channels.",
          <>
            Requests to delete information associated with GETFIT4U's Meta or WhatsApp integration can be
            submitted using our <Link to="/data-deletion">Data Deletion Instructions</Link>.
          </>,
        ],
      },
      {
        id: "device-permissions",
        title: "7. Device permissions and local storage",
        paragraphs: [
          "Camera, precise location, notification, and media permissions are requested only when a related feature needs them. You can change permissions in your browser or device settings, although the related feature may then stop working.",
          "GETFIT4U may use cookies, browser storage, or similar technologies for authentication, security, theme, navigation, installation preferences, and reliable operation. Session cookies and tokens should not be copied or shared. Browser controls can clear stored data, but doing so may sign you out or reset preferences.",
        ],
      },
      {
        id: "retention",
        title: "8. Retention",
        paragraphs: [
          "We keep personal information only for as long as reasonably necessary for the purpose for which it was collected, including providing an active account or membership, maintaining security, resolving disputes, preventing fraud, meeting legal, tax, accounting, and audit obligations, and enforcing agreements.",
          "Retention varies by record type and context. For example, an expired story may be removed sooner than payment, membership, consent, attendance, security, or audit records that must remain accurate or be retained by law. When information is no longer required, we delete it, anonymise it, or isolate it until secure deletion is practical.",
        ],
      },
      {
        id: "security-transfers",
        title: "9. Security and international processing",
        paragraphs: [
          "We use administrative, technical, and organisational safeguards designed to protect information, including role-based access, authentication controls, protected sessions, private media storage where configured, validation, logging, and transport encryption. No system can guarantee absolute security.",
          "Service providers may process information in India or other locations where they or their infrastructure operate. Where required, we use appropriate safeguards for cross-border processing and remain subject to applicable legal requirements.",
        ],
      },
      {
        id: "choices-rights",
        title: "10. Your choices and rights",
        paragraphs: [
          "Depending on applicable law and your relationship with GETFIT4U, you may have rights to access, correct, update, obtain, restrict, object to, withdraw consent for, or request deletion of personal information, and to raise a grievance or appeal a decision.",
          "Some information can be reviewed or updated in your profile and settings. You can manage optional notification permissions through the Platform or device settings. We may need to verify your identity and authority before acting on a request, and lawful exceptions may apply.",
          <>
            To request account or data deletion, follow the public
            <Link to="/data-deletion"> Data Deletion Instructions</Link>. For other privacy requests, use the
            <Link to="/contact"> Contact page</Link> and clearly describe the request.
          </>,
        ],
      },
      {
        id: "children",
        title: "11. Children's privacy",
        paragraphs: [
          "GETFIT4U is not intended for children to create or operate accounts independently where applicable law requires parental or guardian authorisation. A parent or guardian who believes a child provided personal information without required authorisation should contact us so we can investigate and take appropriate action.",
        ],
      },
      {
        id: "updates-contact",
        title: "12. Updates and contact",
        paragraphs: [
          "We may update this policy to reflect changes in the Platform, our practices, providers, or applicable requirements. We will update the date above and give additional notice where required. Previous policies will be retained where required by an applicable platform or law.",
          <>
            Privacy questions, grievances, and requests can be submitted through the
            <Link to="/contact"> Contact page</Link>. Do not send passwords, payment PINs, or one-time codes.
          </>,
        ],
      },
    ],
  },
  {
    title: "GETFIT4U Refund & Cancellation Policy",
    shortTitle: "Refund & Cancellation",
    path: "/refund-cancellation-policy",
    summary:
      "How cancellations, failed or duplicate payments, membership refunds, offline payments, and provider processing are handled.",
    effectiveDate: publicationDate,
    lastUpdated: publicationDate,
    sections: [
      {
        id: "scope",
        title: "1. Scope",
        paragraphs: [
          "This policy applies to payment, cancellation, refund, and reversal requests handled through GETFIT4U. It covers online gym-membership payments, supported platform subscription charges, and offline payments recorded by a gym.",
          "The gym's displayed plan and cancellation terms also apply to gym services. If those terms conflict with rights that cannot be excluded under applicable law, the mandatory legal rights prevail.",
        ],
      },
      {
        id: "before-paying",
        title: "2. Before paying",
        paragraphs: [
          "Review the gym, plan, amount, duration, start date, renewal terms, joining fee, benefits, trial terms, freeze rules, and cancellation conditions before confirming payment. Ask the gym or GETFIT4U support to clarify an unclear charge before paying.",
          "A promotion reduces the amount paid but does not create a refund greater than the amount actually received. Taxes, fees, discounts, and credits are handled according to the transaction record and applicable law.",
        ],
      },
      {
        id: "cancellation",
        title: "3. Membership and subscription cancellation",
        paragraphs: [
          "A request to cancel stops or changes future service only when it is accepted and recorded under the applicable plan, gym, or platform subscription rules. Cancelling an account, disabling notifications, not attending the gym, or removing the application does not by itself cancel a membership or recurring obligation.",
          "If a recurring payment is supported, cancel before the next billing event using the available account, gym, or support flow. A payment already submitted may still complete and must be handled as a separate refund request.",
          "Membership freeze and reactivation are not cancellations. They follow the plan's freeze rules and may change validity dates without producing a refund.",
        ],
      },
      {
        id: "eligibility",
        title: "4. Refund eligibility",
        paragraphs: [
          "A refund is assessed from the actual transaction, service status, gym or plan terms accepted at purchase, reason for the request, benefits already used, provider rules, and applicable law. Submitting a request does not guarantee approval.",
        ],
        items: [
          "A verified duplicate charge or payment collected after a confirmed cancellation may be eligible for reversal or refund.",
          "A payment that failed but was debited may be automatically reversed by the provider or bank; it is not charged again until its status is verified.",
          "A materially incorrect charge, unavailable purchased service, or transaction affected by a documented technical error will be investigated with the gym and provider.",
          "A change of mind, non-attendance, relocation, or unused time is not automatically refundable unless the applicable gym terms or law provide otherwise.",
          "A partially used plan may be non-refundable or refundable only in part, depending on the applicable terms and law.",
          "Fraudulent, abusive, or unsupported requests may be rejected after reasonable investigation.",
        ],
      },
      {
        id: "failed-pending",
        title: "5. Failed, pending, and duplicate online payments",
        paragraphs: [
          "Do not repeat a payment solely because a bank debit is not immediately reflected in GETFIT4U. First check the transaction status and contact support with the provider reference. We may reconcile the record with the payment provider.",
          "A failed or pending payment that was debited may be reversed automatically to the original source by the payment provider or financial institution. Processing time is controlled partly by those institutions. We will not mark a membership paid unless payment is verified or an authorised offline record is created.",
        ],
      },
      {
        id: "offline",
        title: "6. Offline payments",
        paragraphs: [
          "Cash, UPI, card/POS, bank transfer, or other offline payments may be collected directly by the gym and recorded in GETFIT4U. The collecting gym is responsible for the accuracy of the receipt, reference, amount, and refund decision for funds it collected, subject to applicable law.",
          "GETFIT4U can provide the Platform record and facilitate support but cannot directly reverse money it did not collect. Keep the gym receipt and payment reference when requesting help.",
        ],
      },
      {
        id: "process",
        title: "7. How to request cancellation or a refund",
        paragraphs: [
          <>
            Use the relevant membership, billing, gym-support, or support-conversation flow when available.
            Otherwise, submit a request through the <Link to="/contact">Contact page</Link>.
          </>,
          "Include your account email or phone, gym and plan, amount, payment date, transaction or receipt reference, requested outcome, and a short explanation. Do not send a card PIN, UPI PIN, password, full card number, or one-time code.",
          "We or the collecting gym may request reasonable evidence and identity verification. Requests are reviewed and answered within the period required by applicable law and as reasonably practicable for provider reconciliation.",
        ],
      },
      {
        id: "approved-refunds",
        title: "8. Approved refunds",
        paragraphs: [
          "Approved online refunds are normally sent to the original payment method through the payment provider unless law or provider rules require another method. GETFIT4U does not control the time a bank, card network, UPI provider, or wallet takes to post an approved refund.",
          "Approved offline refunds are issued by the gym that collected the money. Membership access, invoices, credits, promotions, and transaction status may be adjusted to reflect an approved cancellation, reversal, or refund.",
        ],
      },
      {
        id: "chargebacks",
        title: "9. Disputes and chargebacks",
        paragraphs: [
          "Contact support before starting a chargeback so the transaction can be identified and investigated. This does not take away any right to contact your bank or payment provider. Duplicate recovery—for example, receiving both a refund and a chargeback for the same amount—may be corrected.",
        ],
      },
      {
        id: "updates",
        title: "10. Updates and contact",
        paragraphs: [
          "We may update this policy when payment features, gym workflows, provider rules, or legal requirements change. The version that applies to a transaction will be determined by the terms shown or accepted for that transaction and any mandatory law.",
          <>
            Questions can be submitted through the <Link to="/contact">Contact page</Link>.
          </>,
        ],
      },
    ],
  },
  {
    title: "GETFIT4U Data Deletion Instructions",
    shortTitle: "Data Deletion",
    path: "/data-deletion",
    summary:
      "A public request path for deleting a GETFIT4U account and associated data, including data used with Meta or WhatsApp services.",
    effectiveDate: publicationDate,
    lastUpdated: publicationDate,
    sections: [
      {
        id: "request",
        title: "1. Submit a deletion request",
        paragraphs: [
          "You may ask GETFIT4U to delete your account and associated personal information. If you can sign in, open a support conversation from your account and use the subject 'Data deletion request'. This helps us securely associate the request with the correct account.",
          <>
            If you cannot sign in, use the public <Link to="/contact">Contact page</Link> and use the same
            subject. Include the name and email address or phone number linked to the account and say whether
            you want to delete the whole account or particular information.
          </>,
        ],
        note: "Never include your password, card or UPI PIN, full payment credentials, private key, access token, or one-time verification code in a deletion request.",
      },
      {
        id: "verification",
        title: "2. Identity verification",
        paragraphs: [
          "To protect accounts from unauthorised deletion, we must verify the requester's identity and, for a business-managed record, their authority. Verification may use the signed-in session, a confirmed email or phone, account details, or another proportionate method.",
          "If we cannot identify the account or verify the request, we will ask for the minimum additional information needed. We will not delete another person's account based only on an unverified message.",
        ],
      },
      {
        id: "process",
        title: "3. What happens next",
        items: [
          "We acknowledge and review the request through the support channel supplied.",
          "We identify data controlled by GETFIT4U and records controlled or collected independently by a gym or payment provider.",
          "We delete or de-identify eligible personal information from active systems and schedule removal from backups under our retention process.",
          "We notify you when the request is completed or explain any information that must be retained and the reason, where permitted.",
        ],
        note: "Requests are handled within the period required by applicable law. Complex, disputed, or insufficiently verified requests may require additional communication.",
      },
      {
        id: "scope",
        title: "4. Information deleted or de-identified",
        paragraphs: [
          "Subject to verification and lawful exceptions, deletion may include account and profile fields, optional fitness information, device and push tokens, uploaded profile media, social content, optional communication preferences, and other personal information no longer needed for a permitted purpose.",
          "Deleting the account may permanently remove access to memberships, messages, bookings, attendance views, invoices, gym or trainer workspaces, content, and other Platform features. Export or retain records you are entitled to keep before asking for deletion.",
        ],
      },
      {
        id: "retained",
        title: "5. Information that may be retained",
        paragraphs: [
          "Some information may be retained where necessary to comply with law, maintain accurate financial or tax records, document membership and attendance transactions, resolve disputes, enforce agreements, protect safety and security, prevent fraud, or preserve a gym's lawful business record.",
          "Retained data is limited to the relevant purpose, access is restricted, and it is removed or de-identified when the retention purpose ends. Information already anonymised so it can no longer reasonably identify you is not account data and may be retained.",
          "A gym, bank, payment provider, Meta, WhatsApp, Google, or other independent provider may hold information under its own policy. We will identify the appropriate recipient where the requested information is not controlled by GETFIT4U.",
        ],
      },
      {
        id: "meta",
        title: "6. Meta and WhatsApp data deletion",
        paragraphs: [
          "These instructions are GETFIT4U's public deletion path for information processed through a GETFIT4U Meta or WhatsApp Business Platform integration. In your request, say 'Meta/WhatsApp data deletion' and include the phone number or GETFIT4U account used for the interaction.",
          "After verification, we will delete or de-identify eligible message, consent, template, delivery, and account-linkage records under our control. Meta or WhatsApp may separately retain information under its own terms, security requirements, and legal obligations. You may also use the privacy and account controls Meta or WhatsApp provides directly.",
        ],
      },
      {
        id: "alternatives",
        title: "7. Alternatives and contact",
        paragraphs: [
          "If you want to correct data, stop optional marketing, disable notifications, revoke a device permission, cancel a membership, or close only a gym role, say so in the request. Those actions may solve the issue without deleting the entire account.",
          <>
            For questions or a deletion-status update, use the <Link to="/contact">Contact page</Link> and
            reference the existing support conversation. Review the <Link to="/privacy-policy">Privacy Policy</Link>
            for more information about processing, retention, sharing, and your rights.
          </>,
        ],
      },
    ],
  },
];

export const policyDocumentByPath = new Map(
  platformPolicyDocuments.map((document) => [document.path, document] as const),
);
