/** Phase 7 — Admin panel + legal pages (SQ source) */
export const admin = {
  title: 'Admin',
  subtitle: 'Paneli i sigurisë dhe statistikave',
  accessDenied: 'Nuk ke qasje',
  viewAsNormalUser: 'Shiko si përdorues normal →',
  backToAdmin: '← Kthehu te Admin',
  tabs: { stats: 'Statistika', reports: 'Raportet', bans: 'Bans' },
  range: { day: 'Ditë', month: 'Muaj', year: 'Vit' },
  rangePeriod: {
    day: '30 ditët e fundit',
    month: '12 muajt e fundit',
    year: '5 vitet e fundit',
  },
  statsMeta: 'Grafikët: {{period}} · kartat e totalit janë gjithë-kohës',
  chartNoData: "S'ka të dhëna për këtë periudhë.",
  loadingStats: 'Duke ngarkuar statistikat',
  loadingReports: 'Duke ngarkuar raportet…',
  loadingBans: 'Duke ngarkuar bllokimet…',
  statsLoadFailed: 'Statistikat nuk u ngarkuan',
  reportsLoadFailed: 'Raportet nuk u ngarkuan',
  bansLoadFailed: 'Lista e bllokimeve nuk u ngarkua',
  totals: {
    totalUsers: 'Përdorues gjithsej',
    totalTables: 'Tavolina gjithsej',
    activeTables: 'Tavolina aktive',
    memberships: 'Anëtarësime',
    pendingReports: 'Raportet në pritje',
    bannedUsers: 'Përdorues të bllokuar',
  },
  charts: {
    newUsers: 'Përdorues të rinj',
    tablesOpened: 'Tavolina të hapura',
    memberships: 'Anëtarësime të reja',
  },
  reportFilters: {
    pending: 'Në pritje',
    reviewed_banned: 'Të bllokuar',
    reviewed_dismissed: 'Të refuzuara',
    deleted_immediately: 'Të fshira',
  },
  reportsEmpty: "S'ka raporte në këtë kategori.",
  tableLabel: 'Tavolina',
  banBtn: 'Banoje',
  dismissBtn: 'Refuzo',
  deleteImmediatelyBtn: 'Fshi menjëherë',
  deleteConfirm: 'Kjo fshin llogarinë përgjithmonë. Vazhdo?',
  toastReportDismissed: 'Raporti u refuzua',
  toastUserBanned: 'Përdoruesi u bllokua ({{count}}/3)',
  toastAccountDeleted: 'Llogaria u fshi',
  toastFailed: 'Dështoi',
  bansEmpty: "S'ka bllokime të regjistruara.",
  banCountOne: '{{count}} bllokim',
  banCountMany: '{{count}} bllokime',
}

export const termsOfService = {
  back: 'Kthehu',
  title: 'Kushtet e Përdorimit',
  effectiveDate: 'Hyrë në fuqi: Gusht 2026',
  section1Title: '1. Pranimi i kushteve',
  section1Body:
    'Duke u regjistruar në ejaBashkohu, pranoni këto kushte. Nëse nuk pajtoheni, ju lutemi mos e përdorni platformën.',
  section2Title: '2. Kush mund të përdorë platformën',
  section2Items: [
    'Duhet të keni të paktën 18 vjeç',
    'Duhet të ofroni informacion të saktë gjatë regjistrimit',
    'Duhet të ngarkoni fotografinë tuaj reale. Fotografi të rreme çojnë në bllokimin e llogarisë',
    'Llogaria është personale dhe nuk mund të ndahet',
  ],
  section3Title: '3. Si funksionon platforma',
  section3Body1:
    'ejaBashkohu është platformë sociale për organizimin e takimeve. Ne nuk organizojmë vetë takimet. Kjo është përgjegjësi e nikoqirëve dhe mysafirëve.',
  section3Body2:
    'Pagesa prej 2.00 € është tarifë rezervimi që konfirmon seriozitetin e pjesëmarrjes. Nuk rimbursohet pasi paguhet.',
  section3Body3:
    'Vozitjet janë plotësisht falas. Platforma nuk ndërmjetëson pagesa mes shoferëve dhe pasagjerëve.',
  section4Title: '4. Sjellja e pranueshme',
  section4Intro: 'Janë të ndaluara:',
  section4Items: [
    'Profili i rremë ose fotografia e personit tjetër',
    'Sjellja abuzive, ngacmuese ose diskriminuese',
    'Ofrimi i shërbimeve komerciale pa leje',
    'Spam ose mesazhe të palicencuara',
    'Shkelja e privatësisë së anëtarëve të tjerë',
    'Çdo veprimtari e paligjshme',
  ],
  section5Title: '5. Siguria dhe raportimet',
  section5Body1:
    'Nëse ndiheni i pasigurt ose shihni sjellje të papërshtatshme, raportoni menjëherë përmes aplikacionit ose na shkruani. Ekipi ynë shqyrton çdo raport brenda 24 orësh.',
  section5Body2:
    'Ne rezervojmë të drejtën të bllokojmë çdo llogari që shkel këto kushte pa paralajmërim paraprak.',
  section6Title: '6. Politika e rimbursimit',
  section6Body:
    'Tarifa e rezervimit prej 2.00 € nuk rimbursohet pasi konfirmoni pjesëmarrjen, pavarësisht nëse anuloni takimin. Kjo politikë ekziston për të siguruar seriozitetin e të gjithë pjesëmarrësve.',
  section7Title: '7. Kufizimi i përgjegjësisë',
  section7Intro: 'ejaBashkohu është platformë ndërmjetëse. Nuk jemi përgjegjës për:',
  section7Items: [
    'Sjelljen e anëtarëve në takime fizike',
    'Cilësinë e tavolinave të organizuara nga nikoqirët',
    'Dëmet e shkaktuara gjatë vozitjeve të ndara',
    'Mosmarrëveshjet mes anëtarëve',
  ],
  section7Body:
    'Ju rekomandojmë gjithmonë të njoftoni një person të besuar para se të shkoni te çdo takim.',
  section8Title: '8. Ligji i zbatueshëm',
  section8Body:
    'Këto kushte rregullohen nga ligji i Kosovës. Çdo mosmarrëveshje zgjidhet në gjykatat e Prishtinës.',
  section9Title: '9. Kontakti',
  section9Body: 'hello@ejabashkohu.app',
}

export const privacyPolicy = {
  back: 'Kthehu',
  title: 'Politika e Privatësisë',
  effectiveDate: 'Hyrë në fuqi: Gusht 2026',
  section1Title: '1. Kush jemi ne',
  section1Body1:
    'ejaBashkohu është një platformë sociale e krijuar për banorët dhe vizitorët e Kosovës. Operojmë nga Prishtinë, Kosovë.',
  section1Body2: 'Email kontakti: hello@ejabashkohu.app',
  section2Title: '2. Çfarë të dhënash mbledhim',
  section2Items: [
    'Emri dhe mbiemri',
    'Adresa email',
    'Mosha (vetëm verifikojmë që jeni 18+)',
    'Fotografia e profilit',
    'Qyteti i vendbanimit',
    'Preferencat e aktiviteteve (profili i shijeve)',
    'Mesazhet e dërguara brenda platformës',
    'Tavolinat ku keni marrë pjesë',
  ],
  section3Title: '3. Si i përdorim të dhënat',
  section3Items: [
    "Për t'ju lidhur me persona me interesa të ngjashme",
    "Për t'ju dërguar njoftime mbi tavolinat tuaja",
    'Për të personalizuar rekomandimet e tavolinave',
    'Për sigurinë e komunitetit (raportimi dhe bllokimi)',
  ],
  section3Body: 'Nuk i shesim të dhënat tuaja askujt. Kurrë.',
  section4Title: '4. Fotografia e profilit',
  section4Body1:
    'Fotografia juaj ruhet në mënyrë të sigurt dhe shihet vetëm nga nikoqirët kur kërkoni t\'i bashkoheni tavolinës së tyre. Nuk publikohet kurrë dhe nuk ndahet me palë të treta.',
  section4Body2:
    'Çdo fotografi kalon kontrollin automatik të fytyrës. Fotografi të rreme ose pa fytyrë njerëzore nuk pranohen.',
  section5Title: '5. Pagesat',
  section5Body:
    'Të dhënat e kartelës bankare nuk ruhen kurrë në serverët tanë. Pagesat përpunohen nga ofrues të certifikuar. Ne ruajmë vetëm konfirmimin e transaksionit dhe kodin e biletës.',
  section6Title: '6. Të drejtat tuaja',
  section6Items: [
    'E drejta e aksesit. Mund të kërkoni të gjitha të dhënat tuaja',
    'E drejta e fshirjes. Mund të fshini llogarinë dhe të dhënat tuaja',
    'E drejta e korrigjimit. Mund të ndryshoni të dhënat tuaja',
    'E drejta e transportueshmërisë. Mund të eksportoni të dhënat tuaja',
  ],
  section6Body: 'Për të ushtruar këto të drejta, shkruani: hello@ejabashkohu.app',
  section7Title: '7. Siguria e të dhënave',
  section7Items: [
    'Të gjitha të dhënat transmetohen me enkriptim TLS',
    'Të dhënat ruhen me enkriptim AES-256',
    'Kopje rezervë çdo ditë',
    'Hyrja e kontrolluar me politika të sigurisë në nivel rreshti (RLS)',
    'Fjalëkalimet ruhen vetëm si hash. Askush nuk i sheh',
  ],
  section8Title: '8. Ruajtja e të dhënave',
  section8Body:
    'I ruajmë të dhënat tuaja derisa e mbyllni llogarinë. Pas mbylljes, fshijmë të dhënat brenda 30 ditëve, përveç atyre që kemi detyrim ligjor t\'i ruajmë.',
  section9Title: '9. Ndryshimet në politikë',
  section9Body:
    'Nëse ndryshojmë këtë politikë, ju njoftojmë me email të paktën 14 ditë para hyrjes në fuqi.',
  section10Title: '10. Kontakti',
  section10Body: 'Për çdo pyetje: hello@ejabashkohu.app',
}
