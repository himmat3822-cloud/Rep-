import { generateVAPIDKeys } from 'web-push'

// pnpm vapid - prints a new key pair for web push. Put the same public key in
// VAPID_PUBLIC_KEY and NEXT_PUBLIC_VAPID_PUBLIC_KEY. Generate once: changing
// the keys later means every member has to turn notifications on again.
const keys = generateVAPIDKeys()
console.info(`VAPID_PUBLIC_KEY="${keys.publicKey}"`)
console.info(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`)
console.info(`VAPID_PRIVATE_KEY="${keys.privateKey}"`)
