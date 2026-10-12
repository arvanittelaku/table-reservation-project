export const chat = {
  title: 'Table chat',
  autoTranslate: 'Auto-translate',
  loading: 'Loading chat…',
  empty: 'Still quiet… say something first!',
  translating: 'Translating...',
  translateBtn: 'Translate',
  inputPlaceholder: 'Write a message…',
  translateOwnTitle: 'Translate your message',
  translateAriaLabel: 'Translate your message',
  sendAria: 'Send',
  icebreakerTitle: 'Get a conversation starter',
  icebreakerAria: 'Conversation starter',
  lockedMessage: 'Chat opens after you are approved and confirm your seat.',
}

export const profile = {
  close: 'Close',
  tablesHeld: '{{count}} tables hosted',
  reportUser: 'Report',
  blockUser: 'Block user',
  changePassword: 'Change password',
  myReports: 'My reports',
  blockedUsers: 'Blocked users',
  signOut: 'Sign out',
  deactivateAccount: 'Deactivate account permanently',
  faceVerificationNotice:
    'Every profile photo goes through face verification during registration. Blank, uniform, or non-real face photos are not accepted.',
  confirmSignOut: 'Do you want to sign out?',
  confirmDeactivate:
    'Your account will be deactivated PERMANENTLY. You will not be able to reactivate it. If you want to use ejaBashkohu again, you will need to create a new account. Continue?',
  confirmDeactivateSecond: 'Are you sure? This action cannot be undone.',
  signOutSuccessToast: 'Signed out',
  deactivateSuccessToast: 'Account deactivated',
  deactivateFailedToast: 'Failed. Try again',
}

export const changePasswordScreen = {
  title: 'Change password',
  currentPasswordLabel: 'Current password',
  newPasswordLabel: 'New password',
  confirmPasswordLabel: 'Repeat new password',
  changingText: 'Changing…',
  submitBtn: 'Save new password',
  successToast: 'Password changed successfully',
  wrongCurrentToast: 'Current password is incorrect',
  mismatchToast: 'Passwords do not match',
  minLengthToast: 'Password must be at least 6 characters',
  failedToast: 'Failed — try again',
}

export const myReportsScreen = {
  title: 'My reports',
  loading: 'Loading...',
  emptyState: "You haven't submitted any reports yet.",
  defaultUserName: 'User',
  statusPending: 'Under review',
  statusBanned: 'Action taken',
  statusDismissed: 'Dismissed',
  statusDeleted: 'Account deleted',
}

export const blockedUsersScreen = {
  title: 'Blocked users',
  loading: 'Loading...',
  emptyState: "You haven't blocked anyone yet.",
  unblockBtn: 'Unblock',
  blockedOnLabel: 'Blocked on {{date}}',
  confirmUnblock: 'Unblock this user? You will be able to see their tables again.',
  unblockSuccessToast: 'Unblocked',
  unblockFailedToast: 'Failed. Try again',
}

export const reportBlockSheet = {
  reportTitle: 'Report',
  reasonLabel: 'Reason for report',
  submitReport: 'Submit report',
  blockUserBtn: 'Block user',
  postReportPrompt:
    'Also want to block {{name}}? Their tables will no longer appear for you.',
  blockAlsoCheckbox: 'Also block. I will no longer see {{name}}\'s tables',
  blockWithoutReport: 'Block without reporting',
  anonymityNote:
    'Reporting is anonymous — {{name}} will not know who sent it. The safety team responds within 24 hours.',
  reportSentTitle: 'Report submitted',
  postReportNoThanks: 'No, thanks',
  confirmBlock: 'Block {{name}}? Their tables will no longer appear for you.',
  blockSuccessToast: 'You blocked this user. Their tables will no longer appear for you.',
  blockFailedToast: 'Block failed. Try again',
  reportSuccessToast: 'Report submitted',
  reportSuccessAndBlockedToast: 'Reported and blocked',
  reportFailedToast: 'Report was not sent. Try again',
  reportMissingProfileToast: 'Report was not sent. Profile missing',
  reasons: {
    inappropriate: 'Inappropriate behavior',
    fake_profile: 'Fake profile or stolen photo',
    spam: 'Spam / advertising',
    no_show: 'Did not show up',
    other: 'Other',
  },
}

export const passwordInput = {
  show: 'Show password',
  hide: 'Hide password',
}
