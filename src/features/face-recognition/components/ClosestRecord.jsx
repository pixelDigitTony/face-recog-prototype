import { Avatar, Box, Stack, Tooltip } from '@mui/material';

export function identificationPresentation(identification) {
  const candidate = identification?.closestCandidate;
  const recognized =
    identification?.status === 'identified' &&
    identification.person &&
    candidate &&
    identification.person.personId === candidate.personId &&
    candidate.similarity >= 0.85;
  const status =
    {
      gallery_empty: 'No eligible enrollments',
      unknown: 'Below 85%',
      ambiguous: 'Ambiguous match',
      quality_blocked: 'Low image quality',
      waiting_for_analysis: 'Waiting for analysis',
      identity_conflict: 'Identity conflict',
    }[identification?.status] ??
    (candidate ? (candidate.similarity < 0.85 ? 'Below 85%' : 'Checking stability') : 'Searching');
  return {
    recognized: Boolean(recognized),
    status: recognized ? 'Recognized' : status,
    color: recognized
      ? '#70e39a'
      : candidate ||
          ['quality_blocked', 'waiting_for_analysis', 'identity_conflict'].includes(
            identification?.status,
          )
        ? '#ffbf47'
        : '#68c9ff',
  };
}

export function candidateAnnouncement(identification) {
  const { recognized, status } = identificationPresentation(identification);
  const person = identification?.closestCandidate?.personSnapshot;
  return person
    ? `${recognized ? 'Recognized:' : 'Closest record — unconfirmed:'} ${person.displayName} (${person.employeeCode})${recognized ? '' : ` · ${status}`}`
    : status;
}

export function ClosestRecord({ identification, compact = false }) {
  const candidate = identification?.closestCandidate;
  const { recognized, status } = identificationPresentation(identification);
  if (!candidate) return <Box component="div">{status}</Box>;
  const { displayName, employeeCode } = candidate.personSnapshot;
  // Only repository-validated JPEG data URLs are allowed; never request a remote portrait.
  const src =
    /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(candidate.thumbnailDataUrl ?? '') &&
    candidate.thumbnailDataUrl.length <= 4096
      ? candidate.thumbnailDataUrl
      : undefined;
  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-start" data-testid="closest-record">
      <Tooltip title={src ? `Enrollment photo of ${displayName}` : 'No enrollment photo'}>
        <Avatar
          variant="rounded"
          src={src}
          alt={`Enrollment photo of ${displayName}`}
          sx={{ width: compact ? 32 : 40, height: compact ? 32 : 40, flexShrink: 0 }}
        >
          <Box component="span" role="img" aria-label="No enrollment photo">
            —
          </Box>
        </Avatar>
      </Tooltip>
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Box sx={{ fontWeight: 700 }}>
          {recognized
            ? `Recognized: ${displayName} (${employeeCode})`
            : 'Closest record — unconfirmed'}
        </Box>
        {!recognized && (
          <Box>
            {displayName} ({employeeCode})
          </Box>
        )}
        {!recognized && <Box>{status}</Box>}
        {recognized && identification.tracked && <Box>Tracking confirmed face</Box>}
      </Box>
    </Stack>
  );
}
