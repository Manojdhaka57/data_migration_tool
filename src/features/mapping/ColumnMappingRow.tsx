import { Box, Typography, Chip, IconButton, Paper } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type { ColumnMapping } from '../../types';

interface ColumnMappingRowProps {
  mapping: ColumnMapping;
  onRemove: () => void;
  onEdit: () => void;
}

export function ColumnMappingRow({ mapping, onRemove, onEdit }: ColumnMappingRowProps) {
  const getMappingTypeLabel = () => {
    switch (mapping.mappingType) {
      case 'DIRECT':
        return 'Direct';
      case 'CONSTANT':
        return 'Constant';
      case 'TRANSFORM':
        return mapping.transformation?.type ?? 'Transform';
      case 'CONCAT':
        return 'Concat';
      case 'LOOKUP':
        return 'Lookup';
      default:
        return mapping.mappingType || 'Unknown';
    }
  };

  const getSourceDisplay = () => {
    switch (mapping.mappingType) {
      case 'DIRECT':
        return mapping.source ? `${mapping.source.table}.${mapping.source.column}` : '—';
      case 'CONSTANT':
        if (mapping.constantValue !== undefined) {
          const val = mapping.constantValue;
          if (typeof val === 'string') return `"${val}"`;
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return String(val);
        }
        return '—';
      case 'TRANSFORM':
      case 'CONCAT':
        if (mapping.sourceColumns && mapping.sourceColumns.length > 0) {
          return mapping.sourceColumns.map(s => `${s.table}.${s.column}`).join(', ');
        }
        return '—';
      case 'LOOKUP':
        return mapping.source ? `${mapping.source.table}.${mapping.source.column} → lookup` : '—';
      default:
        return mapping.source ? `${mapping.source.table}.${mapping.source.column}` : '—';
    }
  };

  const getMappingTypeColor = () => {
    switch (mapping.mappingType) {
      case 'DIRECT':
        return { bg: 'primary.100', text: 'primary.main' };
      case 'CONSTANT':
        return { bg: 'warning.100', text: 'warning.main' };
      case 'TRANSFORM':
        return { bg: 'secondary.100', text: 'secondary.main' };
      case 'CONCAT':
        return { bg: 'info.100', text: 'info.main' };
      case 'LOOKUP':
        return { bg: 'success.100', text: 'success.main' };
      default:
        return { bg: 'neutral.200', text: 'neutral.600' };
    }
  };

  const colors = getMappingTypeColor();

  return (
    <Paper sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1.5, mb: 1, bgcolor: 'neutral.100', border: 1, borderColor: 'neutral.200' }}>
      {/* Source */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography 
          variant="body2" 
          sx={{ 
            color: 'primary.main', 
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {getSourceDisplay()}
        </Typography>
      </Box>
      
      {/* Mapping Type & conversions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip 
          label={getMappingTypeLabel()}
          size="small"
          sx={{ 
            bgcolor: colors.bg, 
            color: colors.text,
            fontSize: (theme) => theme.typography.supportingTextBold.fontSize,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}
        />
        {mapping.convertDateToEpoch && (
          <Chip label="Date→Epoch" size="small" sx={{ bgcolor: 'info.100', color: 'info.main', fontSize: '0.7rem' }} />
        )}
        {mapping.convertTinyintToBoolean && (
          <Chip label="Tinyint→Bool" size="small" sx={{ bgcolor: 'info.100', color: 'info.main', fontSize: '0.7rem' }} />
        )}
        {mapping.encrypt && (
          <Chip label="🔒 Encrypted" size="small" sx={{ bgcolor: 'warning.100', color: 'warning.main', fontSize: '0.7rem' }} />
        )}
        <ArrowForwardIcon sx={{ fontSize: 16, color: 'neutral.400' }} />
      </Box>
      
      {/* Target */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography 
          variant="body2" 
          sx={{ 
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          <Typography component="span" sx={{ color: 'neutral.500' }}>{mapping.target.table}.</Typography>
          <Typography component="span" sx={{ color: 'secondary.main', fontWeight: 500 }}>{mapping.target.column}</Typography>
        </Typography>
      </Box>
      
      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <IconButton 
          size="small" 
          onClick={onEdit}
          sx={{ color: 'neutral.400', '&:hover': { color: 'info.main', bgcolor: 'info.100' } }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
        <IconButton 
          size="small" 
          onClick={onRemove}
          sx={{ color: 'neutral.400', '&:hover': { color: 'warning.main', bgcolor: 'warning.100' } }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
    </Paper>
  );
}
