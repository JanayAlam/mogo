/** Built-in checks; ids match backend/mogo/checks. Projects switch them off in settings.checks[id] = false. */
export const BUILTIN_CHECKS = [
  {
    id: 'no-duplicate-types',
    title: 'No duplicate type definitions',
    description: 'A type the PR adds must not repeat one that already exists in the same repo.',
  },
  {
    id: 'structure-convention',
    title: 'File and folder conventions',
    description: 'New files follow the folders, naming and test placement of the source of truth branch.',
  },
] as const

export function checkEnabled(settings: Record<string, unknown> | undefined, id: string): boolean {
  const checks = (settings?.checks ?? {}) as Record<string, unknown>
  return checks[id] !== false
}

export const checkTitle = (id: string) =>
  BUILTIN_CHECKS.find((c) => c.id === id.replace(/^builtin:/, ''))?.title ?? id
