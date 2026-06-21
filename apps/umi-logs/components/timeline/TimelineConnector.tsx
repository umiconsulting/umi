interface TimelineConnectorProps {
  heightPx?: number
}

export function TimelineConnector({ heightPx = 8 }: TimelineConnectorProps) {
  return (
    <div
      className="timeline-connector"
      style={{ height: `${heightPx}px` }}
    />
  )
}
