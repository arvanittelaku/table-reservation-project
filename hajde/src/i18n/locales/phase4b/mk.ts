export const chat = {
  title: 'Разговор на масата',
  autoTranslate: 'Автоматски превод',
  loading: 'Се вчитува разговорот…',
  empty: 'Уште тишина… кажи нешто прво!',
  translating: 'Се преведува...',
  translateBtn: 'Преведи',
  inputPlaceholder: 'Напиши порака…',
  translateOwnTitle: 'Преведи ја својата порака',
  translateAriaLabel: 'Преведи ја својата порака',
  sendAria: 'Испрати',
  icebreakerTitle: 'Земи прашање за почеток на разговор',
  icebreakerAria: 'Прашање за почеток',
  lockedMessage: 'Разговорот се отвора откако ќе бидеш одобрен и ќе го потврдиш местото.',
}

export const profile = {
  close: 'Затвори',
  tablesHeld: '{{count}} организирани маси',
  reportUser: 'Пријави',
  blockUser: 'Блокирај корисник',
  changePassword: 'Промени лозинка',
  myReports: 'Мои пријави',
  blockedUsers: 'Блокирани корисници',
  signOut: 'Одјави се',
  deactivateAccount: 'Деактивирај сметка трајно',
  faceVerificationNotice:
    'Секоја профилна фотографија поминува проверка на лице при регистрација. Празни, еднолични или нереални фотографии не се прифаќаат.',
  confirmSignOut: 'Дали сакаш да се одјавиш?',
  confirmDeactivate:
    'Твојата сметка ќе биде деактивирана ТРАЈНО. Нема да можеш да ја реактивираш. Ако сакаш повторно да го користиш ejaBashkohu, ќе треба да создадеш нова сметка. Продолжи?',
  confirmDeactivateSecond: 'Дали си сигурен? Оваа акција не може да се врати.',
  signOutSuccessToast: 'Одјавен',
  deactivateSuccessToast: 'Сметката е деактивирана',
  deactivateFailedToast: 'Не успеа. Обиди се повторно',
}

export const changePasswordScreen = {
  title: 'Промени лозинка',
  currentPasswordLabel: 'Тековна лозинка',
  newPasswordLabel: 'Нова лозинка',
  confirmPasswordLabel: 'Повтори ја новата лозинка',
  changingText: 'Се менува…',
  submitBtn: 'Зачувај нова лозинка',
  successToast: 'Лозинката е успешно променета',
  wrongCurrentToast: 'Тековната лозинка е погрешна',
  mismatchToast: 'Лозинките не се совпаѓаат',
  minLengthToast: 'Лозинката мора да има најмалку 6 знаци',
  failedToast: 'Не успеа — обиди се повторно',
}

export const myReportsScreen = {
  title: 'Мои пријави',
  loading: 'Се вчитува...',
  emptyState: 'Уште немаш поднесено пријави.',
  defaultUserName: 'Корисник',
  statusPending: 'Во преглед',
  statusBanned: 'Преземена мерка',
  statusDismissed: 'Одбиено',
  statusDeleted: 'Сметката е избришана',
}

export const blockedUsersScreen = {
  title: 'Блокирани корисници',
  loading: 'Се вчитува...',
  emptyState: 'Уште никого не си блокирал.',
  unblockBtn: 'Одблокирај',
  blockedOnLabel: 'Блокиран на {{date}}',
  confirmUnblock: 'Да го одблокирам овој корисник? Повторно ќе можеш да ги гледаш неговите маси.',
  unblockSuccessToast: 'Одблокиран',
  unblockFailedToast: 'Не успеа. Обиди се повторно',
}

export const reportBlockSheet = {
  reportTitle: 'Пријави',
  reasonLabel: 'Причина за пријавата',
  submitReport: 'Испрати пријава',
  blockUserBtn: 'Блокирај корисник',
  postReportPrompt:
    'Сакаш исто така да го блокираш {{name}}? Неговите маси повеќе нема да се прикажуваат кај тебе.',
  blockAlsoCheckbox: 'Блокирај исто така. Повеќе нема да ги гледам масите на {{name}}',
  blockWithoutReport: 'Блокирај без пријава',
  anonymityNote:
    'Пријавата е анонимна — {{name}} нема да знае кој ја испратил. Тимот за безбедност одговара во рок од 24 часа.',
  reportSentTitle: 'Пријавата е испратена',
  postReportNoThanks: 'Не, благодарам',
  confirmBlock: 'Да го блокирам {{name}}? Неговите маси повеќе нема да се прикажуваат кај тебе.',
  blockSuccessToast: 'Го блокираше овој корисник. Неговите маси повеќе нема да се прикажуваат кај тебе.',
  blockFailedToast: 'Блокирањето не успеа. Обиди се повторно',
  reportSuccessToast: 'Пријавата е испратена',
  reportSuccessAndBlockedToast: 'Пријавен и блокиран',
  reportFailedToast: 'Пријавата не беше испратена. Обиди се повторно',
  reportMissingProfileToast: 'Пријавата не беше испратена. Недостасува профил',
  reasons: {
    inappropriate: 'Несоодветно однесување',
    fake_profile: 'Лажен профил или туѓа фотографија',
    spam: 'Спам / реклама',
    no_show: 'Не дојде на состанокот',
    other: 'Друго',
  },
}

export const passwordInput = {
  show: 'Прикажи лозинка',
  hide: 'Сокриј лозинка',
}
