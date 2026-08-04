import { useMemo, useState } from 'react';
import { 
  Box, 
  Typography, 
  List, 
  ListItemButton, 
  Chip, 
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table as MuiTable,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import TableChartIcon from '@mui/icons-material/TableChart';
import KeyIcon from '@mui/icons-material/Key';
import LinkIcon from '@mui/icons-material/Link';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { Table, Column } from '../../types';

interface TableListProps {
  tables: Table[];
  selectedTable: string | null;
  selectedColumn: string | null;
  onSelectTable: (tableName: string | null) => void;
  onSelectColumn: (columnName: string | null) => void;
  colorScheme?: 'primary' | 'secondary';
}

export function TableList({
  tables,
  selectedTable,
  selectedColumn,
  onSelectTable,
  onSelectColumn,
  colorScheme = 'primary',
}: TableListProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentTable = useMemo(() => 
    tables.find(t => t.name === selectedTable),
    [tables, selectedTable]
  );

  const accentColor = colorScheme;

  const handleCopyStructure = () => {
    if (!currentTable) return;
    
    const structure = {
      tableName: currentTable.name,
      columns: currentTable.columns.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable ?? true,
        isPrimaryKey: col.isPrimaryKey ?? false,
        isForeignKey: col.isForeignKey ?? false,
        foreignKeyRef: col.foreignKeyRef ?? null,
      })),
    };
    
    navigator.clipboard.writeText(JSON.stringify(structure, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflow: 'hidden' }}>
      {/* Tables List */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 1, 
          p: 1, 
          bgcolor: 'neutral.100', 
          borderRadius: 1,
          mb: 1,
          position: 'sticky',
          top: 0,
          zIndex: 1
        }}>
          <Typography variant="body2Bold" sx={{ color: `${accentColor}.main`, letterSpacing: '0.05em' }}>
            ◈ TABLES ({tables.length})
          </Typography>
        </Box>
        
        {tables.length === 0 ? (
          <Typography variant="body1" sx={{ color: 'neutral.500', textAlign: 'center', py: 4 }}>
            No tables loaded
          </Typography>
        ) : (
          <List sx={{ py: 0 }}>
            {tables.map(table => (
              <Tooltip 
                key={table.name}
                title={table.name}
                placement="right"
                arrow
                enterDelay={300}
              >
                <ListItemButton
                  selected={selectedTable === table.name}
                  onClick={() => {
                    onSelectTable(table.name === selectedTable ? null : table.name);
                    onSelectColumn(null);
                  }}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    py: 1,
                    border: 1,
                    borderColor: 'neutral.200',
                    '&.Mui-selected': {
                      bgcolor: `${accentColor}.100`,
                      borderColor: `${accentColor}.main`,
                      '&:hover': { bgcolor: `${accentColor}.200` }
                    },
                    '&:hover': { bgcolor: 'neutral.100' }
                  }}
                >
                  <TableChartIcon sx={{ fontSize: 16, color: `${accentColor}.main`, mr: 1, flexShrink: 0 }} />
                  <Typography 
                    variant="body2Bold" 
                    sx={{ 
                      flex: 1, 
                      color: `${accentColor}.main`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0
                    }}
                  >
                    {table.name}
                  </Typography>
                  <Chip 
                    label={table.columns.length}
                    size="small"
                    sx={{ 
                      bgcolor: 'neutral.200', 
                      color: 'neutral.600',
                      fontSize: (theme) => theme.typography.supportingText.fontSize,
                      height: '18px',
                      minWidth: '28px',
                      flexShrink: 0,
                      ml: 0.5,
                      '& .MuiChip-label': { px: 0.75 }
                    }}
                  />
                </ListItemButton>
              </Tooltip>
            ))}
          </List>
        )}
      </Box>

      {/* Columns List */}
      {currentTable && (
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            gap: 1, 
            p: 1, 
            bgcolor: 'neutral.100', 
            borderRadius: 1,
            mb: 1,
            position: 'sticky',
            top: 0,
            zIndex: 1
          }}>
            <Tooltip title={currentTable.name} placement="top" arrow>
              <Typography 
                variant="body2Bold" 
                sx={{ 
                  color: `${accentColor}.main`, 
                  letterSpacing: '0.05em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0
                }}
              >
                ◇ {currentTable.name.toUpperCase()}
              </Typography>
            </Tooltip>
            <Tooltip title="Preview Table Structure" placement="top" arrow>
              <IconButton
                size="small"
                onClick={() => setPreviewOpen(true)}
                sx={{ 
                  color: `${accentColor}.main`,
                  bgcolor: `${accentColor}.100`,
                  '&:hover': { bgcolor: `${accentColor}.200` },
                  width: 28,
                  height: 28,
                }}
              >
                <VisibilityIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
          
          <List sx={{ py: 0 }}>
            {currentTable.columns.map((column: Column) => (
              <Tooltip
                key={column.name}
                title={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{column.name}</Typography>
                    <Typography variant="caption">Type: {column.type}</Typography>
                    {column.isPrimaryKey && <Typography variant="caption" sx={{ display: 'block', color: 'warning.300' }}>🔑 Primary Key</Typography>}
                    {column.isForeignKey && column.foreignKeyRef && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'secondary.300' }}>
                        🔗 FK → {column.foreignKeyRef.table}.{column.foreignKeyRef.column}
                      </Typography>
                    )}
                    {column.nullable === false && <Typography variant="caption" sx={{ display: 'block', color: 'error.300' }}>⚠ NOT NULL</Typography>}
                  </Box>
                }
                placement="right"
                arrow
                enterDelay={300}
              >
                <ListItemButton
                  selected={selectedColumn === column.name}
                  onClick={() => onSelectColumn(column.name === selectedColumn ? null : column.name)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    py: 0.75,
                    px: 1,
                    border: 1,
                    borderColor: column.isPrimaryKey ? 'warning.200' : column.isForeignKey ? 'secondary.200' : 'neutral.200',
                    bgcolor: column.isPrimaryKey ? 'warning.50' : column.isForeignKey ? 'secondary.50' : 'transparent',
                    '&.Mui-selected': {
                      bgcolor: `${accentColor}.100`,
                      borderColor: `${accentColor}.main`,
                      '&:hover': { bgcolor: `${accentColor}.200` }
                    },
                    '&:hover': { bgcolor: 'neutral.100' }
                  }}
                >
                  {column.isPrimaryKey ? (
                    <KeyIcon sx={{ fontSize: 14, color: 'warning.main', mr: 0.75, flexShrink: 0 }} />
                  ) : column.isForeignKey ? (
                    <LinkIcon sx={{ fontSize: 14, color: 'secondary.main', mr: 0.75, flexShrink: 0 }} />
                  ) : (
                    <Box sx={{ 
                      width: 14, 
                      height: 14, 
                      mr: 0.75, 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', border: 1, borderColor: 'neutral.400' }} />
                    </Box>
                  )}
                  <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography 
                        variant="caption1" 
                        sx={{ 
                          color: column.isPrimaryKey ? 'warning.700' : column.isForeignKey ? 'secondary.700' : 'primary.main',
                          fontFamily: 'monospace',
                          fontWeight: column.isPrimaryKey || column.isForeignKey ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {column.name}
                      </Typography>
                      {column.isPrimaryKey && (
                        <Chip 
                          label="PK"
                          size="small"
                          sx={{ 
                            bgcolor: 'warning.100', 
                            color: 'warning.700',
                            fontSize: '9px',
                            fontWeight: 700,
                            height: '14px',
                            '& .MuiChip-label': { px: 0.5 }
                          }}
                        />
                      )}
                      {column.isForeignKey && (
                        <Chip 
                          label="FK"
                          size="small"
                          sx={{ 
                            bgcolor: 'secondary.100', 
                            color: 'secondary.700',
                            fontSize: '9px',
                            fontWeight: 700,
                            height: '14px',
                            '& .MuiChip-label': { px: 0.5 }
                          }}
                        />
                      )}
                    </Box>
                    {/* FK Reference Table */}
                    {column.isForeignKey && column.foreignKeyRef && (
                      <Typography 
                        variant="supportingText" 
                        sx={{ 
                          color: 'secondary.500', 
                          fontFamily: 'monospace',
                          fontSize: '10px',
                          display: 'block',
                          mt: 0.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        → {column.foreignKeyRef.table}.{column.foreignKeyRef.column}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 0.5 }}>
                    <Typography 
                      variant="supportingText" 
                      sx={{ 
                        color: 'neutral.500', 
                        fontFamily: 'monospace',
                        maxWidth: 55,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {column.type}
                    </Typography>
                    {column.nullable === false && (
                      <Chip 
                        label="NN"
                        size="small"
                        sx={{ 
                          bgcolor: 'error.100', 
                          color: 'error.700',
                          fontSize: '9px',
                          fontWeight: 700,
                          height: '14px',
                          '& .MuiChip-label': { px: 0.5 }
                        }}
                      />
                    )}
                  </Box>
                </ListItemButton>
              </Tooltip>
            ))}
          </List>

          {/* Sample Data Preview */}
          {currentTable.sampleData && currentTable.sampleData.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1, 
                p: 1, 
                bgcolor: 'warning.100', 
                borderRadius: 1,
                mb: 1
              }}>
                <Typography variant="body2Bold" sx={{ color: 'warning.main', letterSpacing: '0.05em' }}>
                  📋 SAMPLE ({currentTable.sampleData.length})
                </Typography>
              </Box>
              <Box sx={{ bgcolor: 'neutral.100', borderRadius: 1, p: 1, maxHeight: 100, overflow: 'auto' }}>
                {currentTable.sampleData.slice(0, 2).map((row, idx) => (
                  <Box key={idx} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
                    {Object.entries(row).slice(0, 4).map(([key, value]) => (
                      <Tooltip key={key} title={`${key}: ${String(value)}`} placement="top" arrow>
                        <Box sx={{ display: 'flex', gap: 0.25, maxWidth: 120 }}>
                          <Typography 
                            variant="supportingText" 
                            sx={{ 
                              color: 'neutral.500', 
                              fontFamily: 'monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {key}:
                          </Typography>
                          <Typography 
                            variant="supportingText" 
                            sx={{ 
                              color: 'primary.main', 
                              fontFamily: 'monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {String(value)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ))}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Table Structure Preview Dialog */}
      <Dialog 
        open={previewOpen} 
        onClose={() => setPreviewOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'white.main',
          }
        }}
      >
        <DialogTitle sx={{ 
          borderBottom: 1, 
          borderColor: 'neutral.200', 
          bgcolor: `${accentColor}.50`,
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between' 
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TableChartIcon sx={{ color: `${accentColor}.main` }} />
            <Typography variant="h6" sx={{ color: `${accentColor}.800` }}>
              {currentTable?.name} - Table Structure
            </Typography>
          </Box>
          <Tooltip title={copied ? 'Copied!' : 'Copy as JSON'}>
            <IconButton 
              size="small" 
              onClick={handleCopyStructure}
              sx={{ 
                color: copied ? 'success.600' : `${accentColor}.600`,
                bgcolor: copied ? 'success.100' : `${accentColor}.100`,
                '&:hover': { bgcolor: copied ? 'success.200' : `${accentColor}.200` },
              }}
            >
              {copied ? <CheckIcon /> : <ContentCopyIcon />}
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {currentTable && (
            <>
              {/* Summary Chips */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Chip 
                  label={`${currentTable.columns.length} Columns`}
                  sx={{ bgcolor: 'info.100', color: 'info.700' }}
                />
                <Chip 
                  icon={<KeyIcon />}
                  label={`${currentTable.columns.filter(c => c.isPrimaryKey).length} Primary Key`}
                  sx={{ 
                    bgcolor: 'warning.100', 
                    color: 'warning.700',
                    '& .MuiChip-icon': { color: 'warning.500' },
                  }}
                />
                <Chip 
                  icon={<LinkIcon />}
                  label={`${currentTable.columns.filter(c => c.isForeignKey).length} Foreign Keys`}
                  sx={{ 
                    bgcolor: 'secondary.100', 
                    color: 'secondary.700',
                    '& .MuiChip-icon': { color: 'secondary.500' },
                  }}
                />
                <Chip 
                  label={`${currentTable.columns.filter(c => c.nullable === false).length} Not Null`}
                  sx={{ bgcolor: 'error.100', color: 'error.700' }}
                />
              </Box>

              {/* Columns Table */}
              <TableContainer 
                component={Paper} 
                sx={{ 
                  bgcolor: 'white.main',
                  border: 1,
                  borderColor: 'neutral.200',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <MuiTable size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: `${accentColor}.700` }}>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600, width: 40 }}>#</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600 }}>Column Name</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600 }}>Data Type</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600, width: 80 }} align="center">Nullable</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600, width: 80 }} align="center">PK</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600, width: 80 }} align="center">FK</TableCell>
                      <TableCell sx={{ color: 'white.main', fontWeight: 600 }}>Foreign Key Reference</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentTable.columns.map((col, idx) => (
                      <TableRow 
                        key={col.name}
                        sx={{ 
                          bgcolor: idx % 2 === 0 ? 'white.main' : 'neutral.100',
                          '&:hover': { bgcolor: `${accentColor}.50` },
                          borderBottom: 1,
                          borderColor: 'neutral.200',
                        }}
                      >
                        <TableCell sx={{ color: 'neutral.500', fontWeight: 500 }}>{idx + 1}</TableCell>
                        <TableCell sx={{ color: 'neutral.800', fontFamily: 'monospace', fontWeight: 500 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {col.name}
                            {col.isPrimaryKey && (
                              <KeyIcon sx={{ fontSize: 14, color: 'warning.600' }} />
                            )}
                            {col.isForeignKey && (
                              <LinkIcon sx={{ fontSize: 14, color: 'secondary.600' }} />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={col.type}
                            sx={{
                              bgcolor: 'info.100',
                              color: 'info.700',
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              height: 22,
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          {col.nullable !== false ? (
                            <CheckIcon sx={{ color: 'success.600', fontSize: 18 }} />
                          ) : (
                            <CloseIcon sx={{ color: 'error.600', fontSize: 18 }} />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {col.isPrimaryKey ? (
                            <CheckIcon sx={{ color: 'warning.600', fontSize: 18 }} />
                          ) : (
                            <Typography sx={{ color: 'neutral.400' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {col.isForeignKey ? (
                            <CheckIcon sx={{ color: 'secondary.600', fontSize: 18 }} />
                          ) : (
                            <Typography sx={{ color: 'neutral.400' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '11px' }}>
                          {col.foreignKeyRef ? (
                            <Chip
                              size="small"
                              label={`${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`}
                              sx={{
                                bgcolor: 'secondary.100',
                                color: 'secondary.700',
                                fontFamily: 'monospace',
                                fontSize: '10px',
                                height: 20,
                              }}
                            />
                          ) : (
                            <Typography sx={{ color: 'neutral.400' }}>—</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </MuiTable>
              </TableContainer>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: 1, borderColor: 'neutral.200', bgcolor: 'neutral.100', p: 2 }}>
          <Button 
            variant="outlined"
            startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
            onClick={handleCopyStructure}
            sx={{ 
              color: copied ? 'success.700' : `${accentColor}.700`,
              borderColor: copied ? 'success.400' : `${accentColor}.400`,
              '&:hover': {
                bgcolor: copied ? 'success.50' : `${accentColor}.50`,
                borderColor: copied ? 'success.600' : `${accentColor}.600`,
              },
            }}
          >
            {copied ? 'Copied!' : 'Copy JSON'}
          </Button>
          <Button 
            onClick={() => setPreviewOpen(false)} 
            sx={{ 
              color: 'primary.main',
              '&:hover': { bgcolor: 'neutral.100' },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
