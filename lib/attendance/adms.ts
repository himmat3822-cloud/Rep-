// Plain-text responses for the ZKTeco / eSSL ADMS push protocol.
export function admsText(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export function admsOptions(serial: string): string {
  return [
    `GET OPTION FROM: ${serial}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=60',
    'Delay=30',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog',
    'TimeZone=5.5',
    'Realtime=1',
    'Encrypt=None',
    '',
  ].join('\n')
}
