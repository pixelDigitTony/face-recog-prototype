import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useFaceServices, useLocalDatabase } from '@/utils/hooks/faceRecognition/useLocalDatabase';
import { formatDate, filterAndSortRecords } from '@/utils/hooks/faceRecognition/tableFormatting';
import { downloadJson } from '@/utils/hooks/faceRecognition/downloadJson';
import { OUTCOMES } from '../constants';
import { formatPercentage } from '@/utils/hooks/faceRecognition/recognition/matchPolicy';
import { LocalDatabaseTable } from '../components/LocalDatabaseTable';
import { RecordDetailsDialog } from '@/components/dialogs/faceRecognition/RecordDetailsDialog';
import { DeleteDataDialog } from '@/components/dialogs/faceRecognition/DeleteDataDialog';
import { PersonDialog } from '@/components/dialogs/faceRecognition/PersonDialog';

export function DatabasePage() {
  const { repository, workflow } = useFaceServices(),
    state = useLocalDatabase(),
    db = state.database;
  const [tab, setTab] = useState('attempts'),
    [search, setSearch] = useState(''),
    [outcome, setOutcome] = useState(''),
    [personId, setPersonId] = useState(''),
    [purpose, setPurpose] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [orderBy, setOrderBy] = useState('createdAt'),
    [direction, setDirection] = useState('desc'),
    [details, setDetails] = useState(null),
    [deletion, setDeletion] = useState(null),
    [editing, setEditing] = useState(null),
    [error, setError] = useState(null);
  const writable = state.mode === 'writable';
  const history = ['attempts', 'identificationEvents'].includes(tab);
  const columns =
    tab === 'people'
      ? [
          { key: 'employeeCode', label: 'Employee code' },
          { key: 'displayName', label: 'Name' },
          { key: 'department', label: 'Department' },
          {
            key: 'activeTemplateId',
            label: 'Enrollment',
            render: (row) => (
              <Chip
                size="small"
                label={row.activeTemplateId ? 'Enrolled' : 'Not enrolled'}
                color={row.activeTemplateId ? 'success' : 'default'}
                variant="outlined"
              />
            ),
          },
          { key: 'updatedAt', label: 'Updated', render: (row) => formatDate(row.updatedAt) },
        ]
      : tab === 'templates'
        ? [
            {
              key: 'personId',
              label: 'Person',
              render: (row) => db.people.find((p) => p.id === row.personId)?.displayName,
            },
            { key: 'version', label: 'Version' },
            { key: 'modelIdentity', label: 'Model', render: () => 'SFace · 128 values' },
            {
              key: 'thumbnailDataUrl',
              label: 'Thumbnail',
              render: (row) => (
                <Avatar
                  variant="rounded"
                  src={row.thumbnailDataUrl ?? undefined}
                  alt="Enrollment thumbnail"
                >
                  —
                </Avatar>
              ),
            },
            { key: 'createdAt', label: 'Created', render: (row) => formatDate(row.createdAt) },
          ]
        : tab === 'identificationEvents'
          ? [
              { key: 'completedAt', label: 'Time', render: (row) => formatDate(row.completedAt) },
              {
                key: 'personSnapshot',
                label: 'Person',
                render: (row) =>
                  row.personSnapshot
                    ? `${row.personSnapshot.displayName} (${row.personSnapshot.employeeCode})`
                    : row.outcome === 'UNKNOWN'
                      ? 'Unknown face'
                      : 'Ambiguous match',
              },
              { key: 'outcome', label: 'Outcome' },
              {
                key: 'similarity',
                label: 'Match similarity',
                render: (row) => formatPercentage(row.similarity),
              },
              {
                key: 'thresholdSnapshot',
                label: 'Threshold',
                render: (row) => `${row.comparisonOperator} ${row.thresholdSnapshot * 100}%`,
              },
              { key: 'faceCountAtDecision', label: 'Face count' },
              { key: 'livenessStatus', label: 'Liveness' },
              { key: 'source', label: 'Source' },
              { key: 'decisionPolicyVersion', label: 'Policy' },
            ]
          : tab === 'attempts'
            ? [
                { key: 'completedAt', label: 'Time', render: (row) => formatDate(row.completedAt) },
                {
                  key: 'personSnapshot',
                  label: 'Person',
                  render: (row) => (
                    <>
                      <Typography variant="body2" fontWeight={600}>
                        {row.personSnapshot.displayName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.personSnapshot.employeeCode}
                      </Typography>
                    </>
                  ),
                },
                { key: 'purpose', label: 'Purpose' },
                {
                  key: 'outcome',
                  label: 'Outcome',
                  render: (row) => (
                    <Chip
                      size="small"
                      label={row.outcome.replaceAll('_', ' ')}
                      color={['MATCH', 'ENROLLED'].includes(row.outcome) ? 'success' : 'default'}
                      variant="outlined"
                    />
                  ),
                },
                {
                  key: 'similarity',
                  label: 'Match similarity',
                  render: (row) => formatPercentage(row.similarity),
                },
                { key: 'livenessStatus', label: 'Liveness' },
                { key: 'source', label: 'Source' },
                { key: 'faceCountAtDecision', label: 'Face count' },
                { key: 'decisionPolicyVersion', label: 'Policy' },
                {
                  key: 'thresholdSnapshot',
                  label: 'Threshold',
                  render: (row) => row.thresholdSnapshot.toFixed(4),
                },
                {
                  key: 'timingsMs',
                  label: 'Time',
                  render: (row) =>
                    row.timingsMs.total ? `${Math.round(row.timingsMs.total)} ms` : '—',
                },
                {
                  key: 'thumbnailDataUrl',
                  label: 'Thumbnail',
                  render: (row) => (
                    <Avatar
                      variant="rounded"
                      src={row.thumbnailDataUrl ?? undefined}
                      alt="Capture thumbnail"
                    >
                      —
                    </Avatar>
                  ),
                },
              ]
            : [
                { key: 'key', label: 'Key' },
                { key: 'value', label: 'Value' },
                { key: 'type', label: 'Type' },
              ];
  const metadata = db
    ? [
        ...Object.entries(db.settings).map(([key, value]) => ({
          id: `settings.${key}`,
          key: `settings.${key}`,
          value,
          type: typeof value,
        })),
        ...Object.entries(db)
          .filter(
            ([key]) =>
              !['people', 'templates', 'attempts', 'identificationEvents', 'settings'].includes(
                key,
              ),
          )
          .map(([key, value]) => ({ id: key, key, value, type: typeof value })),
      ]
    : [];
  const rows = filterAndSortRecords(tab === 'metadata' ? metadata : (db?.[tab] ?? []), {
    search: tab === 'metadata' ? '' : search,
    outcome: history ? outcome : '',
    personId: history ? personId : '',
    purpose: tab === 'attempts' ? purpose : '',
    from: history ? from : '',
    to: history ? to : '',
    orderBy,
    direction,
  });
  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        gap={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="overline" color="primary" fontWeight={700}>
            YOUR PROTOTYPE DATA
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
            Local database
          </Typography>
          <Typography color="text.secondary">Every saved record. This browser only.</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => repository.refresh()}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={async () => {
              try {
                downloadJson(await repository.exportJson());
              } catch (error) {
                setError(error.message);
              }
            }}
          >
            Export JSON
          </Button>
        </Stack>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="info" sx={{ mb: 3 }}>
        Export includes face embeddings and retained thumbnails. Data stays in this browser until
        you download it.
      </Alert>
      <Card>
        <Tabs
          value={tab}
          onChange={(_, value) => {
            setTab(value);
            setSearch('');
            setOutcome('');
            setPersonId('');
            setPurpose('');
            setOrderBy(
              ['attempts', 'identificationEvents'].includes(value)
                ? 'completedAt'
                : value === 'metadata'
                  ? 'key'
                  : 'createdAt',
            );
          }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="attempts" label={`Captures (${db?.attempts.length ?? 0})`} />
          <Tab
            value="identificationEvents"
            label={`Identification scans (${db?.identificationEvents.length ?? 0})`}
          />
          <Tab value="people" label={`People (${db?.people.length ?? 0})`} />
          <Tab value="templates" label={`Templates (${db?.templates.length ?? 0})`} />
          <Tab value="metadata" label="Settings & metadata" />
        </Tabs>
        {tab !== 'metadata' && (
          <Stack direction="row" gap={1.5} flexWrap="wrap" sx={{ p: 2 }}>
            <TextField
              label="Search name or employee code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 250, flex: 1 }}
            />
            {history && (
              <>
                <TextField
                  select
                  label="Outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="">All outcomes</MenuItem>
                  {(tab === 'identificationEvents'
                    ? ['IDENTIFIED', 'UNKNOWN', 'AMBIGUOUS']
                    : OUTCOMES
                  ).map((value) => (
                    <MenuItem key={value} value={value}>
                      {value.replaceAll('_', ' ')}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Person"
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  sx={{ minWidth: 150 }}
                >
                  <MenuItem value="">All people</MenuItem>
                  {db?.people.map((person) => (
                    <MenuItem key={person.id} value={person.id}>
                      {person.displayName}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Purpose"
                  disabled={tab === 'identificationEvents'}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="enroll">Enrollment</MenuItem>
                  <MenuItem value="verify">Verification</MenuItem>
                </TextField>
                <TextField
                  type="date"
                  label="From"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  type="date"
                  label="To"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </>
            )}
          </Stack>
        )}
        <LocalDatabaseTable
          key={tab}
          rows={rows}
          columns={columns}
          orderBy={orderBy}
          direction={direction}
          onSort={(key) => {
            setOrderBy(key);
            setDirection(orderBy === key && direction === 'asc' ? 'desc' : 'asc');
          }}
          onDetails={setDetails}
          actions={(row) =>
            writable &&
            (tab === 'people' ? (
              <>
                <Button size="small" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    setDeletion({
                      title: 'Delete person and face data?',
                      description: `This removes ${row.displayName}, their face template, captures and linked identification scans.`,
                      run: () => workflow.deletePersonData({ personId: row.id }),
                    })
                  }
                >
                  Delete
                </Button>
              </>
            ) : history ? (
              <Button
                size="small"
                color="error"
                onClick={() =>
                  setDeletion({
                    title:
                      tab === 'identificationEvents'
                        ? 'Delete identification scan?'
                        : 'Delete capture?',
                    description: 'This removes this capture record and its retained face data.',
                    run: () =>
                      repository.commit({
                        type:
                          tab === 'identificationEvents' ? 'deleteIdentification' : 'deleteAttempt',
                        id: row.id,
                      }),
                  })
                }
              >
                Delete
              </Button>
            ) : null)
          }
        />
      </Card>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        gap={1}
        sx={{ mt: 2 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          Schema {db?.schemaVersion ?? '—'} · Revision {db?.revision ?? '—'}
        </Typography>
        {history && (
          <Button
            color="error"
            size="small"
            disabled={!writable || !db?.[tab].length}
            onClick={() =>
              setDeletion({
                title:
                  tab === 'identificationEvents'
                    ? 'Clear identification history?'
                    : 'Clear capture history?',
                description: `Delete ${db[tab].length} records from this history. People and enrollment templates remain.`,
                run: () =>
                  repository.commit({
                    type: tab === 'identificationEvents' ? 'clearIdentifications' : 'clearAttempts',
                  }),
              })
            }
          >
            {tab === 'identificationEvents'
              ? 'Clear identification history'
              : 'Clear capture history'}
          </Button>
        )}
      </Stack>
      <RecordDetailsDialog record={details} onClose={() => setDetails(null)} />
      <DeleteDataDialog
        key={deletion?.title ?? 'none'}
        action={deletion}
        onClose={() => setDeletion(null)}
      />
      {editing && (
        <PersonDialog key={editing.id} open person={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
