/** Phase 7 — Admin panel + legal pages (DE) — legal sections may need lawyer review */
export const admin = {
  title: 'Admin',
  subtitle: 'Sicherheits- und Statistik-Panel',
  accessDenied: 'Zugriff verweigert',
  viewAsNormalUser: 'Als normaler Nutzer ansehen →',
  backToAdmin: '← Zurück zum Admin',
  tabs: { stats: 'Statistik', reports: 'Meldungen', bans: 'Sperren' },
  range: { day: 'Tag', month: 'Monat', year: 'Jahr' },
  rangePeriod: {
    day: 'Letzte 30 Tage',
    month: 'Letzte 12 Monate',
    year: 'Letzte 5 Jahre',
  },
  statsMeta: 'Diagramme: {{period}} · Gesamtkarten sind zeitlich unbegrenzt',
  chartNoData: 'Keine Daten für diesen Zeitraum.',
  loadingStats: 'Statistiken werden geladen',
  loadingReports: 'Meldungen werden geladen…',
  loadingBans: 'Sperren werden geladen…',
  statsLoadFailed: 'Statistiken konnten nicht geladen werden',
  reportsLoadFailed: 'Meldungen konnten nicht geladen werden',
  bansLoadFailed: 'Sperrliste konnte nicht geladen werden',
  totals: {
    totalUsers: 'Nutzer gesamt',
    totalTables: 'Tische gesamt',
    activeTables: 'Aktive Tische',
    memberships: 'Mitgliedschaften',
    pendingReports: 'Ausstehende Meldungen',
    bannedUsers: 'Gesperrte Nutzer',
  },
  charts: {
    newUsers: 'Neue Nutzer',
    tablesOpened: 'Geöffnete Tische',
    memberships: 'Neue Mitgliedschaften',
  },
  reportFilters: {
    pending: 'Ausstehend',
    reviewed_banned: 'Gesperrt',
    reviewed_dismissed: 'Abgelehnt',
    deleted_immediately: 'Gelöscht',
  },
  reportsEmpty: 'Keine Meldungen in dieser Kategorie.',
  tableLabel: 'Tisch',
  banBtn: 'Sperren',
  dismissBtn: 'Ablehnen',
  deleteImmediatelyBtn: 'Sofort löschen',
  deleteConfirm: 'Dies löscht das Konto dauerhaft. Fortfahren?',
  toastReportDismissed: 'Meldung abgelehnt',
  toastUserBanned: 'Nutzer gesperrt ({{count}}/3)',
  toastAccountDeleted: 'Konto gelöscht',
  toastFailed: 'Fehlgeschlagen',
  bansEmpty: 'Keine Sperren erfasst.',
  banCountOne: '{{count}} Sperre',
  banCountMany: '{{count}} Sperren',
}

export const termsOfService = {
  back: 'Zurück',
  title: 'Nutzungsbedingungen',
  effectiveDate: 'Gültig ab: August 2026',
  section1Title: '1. Annahme der Bedingungen',
  section1Body:
    'Mit der Registrierung bei ejaBashkohu akzeptieren Sie diese Bedingungen. Wenn Sie nicht einverstanden sind, nutzen Sie die Plattform bitte nicht.',
  section2Title: '2. Wer die Plattform nutzen darf',
  section2Items: [
    'Sie müssen mindestens 18 Jahre alt sein',
    'Sie müssen bei der Registrierung korrekte Angaben machen',
    'Sie müssen Ihr echtes Foto hochladen. Gefälschte Fotos führen zur Sperrung des Kontos',
    'Ihr Konto ist persönlich und darf nicht geteilt werden',
  ],
  section3Title: '3. Wie die Plattform funktioniert',
  section3Body1:
    'ejaBashkohu ist eine soziale Plattform zur Organisation von Treffen. Wir organisieren Treffen nicht selbst. Gastgeber und Gäste sind dafür verantwortlich.',
  section3Body2:
    'Die Gebühr von 2,00 € ist eine Reservierungsgebühr, die Ihre Teilnahme bestätigt. Sie ist nach Zahlung nicht erstattungsfähig.',
  section3Body3:
    'Mitfahrten sind vollständig kostenlos. Die Plattform vermittelt keine Zahlungen zwischen Fahrern und Mitfahrern.',
  section4Title: '4. Zulässiges Verhalten',
  section4Intro: 'Folgendes ist untersagt:',
  section4Items: [
    'Gefälschte Profile oder Fotos anderer Personen',
    'Missbräuchliches, belästigendes oder diskriminierendes Verhalten',
    'Anbieten kommerzieller Dienstleistungen ohne Erlaubnis',
    'Spam oder unerwünschte Nachrichten',
    'Verletzung der Privatsphäre anderer Mitglieder',
    'Jede rechtswidrige Handlung',
  ],
  section5Title: '5. Sicherheit und Meldungen',
  section5Body1:
    'Wenn Sie sich unsicher fühlen oder unangemessenes Verhalten sehen, melden Sie es sofort in der App oder kontaktieren Sie uns. Unser Team prüft jede Meldung innerhalb von 24 Stunden.',
  section5Body2:
    'Wir behalten uns vor, Konten, die diese Bedingungen verletzen, ohne vorherige Ankündigung zu sperren.',
  section6Title: '6. Rückerstattungsrichtlinie',
  section6Body:
    'Die Reservierungsgebühr von 2,00 € ist nach Bestätigung der Teilnahme nicht erstattungsfähig, auch wenn Sie das Treffen absagen. Diese Regelung dient der Seriosität aller Teilnehmer.',
  section7Title: '7. Haftungsbeschränkung',
  section7Intro: 'ejaBashkohu ist eine Vermittlungsplattform. Wir haften nicht für:',
  section7Items: [
    'Das Verhalten von Mitgliedern bei persönlichen Treffen',
    'Die Qualität von Tischen, die von Gastgebern organisiert werden',
    'Schäden bei gemeinsamen Mitfahrten',
    'Streitigkeiten zwischen Mitgliedern',
  ],
  section7Body:
    'Wir empfehlen, einer vertrauenswürdigen Person Bescheid zu geben, bevor Sie ein Treffen wahrnehmen.',
  section8Title: '8. Anwendbares Recht',
  section8Body:
    'Diese Bedingungen unterliegen dem Recht des Kosovo. Streitigkeiten werden vor den Gerichten in Pristina beigelegt.',
  section9Title: '9. Kontakt',
  section9Body: 'hello@ejabashkohu.app',
}

export const privacyPolicy = {
  back: 'Zurück',
  title: 'Datenschutzerklärung',
  effectiveDate: 'Gültig ab: August 2026',
  section1Title: '1. Wer wir sind',
  section1Body1:
    'ejaBashkohu ist eine soziale Plattform für Bewohner und Besucher des Kosovo. Wir haben unseren Sitz in Pristina, Kosovo.',
  section1Body2: 'Kontakt-E-Mail: hello@ejabashkohu.app',
  section2Title: '2. Welche Daten wir erheben',
  section2Items: [
    'Vor- und Nachname',
    'E-Mail-Adresse',
    'Alter (wir prüfen nur, dass Sie 18+ sind)',
    'Profilfoto',
    'Wohnort',
    'Aktivitätspräferenzen (Geschmacksprofil)',
    'Innerhalb der Plattform gesendete Nachrichten',
    'Tische, an denen Sie teilgenommen haben',
  ],
  section3Title: '3. Wie wir Daten verwenden',
  section3Items: [
    'Um Sie mit Personen ähnlicher Interessen zu verbinden',
    'Um Ihnen Benachrichtigungen zu Ihren Tischen zu senden',
    'Um Tischempfehlungen zu personalisieren',
    'Für die Sicherheit der Community (Meldungen und Sperren)',
  ],
  section3Body: 'Wir verkaufen Ihre Daten niemals an Dritte. Niemals.',
  section4Title: '4. Profilfoto',
  section4Body1:
    'Ihr Foto wird sicher gespeichert und ist nur für Gastgeber sichtbar, wenn Sie einer Tischbeitritt anfragen. Es wird nie veröffentlicht oder an Dritte weitergegeben.',
  section4Body2:
    'Jedes Foto durchläuft eine automatische Gesichtserkennung. Gefälschte Fotos oder Fotos ohne menschliches Gesicht werden abgelehnt.',
  section5Title: '5. Zahlungen',
  section5Body:
    'Bankkartendaten werden nie auf unseren Servern gespeichert. Zahlungen werden von zertifizierten Anbietern verarbeitet. Wir speichern nur die Transaktionsbestätigung und den Ticketcode.',
  section6Title: '6. Ihre Rechte',
  section6Items: [
    'Auskunftsrecht — Sie können alle Ihre Daten anfordern',
    'Recht auf Löschung — Sie können Konto und Daten löschen',
    'Recht auf Berichtigung — Sie können Ihre Daten ändern',
    'Recht auf Datenübertragbarkeit — Sie können Ihre Daten exportieren',
  ],
  section6Body: 'Zur Ausübung dieser Rechte schreiben Sie an: hello@ejabashkohu.app',
  section7Title: '7. Datensicherheit',
  section7Items: [
    'Alle Daten werden mit TLS-Verschlüsselung übertragen',
    'Daten werden mit AES-256-Verschlüsselung gespeichert',
    'Tägliche Backups',
    'Zugriffskontrolle durch Row-Level-Security-Richtlinien (RLS)',
    'Passwörter werden nur als Hash gespeichert — niemand kann sie lesen',
  ],
  section8Title: '8. Datenspeicherung',
  section8Body:
    'Wir speichern Ihre Daten, solange Ihr Konto aktiv ist. Nach Schließung löschen wir Daten innerhalb von 30 Tagen, außer wenn wir gesetzlich zur Aufbewahrung verpflichtet sind.',
  section9Title: '9. Änderungen der Richtlinie',
  section9Body:
    'Bei Änderungen dieser Richtlinie informieren wir Sie mindestens 14 Tage vor Inkrafttreten per E-Mail.',
  section10Title: '10. Kontakt',
  section10Body: 'Bei Fragen: hello@ejabashkohu.app',
}
