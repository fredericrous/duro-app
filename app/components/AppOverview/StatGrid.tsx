import { Card, Grid, Heading, Stack, Text } from "@duro-app/ui"

export interface Stat {
  label: string
  value: string | number
  hint?: string
}

interface StatGridProps {
  stats: ReadonlyArray<Stat>
}

export function StatGrid({ stats }: StatGridProps) {
  return (
    <Grid columns={4} gap="md">
      {stats.map((s) => (
        <Card key={s.label} variant="outlined" size="default">
          <Stack gap="xs">
            <Text color="muted" variant="caption">
              {s.label}
            </Text>
            <Heading level={2}>{s.value}</Heading>
            {s.hint && (
              <Text color="muted" variant="caption">
                {s.hint}
              </Text>
            )}
          </Stack>
        </Card>
      ))}
    </Grid>
  )
}
