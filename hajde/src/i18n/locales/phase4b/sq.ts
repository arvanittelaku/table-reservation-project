export const chat = {
  title: 'Biseda e tavolinës',
  autoTranslate: 'Përkthim automatik',
  loading: 'Duke ngarkuar bisedën…',
  empty: 'Ende heshtje… thuaj diçka të parën!',
  translating: 'Duke përkthyer...',
  translateBtn: 'Përkthe',
  inputPlaceholder: 'Shkruaj mesazh…',
  translateOwnTitle: 'Përktheje mesazhin tënd',
  translateAriaLabel: 'Përktheje mesazhin tënd',
  sendAria: 'Dërgo',
  icebreakerTitle: 'Merr një pyetje për fillim bisede',
  icebreakerAria: 'Pyetje për fillim bisede',
  lockedMessage: 'Biseda hapet pasi të aprovohesh dhe ta konfirmosh vendin.',
}

export const profile = {
  close: 'Mbyll',
  tablesHeld: '{{count}} tavolina të mbajtura',
  reportUser: 'Raporto',
  blockUser: 'Blloko përdoruesin',
  changePassword: 'Ndrysho fjalëkalimin',
  myReports: 'Raportimet e mia',
  blockedUsers: 'Përdoruesit e bllokuar',
  signOut: 'Dil nga llogaria',
  deactivateAccount: 'Çaktivizo llogarinë përgjithmonë',
  faceVerificationNotice:
    'Fotoja e çdo profili kalon kontrollin e fytyrës gjatë regjistrimit. Foto të zeza, të njëtrajtshme apo pa fytyrë reale nuk pranohen.',
  confirmSignOut: 'A dëshiron të dalësh?',
  confirmDeactivate:
    'Llogaria jote do të çaktivizohet PËRGJITHMONË. Nuk do të mund ta riaktivizosh më. Nëse dëshiron të përdorësh ejaBashkohu përsëri, do të duhet të krijosh një llogari të re. Vazhdo?',
  confirmDeactivateSecond: 'Je i sigurt? Ky veprim nuk mund të zhbëhet.',
  signOutSuccessToast: 'U dole nga llogaria',
  deactivateSuccessToast: 'Llogaria u çaktivizua',
  deactivateFailedToast: 'Dështoi. Provo sërish',
}

export const changePasswordScreen = {
  title: 'Ndrysho fjalëkalimin',
  currentPasswordLabel: 'Fjalëkalimi aktual',
  newPasswordLabel: 'Fjalëkalimi i ri',
  confirmPasswordLabel: 'Përsërit fjalëkalimin e ri',
  changingText: 'Duke ndryshuar…',
  submitBtn: 'Ruaj fjalëkalimin e ri',
  successToast: 'Fjalëkalimi u ndryshua me sukses',
  wrongCurrentToast: 'Fjalëkalimi aktual është gabim',
  mismatchToast: 'Fjalëkalimet nuk përputhen',
  minLengthToast: 'Fjalëkalimi duhet të ketë të paktën 6 karaktere',
  failedToast: 'Dështoi — provo sërish',
}

export const myReportsScreen = {
  title: 'Raportimet e mia',
  loading: 'Duke ngarkuar...',
  emptyState: "S'ke bërë asnjë raportim ende.",
  defaultUserName: 'Përdorues',
  statusPending: 'Në shqyrtim',
  statusBanned: 'U mor veprim',
  statusDismissed: 'U refuzua',
  statusDeleted: 'U fshi llogaria',
}

export const blockedUsersScreen = {
  title: 'Përdoruesit e bllokuar',
  loading: 'Duke ngarkuar...',
  emptyState: "S'ke bllokuar askënd ende.",
  unblockBtn: 'Zhblloko',
  blockedOnLabel: 'Bllokuar më {{date}}',
  confirmUnblock: 'Ta zhbllokosh këtë user? Do të mund të shohësh tavolinat e tij përsëri.',
  unblockSuccessToast: 'U zhbllokua',
  unblockFailedToast: 'Dështoi. Provo sërish',
}

export const reportBlockSheet = {
  reportTitle: 'Raporto',
  reasonLabel: 'Arsyeja e raportimit',
  submitReport: 'Dërgo raportin',
  blockUserBtn: 'Blloko përdoruesin',
  postReportPrompt:
    'Gjithashtu dëshiron ta bllokosh {{name}}? Tavolinat e tij nuk do të shfaqen më te ti.',
  blockAlsoCheckbox: "Blloko gjithashtu. S'do t'i shoh më tavolinat e {{name}}",
  blockWithoutReport: 'Blloko pa raportuar',
  anonymityNote:
    'Raportimi është anonim, {{name}} nuk e merr vesh kush e dërgoi. Ekipi i sigurisë përgjigjet brenda 24 orësh.',
  reportSentTitle: 'Raporti u dërgua',
  postReportNoThanks: 'Jo, faleminderit',
  confirmBlock: 'A dëshiron ta bllokosh {{name}}? Tavolinat e tij nuk do të shfaqen më te ti.',
  blockSuccessToast: 'Ke bllokuar këtë user. Tavolinat e tij nuk do të shfaqen më te ti.',
  blockFailedToast: 'Bllokimi dështoi. Provo sërish',
  reportSuccessToast: 'Raporti u dërgua',
  reportSuccessAndBlockedToast: 'U raportua dhe u bllokua',
  reportFailedToast: 'Raporti nuk u dërgua. Provo sërish',
  reportMissingProfileToast: 'Raporti nuk u dërgua. Mungon profili',
  reasons: {
    inappropriate: 'Sjellje e papërshtatshme',
    fake_profile: 'Profil i rremë ose foto e huaj',
    spam: 'Spam / reklamë',
    no_show: 'Nuk erdhi në takim',
    other: 'Tjetër',
  },
}

export const passwordInput = {
  show: 'Shfaq fjalëkalimin',
  hide: 'Fshih fjalëkalimin',
}
