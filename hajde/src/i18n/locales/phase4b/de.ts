export const chat = {
  title: 'Tisch-Chat',
  autoTranslate: 'Automatische Übersetzung',
  loading: 'Chat wird geladen…',
  empty: 'Noch still… sag etwas als Erstes!',
  translating: 'Wird übersetzt...',
  translateBtn: 'Übersetzen',
  inputPlaceholder: 'Nachricht schreiben…',
  translateOwnTitle: 'Eigene Nachricht übersetzen',
  translateAriaLabel: 'Eigene Nachricht übersetzen',
  sendAria: 'Senden',
  icebreakerTitle: 'Eisbrecher-Frage holen',
  icebreakerAria: 'Eisbrecher-Frage',
  lockedMessage: 'Der Chat öffnet sich, nachdem du bestätigt wurdest und deinen Platz bestätigt hast.',
}

export const profile = {
  close: 'Schließen',
  tablesHeld: '{{count}} Tische veranstaltet',
  reportUser: 'Melden',
  blockUser: 'Nutzer blockieren',
  changePassword: 'Passwort ändern',
  myReports: 'Meine Meldungen',
  blockedUsers: 'Blockierte Nutzer',
  signOut: 'Abmelden',
  deactivateAccount: 'Konto dauerhaft deaktivieren',
  faceVerificationNotice:
    'Jedes Profilfoto wird bei der Registrierung per Gesichtserkennung geprüft. Leere, einheitliche oder unrealistische Fotos werden nicht akzeptiert.',
  confirmSignOut: 'Möchtest du dich abmelden?',
  confirmDeactivate:
    'Dein Konto wird DAUERHAFT deaktiviert. Du kannst es nicht reaktivieren. Wenn du ejaBashkohu wieder nutzen willst, musst du ein neues Konto erstellen. Fortfahren?',
  confirmDeactivateSecond: 'Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden.',
  signOutSuccessToast: 'Abgemeldet',
  deactivateSuccessToast: 'Konto deaktiviert',
  deactivateFailedToast: 'Fehlgeschlagen. Erneut versuchen',
}

export const changePasswordScreen = {
  title: 'Passwort ändern',
  currentPasswordLabel: 'Aktuelles Passwort',
  newPasswordLabel: 'Neues Passwort',
  confirmPasswordLabel: 'Neues Passwort wiederholen',
  changingText: 'Wird geändert…',
  submitBtn: 'Neues Passwort speichern',
  successToast: 'Passwort erfolgreich geändert',
  wrongCurrentToast: 'Aktuelles Passwort ist falsch',
  mismatchToast: 'Passwörter stimmen nicht überein',
  minLengthToast: 'Passwort muss mindestens 6 Zeichen haben',
  failedToast: 'Fehlgeschlagen — erneut versuchen',
}

export const myReportsScreen = {
  title: 'Meine Meldungen',
  loading: 'Wird geladen...',
  emptyState: 'Du hast noch keine Meldungen eingereicht.',
  defaultUserName: 'Nutzer',
  statusPending: 'In Prüfung',
  statusBanned: 'Maßnahme ergriffen',
  statusDismissed: 'Abgelehnt',
  statusDeleted: 'Konto gelöscht',
}

export const blockedUsersScreen = {
  title: 'Blockierte Nutzer',
  loading: 'Wird geladen...',
  emptyState: 'Du hast noch niemanden blockiert.',
  unblockBtn: 'Entblocken',
  blockedOnLabel: 'Blockiert am {{date}}',
  confirmUnblock: 'Diesen Nutzer entblocken? Du siehst seine Tische wieder.',
  unblockSuccessToast: 'Entblockt',
  unblockFailedToast: 'Fehlgeschlagen. Erneut versuchen',
}

export const reportBlockSheet = {
  reportTitle: 'Melden',
  reasonLabel: 'Grund der Meldung',
  submitReport: 'Meldung senden',
  blockUserBtn: 'Nutzer blockieren',
  postReportPrompt:
    'Möchtest du {{name}} auch blockieren? Seine Tische werden dir nicht mehr angezeigt.',
  blockAlsoCheckbox: 'Auch blockieren. Ich sehe {{name}}s Tische nicht mehr',
  blockWithoutReport: 'Blockieren ohne Meldung',
  anonymityNote:
    'Die Meldung ist anonym — {{name}} erfährt nicht, wer sie gesendet hat. Das Sicherheitsteam antwortet innerhalb von 24 Stunden.',
  reportSentTitle: 'Meldung gesendet',
  postReportNoThanks: 'Nein, danke',
  confirmBlock: '{{name}} blockieren? Seine Tische werden dir nicht mehr angezeigt.',
  blockSuccessToast: 'Du hast diesen Nutzer blockiert. Seine Tische werden dir nicht mehr angezeigt.',
  blockFailedToast: 'Blockieren fehlgeschlagen. Erneut versuchen',
  reportSuccessToast: 'Meldung gesendet',
  reportSuccessAndBlockedToast: 'Gemeldet und blockiert',
  reportFailedToast: 'Meldung wurde nicht gesendet. Erneut versuchen',
  reportMissingProfileToast: 'Meldung wurde nicht gesendet. Profil fehlt',
  reasons: {
    inappropriate: 'Unangemessenes Verhalten',
    fake_profile: 'Fake-Profil oder fremdes Foto',
    spam: 'Spam / Werbung',
    no_show: 'Nicht erschienen',
    other: 'Sonstiges',
  },
}

export const passwordInput = {
  show: 'Passwort anzeigen',
  hide: 'Passwort verbergen',
}
