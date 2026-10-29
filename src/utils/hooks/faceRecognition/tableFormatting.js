export function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Manila',
      }).format(new Date(value))
    : '—';
}
export function displayValue(value) {
  return value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
}
export function filterAndSortRecords(
  rows,
  {
    search = '',
    outcome = '',
    personId = '',
    purpose = '',
    from = '',
    to = '',
    orderBy = 'createdAt',
    direction = 'desc',
  },
) {
  const query = search.trim().toLowerCase();
  return rows
    .filter((row) => {
      const timestamp = row.completedAt || row.createdAt;
      return (
        (!query ||
          JSON.stringify([
            row.employeeCode,
            row.displayName,
            row.department,
            row.personSnapshot,
            row.id,
          ])
            .toLowerCase()
            .includes(query)) &&
        (!outcome || row.outcome === outcome) &&
        (!personId || row.personId === personId) &&
        (!purpose || row.purpose === purpose) &&
        (!from || new Date(timestamp) >= new Date(`${from}T00:00:00+08:00`)) &&
        (!to || new Date(timestamp) <= new Date(`${to}T23:59:59.999+08:00`))
      );
    })
    .sort((a, b) => {
      const av = a[orderBy],
        bv = b[orderBy];
      const comparison =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''));
      return (comparison || a.id.localeCompare(b.id)) * (direction === 'asc' ? 1 : -1);
    });
}
