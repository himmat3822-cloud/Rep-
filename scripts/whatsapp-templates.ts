// Prints the WhatsApp templates Rep+ uses (EN, HI, PA) as JSON, ready to
// submit to Meta. With --submit it creates them in your WhatsApp Business
// Account (needs WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in .env).
//
//   pnpm wa:templates
//   pnpm wa:templates --submit
//
// The OTP template (kasrat_otp) is an AUTHENTICATION template; create it in
// WhatsApp Manager with a "Copy code" button - Meta writes its text.
import 'dotenv/config'
import { metaTemplateDefinitions } from '../lib/messaging/templates'

async function main() {
  const definitions = metaTemplateDefinitions()
  if (!process.argv.includes('--submit')) {
    console.log(JSON.stringify(definitions, null, 2))
    console.error(`\n${definitions.length} templates (${definitions.length / 3} x EN/HI/PA). Run with --submit to create them.`)
    return
  }
  const token = process.env.WHATSAPP_TOKEN
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
  if (!token || !waba) throw new Error('Set WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in .env first')
  for (const definition of definitions) {
    const response = await fetch(`https://graph.facebook.com/${version}/${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(definition),
    })
    const data = (await response.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } }
    console.log(`${definition.name} [${definition.language}] -> ${response.ok ? `${data.status ?? 'submitted'} (${data.id})` : `FAILED: ${data.error?.message ?? response.statusText}`}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
