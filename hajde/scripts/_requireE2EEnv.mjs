/** Require E2E credentials from environment — never hardcode in scripts. */
export function requireE2EEmail() {
  const email = process.env.E2E_EMAIL
  if (!email) {
    console.error('E2E_EMAIL environment variable is required')
    process.exit(1)
  }
  return email
}

export function requireE2EPassword() {
  const password = process.env.E2E_PASSWORD
  if (!password) {
    console.error('E2E_PASSWORD environment variable is required')
    process.exit(1)
  }
  return password
}
