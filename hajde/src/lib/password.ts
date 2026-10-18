/** One password rule for sign-up, reset and change (the server enforces the same):
 *  at least 8 characters, with an uppercase letter, a lowercase letter and a number. */
export const PASSWORD_MIN = 8

export function isPasswordValid(p: string | null | undefined): boolean {
  const s = p ?? ''
  return s.length >= PASSWORD_MIN && /\p{Ll}/u.test(s) && /\p{Lu}/u.test(s) && /\p{Nd}/u.test(s)
}
