import { useEffect, useState } from 'react';
import {
  Alert,
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
import { useFaceServices, useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { useEvaluation } from '@/utils/hooks/faceRecognition/useEvaluation';
import { buildEnrollmentGallery } from '@/utils/hooks/faceRecognition/recognition/enrollmentGallery';
import {
  COMPARATIVE_POLICY,
  CONDITIONS,
  resolveReferencePlan,
} from '@/utils/hooks/faceRecognition/recognition/evaluationReferencePlan';
import { exportComparativeTrials } from '@/utils/hooks/faceRecognition/recognition/evaluation';
import { downloadJson } from '@/utils/hooks/faceRecognition/downloadJson';
import { EvaluationReferencePlan } from './EvaluationReferencePlan';
import { ComparativeEvaluationResults } from './ComparativeEvaluationResults';
import { FaceOverlay } from './FaceOverlay';

export function ComparativeEvaluationWorkspace() {
  const { repository, engine, context } = useFaceServices(),
    state = useLocalDatabase(),
    live = useEvaluation();
  const [gallery, setGallery] = useState(null),
    [plan, setPlan] = useState(null),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(false),
    [personId, setPersonId] = useState(''),
    [participantLabel, setParticipantLabel] = useState(''),
    [notes, setNotes] = useState(''),
    [session, setSession] = useState(''),
    [independent, setIndependent] = useState(false),
    [unknown, setUnknown] = useState(false),
    [conditions, setConditions] = useState({
      lighting: 'normal',
      appearance: 'usual',
      pose: 'frontal',
    }),
    [selectedReport, setSelectedReport] = useState(''),
    [validPlans, setValidPlans] = useState({}),
    [filters, setFilters] = useState({}),
    [checking, setChecking] = useState(false);
  const db = state.database,
    active = ['loading', 'capturing', 'saving'].includes(live.status),
    locked = active || !!live.pending;
  const trials = (db?.evaluationTrials ?? []).filter((t) => t.policy === COMPARATIVE_POLICY);
  useEffect(() => {
    let cancelled = false;
    if (!db || !engine.manifest) return;
    setChecking(true);
    (async () => {
      const g = await buildEnrollmentGallery(db, engine.manifest, context);
      const plans = new Map(trials.map((t) => [t.referencePlan.id, t.referencePlan]));
      if (plan) plans.set(plan.id, plan);
      const validity = {};
      for (const [id, p] of plans) {
        try {
          await resolveReferencePlan(p, g, engine.manifest, context);
          validity[id] = null;
        } catch (e) {
          validity[id] = e.message;
        }
      }
      if (!cancelled) {
        setGallery(g);
        setValidPlans(validity);
        setChecking(false);
      }
    })().catch((e) => {
      if (!cancelled) {
        setError(e.message);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [db, plan, loading, engine, context]);
  async function loadModels() {
    setLoading(true);
    setError(null);
    try {
      await engine.initialize();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  const reportId = selectedReport || plan?.id || trials.at(-1)?.referencePlan.id || '';
  const reportPlan =
    plan?.id === reportId
      ? plan
      : trials.find((t) => t.referencePlan.id === reportId)?.referencePlan;
  const group = trials.filter((t) => t.referencePlan.id === reportId);
  const filtered = group.filter((t) => Object.entries(filters).every(([k, v]) => !v || t[k] === v));
  const stale = checking || !gallery || validPlans[reportId] !== null;
  const plans = [...new Map(trials.map((t) => [t.referencePlan.id, t.referencePlan])).values()];
  if (plan && !plans.some((p) => p.id === plan.id)) plans.push(plan);
  return (
    <Stack spacing={3}>
      <Alert severity="info">
        Compare the same fresh captures against one, three and five references per person. Higher
        similarity alone does not establish better accuracy. Repeated frames and sessions are
        correlated; zero observed errors in a small pilot does not establish production accuracy.
      </Alert>
      {(error || live.error) && <Alert severity="error">{error || live.error}</Alert>}
      <Button variant="outlined" disabled={locked || loading} onClick={loadModels}>
        {loading ? 'Loading models…' : 'Load models for comparison'}
      </Button>
      {db && gallery && (
        <EvaluationReferencePlan
          database={db}
          gallery={gallery}
          manifest={engine.manifest}
          context={context}
          plan={plan}
          disabled={locked || checking}
          onPlan={(p) => {
            setPlan(p);
            setSelectedReport(p?.id ?? '');
            setPersonId('');
            setIndependent(false);
          }}
        />
      )}
      {plan && validPlans[plan.id] && <Alert severity="warning">{validPlans[plan.id]}</Alert>}
      {plan && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">
                Independent webcam trial · {db.evaluationTrials.length}/100 saved
              </Typography>
              <TextField
                select
                label="Actual person"
                value={personId}
                disabled={locked}
                onChange={(e) => setPersonId(e.target.value)}
              >
                <MenuItem value="">Not enrolled</MenuItem>
                {plan.people.map((p) => (
                  <MenuItem key={p.personId} value={p.personId}>
                    {db.people.find((x) => x.id === p.personId)?.displayName ?? p.displayName}
                  </MenuItem>
                ))}
              </TextField>
              {!personId && (
                <>
                  <TextField
                    label="Participant label"
                    value={participantLabel}
                    disabled={locked}
                    onChange={(e) => setParticipantLabel(e.target.value)}
                    slotProps={{ htmlInput: { maxLength: 100 } }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={unknown}
                        disabled={locked}
                        onChange={(e) => setUnknown(e.target.checked)}
                      />
                    }
                    label="This participant is not enrolled anywhere in this scope"
                  />
                </>
              )}
              <TextField
                label="Capture session label"
                value={session}
                disabled={locked}
                onChange={(e) => setSession(e.target.value)}
                helperText="Reuse this label for the same visit; include different days in testing."
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                {Object.entries(CONDITIONS).map(([key, values]) => (
                  <TextField
                    key={key}
                    select
                    fullWidth
                    label={`Trial ${key}`}
                    value={conditions[key]}
                    disabled={locked}
                    onChange={(e) => setConditions({ ...conditions, [key]: e.target.value })}
                  >
                    {values.map((v) => (
                      <MenuItem key={v} value={v}>
                        {v.replaceAll('_', ' ')}
                      </MenuItem>
                    ))}
                  </TextField>
                ))}
              </Stack>
              <TextField
                label="Trial notes"
                value={notes}
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={independent}
                    disabled={locked}
                    onChange={(e) => setIndependent(e.target.checked)}
                  />
                }
                label="This test capture is separate from enrollment, not an enrollment image or frame"
              />
              <Box
                sx={{
                  position: 'relative',
                  aspectRatio: '4/3',
                  maxWidth: 640,
                  bgcolor: '#102e28',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <Box
                  component="video"
                  ref={live.camera.videoRef}
                  muted
                  playsInline
                  sx={{
                    width: '100%',
                    height: '100%',
                    transform: 'scaleX(-1)',
                    objectFit: 'cover',
                  }}
                />
                <FaceOverlay
                  faces={live.camera.active ? live.faces : []}
                  frameSize={live.frameSize}
                  showInstructions={false}
                />
              </Box>
              <Typography role="status">
                {live.status} · {live.count}/3 observations · Liveness: not checked
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  disabled={
                    locked ||
                    loading ||
                    checking ||
                    validPlans[plan.id] !== null ||
                    state.mode !== 'writable' ||
                    db.evaluationTrials.length >= 100 ||
                    !session.trim() ||
                    !independent ||
                    (!personId && (!participantLabel.trim() || !unknown))
                  }
                  onClick={() =>
                    live.start({
                      personId,
                      participantLabel,
                      notes,
                      referencePlan: plan,
                      captureSessionLabel: session.trim(),
                      independentCaptureConfirmed: independent,
                      unknownParticipantConfirmed: unknown,
                      ...conditions,
                    })
                  }
                >
                  Start comparison trial
                </Button>
                <Button disabled={!active} onClick={() => live.cancel()}>
                  Cancel trial
                </Button>
                {live.pending && (
                  <>
                    <Button onClick={live.retry}>Retry saving trial</Button>
                    <Button onClick={live.discard}>Discard unsaved trial</Button>
                    <Button
                      onClick={() =>
                        downloadJson(
                          JSON.stringify(exportComparativeTrials([live.pending.trial]), null, 2),
                          'anthonys-face-lab-unsaved-comparison.json',
                        )
                      }
                    >
                      Export unsaved comparison
                    </Button>
                  </>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}
      {!!plans.length && (
        <>
          <TextField
            select
            label="Experiment results"
            value={reportId}
            onChange={(e) => {
              setSelectedReport(e.target.value);
              setFilters({});
            }}
          >
            {plans.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {new Date(p.createdAt).toLocaleString()} · {p.people.length} people ·{' '}
                {p.id.slice(0, 8)}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {[...Object.keys(CONDITIONS), 'captureSessionLabel'].map((key) => (
              <TextField
                key={key}
                select
                fullWidth
                label={`Filter ${key === 'captureSessionLabel' ? 'session' : key}`}
                value={filters[key] || ''}
                onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
              >
                <MenuItem value="">All</MenuItem>
                {[...new Set(group.map((t) => t[key]))].map((v) => (
                  <MenuItem key={v} value={v}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>
            ))}
          </Stack>
          {stale && (
            <Alert severity="warning">
              {checking
                ? 'Checking reference plan…'
                : validPlans[reportId] || 'Load models to check references.'}{' '}
              Historical results are excluded from current-plan aggregates.
            </Alert>
          )}
          <Typography>
            {filtered.filter((t) => t.status === 'completed' && stale).length} stale/excluded
            completed trials
          </Typography>
          {reportPlan && (
            <ComparativeEvaluationResults
              trials={stale ? filtered.filter((t) => t.status !== 'completed') : filtered}
              modes={reportPlan.modes}
              database={db}
            />
          )}
          {stale && filtered.some((t) => t.status === 'completed') && (
            <>
              <Typography variant="h6">
                Historical recorded results (separate from current aggregates)
              </Typography>
              <ComparativeEvaluationResults
                trials={filtered.filter((t) => t.status === 'completed')}
                modes={reportPlan.modes}
                database={db}
                historical
              />
            </>
          )}
          <Button
            disabled={!filtered.length}
            onClick={() =>
              downloadJson(
                JSON.stringify(
                  {
                    ...exportComparativeTrials(filtered),
                    referenceStatus: stale ? 'historical_or_unchecked' : 'current',
                    exclusionReason: stale
                      ? validPlans[reportId] || 'Reference compatibility has not been checked'
                      : null,
                  },
                  null,
                  2,
                ),
                'anthonys-face-lab-comparison.json',
              )
            }
          >
            Export comparison report
          </Button>
          <Typography variant="caption">
            The comparison report omits probe vectors. Full database export on the Database page
            includes biometric vectors.
          </Typography>
          {filtered.map((t) => (
            <Button
              key={t.id}
              color="error"
              disabled={locked || state.mode !== 'writable'}
              onClick={async () => {
                try {
                  await repository.commit({ type: 'deleteEvaluation', id: t.id });
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Delete trial: {t.participantLabel} · {t.createdAt}
            </Button>
          ))}
        </>
      )}
    </Stack>
  );
}
