import {
  Alert,
  Avatar,
  Box,
  Card,
  CardContent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { comparativeSummary } from '@/utils/hooks/faceRecognition/recognition/evaluation';

const rate = (n, total) =>
  total ? `${n}/${total} (${((100 * n) / total).toFixed(1)}%)` : 'Unavailable - no trials';
const score = (v) => (v == null ? '—' : `${(Math.max(0, v) * 100).toFixed(2)}%`);
const outcomes = {
  correct: 'Correctly identified',
  missed: 'Missed identification',
  wrong_person: 'Wrong enrolled identity',
  unenrolled_accepted: 'Unknown accepted',
  unenrolled_rejected: 'Unknown rejected',
};
const reasons = {
  IDENTIFIED: 'Stable match',
  BELOW_THRESHOLD: 'Below threshold',
  MULTIPLE_ABOVE_THRESHOLD: 'Multiple people above threshold',
  INSUFFICIENT_MARGIN: 'Insufficient margin',
  UNSTABLE: 'Unstable observations',
};
export function ComparativeEvaluationResults({ trials, modes, database, historical = false }) {
  const summary = comparativeSummary(trials, modes);
  const completed = trials.filter((t) => t.status === 'completed' && t.report?.modes);
  return (
    <Stack spacing={2}>
      <Typography>
        {trials.length} trials ·{' '}
        {new Set(trials.map((t) => t.personId || `unknown:${t.participantLabel}`)).size}{' '}
        participants · {new Set(trials.map((t) => t.captureSessionLabel)).size} sessions ·{' '}
        {trials.filter((t) => t.status === 'capture_failed').length} capture failures ·{' '}
        {trials.filter((t) => t.status === 'cancelled').length} cancellations
      </Typography>
      <TableContainer component={Card}>
        <Table size="small" aria-label="Sample count accuracy comparison">
          <TableHead>
            <TableRow>
              {[
                'Samples per person',
                'Correct',
                'Missed',
                'Wrong person',
                'Unknown accepted',
                'Unknown rejected',
              ].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {modes.map((m) => {
              const c = summary.totals[m];
              return (
                <TableRow key={m}>
                  <TableCell>{m}</TableCell>
                  <TableCell>{rate(c.correct, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.missed, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.wrong_person, c.enrolled)}</TableCell>
                  <TableCell>{rate(c.unenrolled_accepted, c.unenrolled)}</TableCell>
                  <TableCell>{rate(c.unenrolled_rejected, c.unenrolled)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {!completed.some((t) => t.personId === null) && (
        <Alert severity="warning">
          Unknown rejection performance is untested. Include genuinely non-enrolled participants.
        </Alert>
      )}
      {summary.transitions.map((t) => (
        <Typography key={t.to}>
          {t.from} → {t.to}: {t.correctedMisses} corrected misses · {t.newlyMissed} newly missed ·{' '}
          {t.newlyWrong} newly wrong identities · {t.newlyAcceptedUnknown} newly accepted unknowns.{' '}
          {Object.values(t)
            .slice(2)
            .every((v) => v === 0)
            ? 'No outcome change observed in these trials.'
            : 'Review benefits and errors separately.'}
        </Typography>
      ))}
      <Typography variant="h6">Results by participant</Typography>
      {[...new Set(completed.map((t) => t.personId || `unknown:${t.participantLabel}`))].map(
        (id) => {
          const group = completed.filter(
            (t) => (t.personId || `unknown:${t.participantLabel}`) === id,
          );
          const s = comparativeSummary(group, modes);
          return (
            <Box key={id}>
              <Typography fontWeight={700}>{group[0].participantLabel}</Typography>
              {modes.map((m) => (
                <Typography variant="body2" key={m}>
                  {m} samples: correct {s.totals[m].correct} · missed {s.totals[m].missed} · wrong{' '}
                  {s.totals[m].wrong_person} · unknown accepted {s.totals[m].unenrolled_accepted} ·
                  unknown rejected {s.totals[m].unenrolled_rejected}
                </Typography>
              ))}
            </Box>
          );
        },
      )}
      <Typography variant="h6">Paired trials at 85%</Typography>
      {trials.map((t) => (
        <Card key={t.id}>
          <CardContent>
            <Typography fontWeight={700}>
              {t.participantLabel} · {t.captureSessionLabel}
            </Typography>
            <Typography>
              {t.lighting} · {t.appearance} · {t.pose} · {t.notes}
            </Typography>
            <Typography>
              {t.status}
              {t.reason && ` · ${t.reason}`}
              {historical && ' · Historical - reference unavailable/changed'}
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {[1, 3, 5].map((m) => {
                const r = t.report?.modes?.[m]?.[0],
                  candidate = r?.supportingCandidate;
                const reference = t.referencePlan.people
                  .flatMap((p) => p.samples)
                  .find((s) => s.templateId === candidate?.templateId);
                const sample = database.templates.find(
                  (s) => s.id === candidate?.templateId && s.version === candidate?.templateVersion,
                );
                return (
                  <Box key={m} sx={{ flex: 1 }}>
                    <Typography fontWeight={700}>{m} samples</Typography>
                    {!r ? (
                      <Typography>
                        {modes.includes(m) ? 'No completed result' : 'Unavailable for this plan'}
                      </Typography>
                    ) : (
                      <>
                        <Typography>
                          {outcomes[r.category]} · {reasons[r.diagnosticReason]}
                        </Typography>
                        <Typography variant="body2">
                          Accepted:{' '}
                          {r.predictedPersonId
                            ? (database.people.find((p) => p.id === r.predictedPersonId)
                                ?.displayName ?? 'Deleted person')
                            : 'None'}
                        </Typography>
                        <Avatar
                          variant="rounded"
                          src={historical ? undefined : sample?.thumbnailDataUrl || undefined}
                          alt={`Supporting reference: ${reference?.label ?? 'Unavailable'}`}
                        >
                          —
                        </Avatar>
                        <Typography variant="caption">
                          {reference?.label ?? 'Reference unavailable'} · {candidate?.templateId}
                        </Typography>
                        {r.scores.map((s, i) => (
                          <Typography key={i} variant="caption" display="block">
                            Observation {i + 1}: expected {score(s.expected)} · strongest other{' '}
                            {score(s.competing)} · closest {score(s.similarity)}
                          </Typography>
                        ))}
                      </>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
