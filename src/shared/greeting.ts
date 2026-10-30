export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 11) return 'Guten Morgen'
  if (hour >= 11 && hour < 14) return 'Hallo, wie läuft’s?'
  if (hour >= 14 && hour < 18) return 'Zeit für neue Ideen?'
  if (hour >= 18 && hour < 22) return 'Guten Abend'
  return 'Hallo, Nachteule'
}
