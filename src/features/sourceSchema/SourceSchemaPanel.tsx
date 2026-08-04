import { useCallback } from 'react';
import { Box, Typography, Chip, Divider } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../store';
import { 
  setSelectedTable, 
  setSelectedColumn, 
  selectSourceSchema,
  selectSourceTables,
  selectSelectedSourceTable,
  selectSelectedSourceColumn,
  selectSourceIsLoaded,
} from './sourceSchemaSlice';
import { TableList } from '../../components/shared';

export function SourceSchemaPanel() {
  const dispatch = useAppDispatch();
  const schema = useAppSelector(selectSourceSchema);
  const tables = useAppSelector(selectSourceTables);
  const selectedTable = useAppSelector(selectSelectedSourceTable);
  const selectedColumn = useAppSelector(selectSelectedSourceColumn);
  const isLoaded = useAppSelector(selectSourceIsLoaded);

  const handleSelectTable = useCallback((tableName: string | null) => {
    dispatch(setSelectedTable(tableName));
  }, [dispatch]);

  const handleSelectColumn = useCallback((columnName: string | null) => {
    dispatch(setSelectedColumn(columnName));
  }, [dispatch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'white.main' }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'neutral.200' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Chip 
            label="SOURCE" 
            size="small" 
            sx={{ 
              bgcolor: 'primary.main', 
              color: 'white.main',
              fontSize: (theme) => theme.typography.supportingTextBold.fontSize,
              fontWeight: 700,
              letterSpacing: '0.1em',
              height: '22px'
            }} 
          />
          {isLoaded && (
            <Chip 
              label="Loaded" 
              size="small" 
              sx={{ 
                bgcolor: 'warning.100', 
                color: 'warning.main',
                fontSize: (theme) => theme.typography.supportingText.fontSize,
                height: '20px'
              }} 
            />
          )}
        </Box>
        <Typography variant="h2Bold" sx={{ color: 'primary.main' }}>
          {schema ? schema.database : 'Source Schema'}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, p: 2, overflow: 'hidden' }}>
        {!isLoaded ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body1" sx={{ color: 'neutral.500' }}>Loading schema...</Typography>
          </Box>
        ) : (
          <TableList
            tables={tables}
            selectedTable={selectedTable}
            selectedColumn={selectedColumn}
            onSelectTable={handleSelectTable}
            onSelectColumn={handleSelectColumn}
            colorScheme="primary"
          />
        )}
      </Box>

      {/* Footer Stats */}
      {isLoaded && schema && (
        <>
          <Divider sx={{ borderColor: 'neutral.200' }} />
          <Box sx={{ p: 1.5, display: 'flex', gap: 3, bgcolor: 'neutral.100' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>{tables.length}</Typography>
              <Typography variant="body2" sx={{ color: 'neutral.500' }}>tables</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
              <Typography variant="h3Bold" sx={{ color: 'primary.main' }}>
                {tables.reduce((acc, t) => acc + t.columns.length, 0)}
              </Typography>
              <Typography variant="body2" sx={{ color: 'neutral.500' }}>columns</Typography>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
