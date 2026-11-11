import bcrypt from 'bcryptjs'

const ROUNDS = 12

// Used when the account does not exist, so a failed login takes the same
// time either way and response timing does not reveal which emails exist.
let dummyHash: string | null = null

async function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = await bcrypt.hash('kasrat-timing-guard', ROUNDS)
  return dummyHash
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, await getDummyHash())
    return false
  }
  return bcrypt.compare(plain, hash)
}
