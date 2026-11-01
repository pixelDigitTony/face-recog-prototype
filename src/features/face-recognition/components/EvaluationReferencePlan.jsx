import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { createReferencePlan } from '@/utils/hooks/faceRecognition/recognition/evaluationReferencePlan';
import { LIGHTING_FEEDBACK } from '@/utils/hooks/faceRecognition/recognition/lightingQuality';

export function EvaluationReferencePlan({
  database,
  gallery,
  manifest,
  context,
  plan,
  onPlan,
  disabled,
}) {
  const [selections, setSelections] = useState({}),
    [error, setError] = useState(null);
  const people = database.people.filter((p) => gallery.entries.some((e) => e.personId === p.id));
  const update = (value) => {
    setSelections(value);
    setError(null);
  };
  const selected = Object.keys(selections).length;
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Reference plan</Typography>
          <Typography>
            Select the same people for every comparison. Order references before viewing test
            scores: one frontal baseline, two useful variations, then two more if available. This
            order applies only to Evaluate.
          </Typography>
          <Typography>
            {plan ? plan.people.length : selected} selected ·{' '}
            {database.people.length - (plan ? plan.people.length : selected)} excluded people.
            Cohort results do not establish accuracy for the full gallery.
          </Typography>
          {(plan?.people.length ?? selected) === 1 && (
            <Alert severity="warning">
              One person cannot test confusion between enrolled identities. Include other people and
              separate unknown participants.
            </Alert>
          )}
          {plan ? (
            <>
              <Typography>
                Frozen plan · {plan.modes.join(' / ')} samples per person ·{' '}
                {new Date(plan.createdAt).toLocaleString()}
              </Typography>
              {plan.people.map((p) => (
                <Box key={p.personId}>
                  <Typography fontWeight={700}>
                    {database.people.find((x) => x.id === p.personId)?.displayName ?? p.displayName}
                  </Typography>
                  {p.samples.map((s, i) => (
                    <Typography key={s.templateId} variant="body2">
                      {i + 1}. {s.label}
                    </Typography>
                  ))}
                </Box>
              ))}
              <Button disabled={disabled} onClick={() => onPlan(null)}>
                Create a new experiment
              </Button>
            </>
          ) : (
            <>
              {people.length === 0 && (
                <Alert severity="info">
                  Enroll eligible samples first, then load models to set up a comparison.
                </Alert>
              )}
              {people.map((p) => {
                const samples = database.templates.filter(
                  (t) => t.personId === p.id && gallery.entries.some((e) => e.templateId === t.id),
                );
                const order = selections[p.id];
                return (
                  <Box key={p.id}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={!!order}
                          disabled={disabled}
                          onChange={(_e, checked) => {
                            const next = { ...selections };
                            if (checked) next[p.id] = samples.map((t) => t.id);
                            else delete next[p.id];
                            update(next);
                          }}
                        />
                      }
                      label={`${p.displayName} · ${samples.length} eligible samples`}
                    />
                    {order?.map((id, index) => (
                      <Stack
                        key={index}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ my: 1 }}
                      >
                        <Avatar
                          variant="rounded"
                          src={samples.find((t) => t.id === id)?.thumbnailDataUrl || undefined}
                          alt="Reference photo"
                        >
                          —
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <TextField
                            fullWidth
                            select
                            size="small"
                            disabled={disabled}
                            label={`${p.displayName} reference ${index + 1}`}
                            value={id}
                            onChange={(e) => {
                              const next = [...order],
                                other = next.indexOf(e.target.value);
                              [next[index], next[other]] = [next[other], next[index]];
                              update({ ...selections, [p.id]: next });
                            }}
                          >
                            {samples.map((t) => (
                              <MenuItem key={t.id} value={t.id}>
                                {t.label} ·{' '}
                                {t.createdAt
                                  ? new Date(t.createdAt).toLocaleDateString()
                                  : 'Date not recorded'}
                              </MenuItem>
                            ))}
                          </TextField>
                          <Typography variant="caption">
                            Lighting:{' '}
                            {samples
                              .find((t) => t.id === id)
                              ?.quality?.lighting?.warnings?.map(
                                (w) => LIGHTING_FEEDBACK[w]?.label ?? w,
                              )
                              .join(', ') ||
                              (samples.find((t) => t.id === id)?.quality?.lighting
                                ? 'No warnings recorded'
                                : 'Not recorded')}
                          </Typography>
                        </Box>
                      </Stack>
                    ))}
                  </Box>
                );
              })}
              {selected > 0 && Math.min(...Object.values(selections).map((s) => s.length)) < 3 && (
                <Alert severity="info">
                  Incomplete plan: every selected person needs at least three eligible samples for 1
                  versus 3. Five each enables 1 versus 3 versus 5.
                </Alert>
              )}
              <Button
                variant="contained"
                disabled={
                  disabled || !selected || Object.values(selections).some((s) => s.length < 3)
                }
                onClick={async () => {
                  try {
                    onPlan(
                      await createReferencePlan({
                        selections,
                        gallery,
                        database,
                        manifest,
                        scope: context,
                      }),
                    );
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Freeze reference plan
              </Button>
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}
