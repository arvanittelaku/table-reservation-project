/** Phase 7 — Admin panel + legal pages (EN) */
export const admin = {
  title: 'Admin',
  subtitle: 'Security and analytics panel',
  accessDenied: 'Access denied',
  viewAsNormalUser: 'View as normal user →',
  backToAdmin: '← Back to Admin',
  tabs: { stats: 'Statistics', reports: 'Reports', bans: 'Bans' },
  range: { day: 'Day', month: 'Month', year: 'Year' },
  rangePeriod: {
    day: 'Last 30 days',
    month: 'Last 12 months',
    year: 'Last 5 years',
  },
  statsMeta: 'Charts: {{period}} · total cards are all-time',
  chartNoData: 'No data for this period.',
  loadingStats: 'Loading statistics',
  loadingReports: 'Loading reports…',
  loadingBans: 'Loading bans…',
  statsLoadFailed: 'Failed to load statistics',
  reportsLoadFailed: 'Failed to load reports',
  bansLoadFailed: 'Failed to load ban list',
  totals: {
    totalUsers: 'Total users',
    totalTables: 'Total tables',
    activeTables: 'Active tables',
    memberships: 'Memberships',
    pendingReports: 'Pending reports',
    bannedUsers: 'Banned users',
  },
  charts: {
    newUsers: 'New users',
    tablesOpened: 'Tables opened',
    memberships: 'New memberships',
  },
  reportFilters: {
    pending: 'Pending',
    reviewed_banned: 'Banned',
    reviewed_dismissed: 'Dismissed',
    deleted_immediately: 'Deleted',
  },
  reportsEmpty: 'No reports in this category.',
  tableLabel: 'Table',
  banBtn: 'Ban',
  dismissBtn: 'Dismiss',
  deleteImmediatelyBtn: 'Delete immediately',
  deleteConfirm: 'This permanently deletes the account. Continue?',
  toastReportDismissed: 'Report dismissed',
  toastUserBanned: 'User banned ({{count}}/3)',
  toastAccountDeleted: 'Account deleted',
  toastFailed: 'Failed',
  bansEmpty: 'No bans recorded.',
  banCountOne: '{{count}} ban',
  banCountMany: '{{count}} bans',
}

export const termsOfService = {
  back: 'Back',
  title: 'Terms of Service',
  effectiveDate: 'Effective: August 2026',
  section1Title: '1. Acceptance of terms',
  section1Body:
    'By registering on ejaBashkohu, you accept these terms. If you do not agree, please do not use the platform.',
  section2Title: '2. Who may use the platform',
  section2Items: [
    'You must be at least 18 years old',
    'You must provide accurate information during registration',
    'You must upload your real photo. Fake photos lead to account suspension',
    'Your account is personal and may not be shared',
  ],
  section3Title: '3. How the platform works',
  section3Body1:
    'ejaBashkohu is a social platform for organizing meetups. We do not organize meetups ourselves. Hosts and guests are responsible for them.',
  section3Body2:
    'The €2.00 fee is a reservation charge that confirms your commitment to attend. It is non-refundable once paid.',
  section3Body3:
    'Rides are completely free. The platform does not mediate payments between drivers and passengers.',
  section4Title: '4. Acceptable conduct',
  section4Intro: 'The following are prohibited:',
  section4Items: [
    'Fake profiles or photos of other people',
    'Abusive, harassing, or discriminatory behavior',
    'Offering commercial services without permission',
    'Spam or unsolicited messages',
    'Violating other members’ privacy',
    'Any illegal activity',
  ],
  section5Title: '5. Safety and reporting',
  section5Body1:
    'If you feel unsafe or see inappropriate behavior, report it immediately through the app or contact us. Our team reviews every report within 24 hours.',
  section5Body2:
    'We reserve the right to suspend any account that violates these terms without prior notice.',
  section6Title: '6. Refund policy',
  section6Body:
    'The €2.00 reservation fee is non-refundable once you confirm attendance, even if you cancel the meetup. This policy exists to ensure all participants are serious.',
  section7Title: '7. Limitation of liability',
  section7Intro: 'ejaBashkohu is an intermediary platform. We are not responsible for:',
  section7Items: [
    'Members’ behavior at in-person meetups',
    'Quality of tables organized by hosts',
    'Damage caused during shared rides',
    'Disputes between members',
  ],
  section7Body:
    'We always recommend telling someone you trust before attending any meetup.',
  section8Title: '8. Governing law',
  section8Body:
    'These terms are governed by the laws of Kosovo. Any dispute is resolved in the courts of Pristina.',
  section9Title: '9. Contact',
  section9Body: 'hello@ejabashkohu.app',
}

export const privacyPolicy = {
  back: 'Back',
  title: 'Privacy Policy',
  effectiveDate: 'Effective: August 2026',
  section1Title: '1. Who we are',
  section1Body1:
    'ejaBashkohu is a social platform created for residents and visitors of Kosovo. We operate from Pristina, Kosovo.',
  section1Body2: 'Contact email: hello@ejabashkohu.app',
  section2Title: '2. What data we collect',
  section2Items: [
    'First and last name',
    'Email address',
    'Age (we only verify that you are 18+)',
    'Profile photo',
    'City of residence',
    'Activity preferences (taste profile)',
    'Messages sent within the platform',
    'Tables you have joined',
  ],
  section3Title: '3. How we use data',
  section3Items: [
    'To connect you with people who share similar interests',
    'To send you notifications about your tables',
    'To personalize table recommendations',
    'For community safety (reporting and blocking)',
  ],
  section3Body: 'We never sell your data to anyone. Ever.',
  section4Title: '4. Profile photo',
  section4Body1:
    'Your photo is stored securely and is visible only to hosts when you request to join their table. It is never published or shared with third parties.',
  section4Body2:
    'Every photo passes automatic face verification. Fake photos or photos without a human face are not accepted.',
  section5Title: '5. Payments',
  section5Body:
    'Bank card data is never stored on our servers. Payments are processed by certified providers. We only store transaction confirmation and ticket code.',
  section6Title: '6. Your rights',
  section6Items: [
    'Right of access — you may request all your data',
    'Right to erasure — you may delete your account and data',
    'Right to rectification — you may change your data',
    'Right to data portability — you may export your data',
  ],
  section6Body: 'To exercise these rights, email: hello@ejabashkohu.app',
  section7Title: '7. Data security',
  section7Items: [
    'All data is transmitted with TLS encryption',
    'Data is stored with AES-256 encryption',
    'Daily backups',
    'Access controlled with row-level security (RLS) policies',
    'Passwords stored as hashes only — no one can read them',
  ],
  section8Title: '8. Data retention',
  section8Body:
    'We keep your data while your account is active. After closure, we delete data within 30 days, except where we are legally required to retain it.',
  section9Title: '9. Policy changes',
  section9Body:
    'If we change this policy, we notify you by email at least 14 days before it takes effect.',
  section10Title: '10. Contact',
  section10Body: 'For any questions: hello@ejabashkohu.app',
}
