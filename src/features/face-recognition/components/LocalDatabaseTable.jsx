import { useState } from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { displayValue } from '@/utils/hooks/faceRecognition/tableFormatting';

export function LocalDatabaseTable({
  rows,
  columns,
  orderBy,
  direction,
  onSort,
  onDetails,
  actions,
}) {
  const [page, setPage] = useState(0),
    [rowsPerPage, setRowsPerPage] = useState(10);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1));
  return (
    <>
      <TableContainer>
        <Table aria-label="Local database records" size="small" sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell key={column.key}>
                  <TableSortLabel
                    active={orderBy === column.key}
                    direction={orderBy === column.key ? direction : 'asc'}
                    onClick={() => onSort(column.key)}
                  >
                    {column.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage).map((row) => (
              <TableRow key={row.id} hover>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    sx={{ py: 1.8, maxWidth: 260, overflowWrap: 'anywhere' }}
                  >
                    {column.render ? column.render(row) : displayValue(row[column.key])}
                  </TableCell>
                ))}
                <TableCell>
                  <Box sx={{ display: 'flex', whiteSpace: 'nowrap' }}>
                    <Button
                      size="small"
                      onClick={() => onDetails(row)}
                      aria-label={`View record ${row.id}`}
                    >
                      View
                    </Button>
                    {actions?.(row)}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 1}>
                  <Box sx={{ py: 7, textAlign: 'center' }}>
                    <Typography fontWeight={600}>No records to show</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Saved records will appear here. Try changing your filters.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={rows.length}
        page={currentPage}
        onPageChange={(_, page) => setPage(page)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(event) => {
          setRowsPerPage(Number(event.target.value));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </>
  );
}
