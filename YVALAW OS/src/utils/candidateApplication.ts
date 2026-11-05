// Careers-page applications arrive with their answers in the candidate's notes (application-intake.cjs):
//   Country: …\nLanguages: …\nExperience: …\nMessage: … (the message may run over several lines)
// splitApplication() pulls those answers out so the profile can show them as the application, and leaves anything
// the team typed later as ordinary notes. Notes without these lines come back unchanged.

export const APPLICATION_FIELDS = ['Country', 'Languages', 'Experience', 'LinkedIn', 'Message'] as const
export type ApplicationField = typeof APPLICATION_FIELDS[number]

const FIELD_LINE = new RegExp(`^(${APPLICATION_FIELDS.join('|')}):\\s?(.*)$`)

export function splitApplication(notes: string | null | undefined): { fields: { label: ApplicationField; value: string }[]; rest: string } {
  const fields: { label: ApplicationField; value: string }[] = []
  const rest: string[] = []
  let current: { label: ApplicationField; value: string } | null = null
  for (const line of String(notes ?? '').split(/\r?\n/)) {
    const m = FIELD_LINE.exec(line)
    if (m && !fields.some(f => f.label === m[1])) {
      current = { label: m[1] as ApplicationField, value: m[2] }
      fields.push(current)
    } else if (current?.label === 'Message') {
      current.value += `\n${line}`          // the message keeps its own line breaks
    } else {
      current = null
      rest.push(line)
    }
  }
  for (const f of fields) f.value = f.value.trim()
  return { fields: fields.filter(f => f.value), rest: rest.join('\n').trim() }
}
