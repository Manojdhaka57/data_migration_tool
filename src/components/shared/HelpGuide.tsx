import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Button,
  Paper,
  Chip,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Upload as UploadIcon,
  AccountTree as MigrationIcon,
  AutoAwesome as AutoMapIcon,
  Code as SQLIcon,
  Transform as TransformIcon,
  CheckCircle as CheckIcon,
  ArrowForward as ArrowIcon,
  Help as HelpIcon,
  TableChart as TableIcon,
  Link as LinkIcon,
  Key as KeyIcon,
  LightbulbOutlined as TipIcon,
  CloudDownload as ReadSchemaIcon,
  PlayArrow as RunIcon,
} from '@mui/icons-material';

interface HelpGuideProps {
  open: boolean;
  onClose: () => void;
}

const steps = [
  {
    label: 'Load Schemas',
    icon: <UploadIcon />,
    description: 'Load source and target database schemas from files or from the live database.',
    details: [
      'Go to "Schema" tab to view or edit schemas (loaded from files or previously saved).',
      'Go to "Read Schema" to fetch schemas from a live database: test connection (source & target), then Fetch source schema, Fetch target schema, or Fetch both.',
      'After fetching, use "Update to source" or "Update to target" to apply the fetched schema to the app.',
      'Alternatively upload Schema JSON or use SQL Analyzer to parse .sql files first.',
    ],
    tip: 'Read Schema uses the migration server (MySQL or PostgreSQL source → PostgreSQL target). Ensure the server is running and .env is configured.',
  },
  {
    label: 'Analyze SQL (Optional)',
    icon: <SQLIcon />,
    description: 'Parse SQL files to extract table structures automatically.',
    details: [
      'Go to "SQL Analyzer" tab',
      'Upload .sql file or PostgreSQL dump',
      'View extracted tables, columns, and keys',
      'Click "Update Schema" to use parsed data as Source or Target',
    ],
    tip: 'Supports MySQL, PostgreSQL, SQLite syntax and pg_dump format.',
  },
  {
    label: 'View Migration Order',
    icon: <MigrationIcon />,
    description: 'Understand table dependencies and migration sequence.',
    details: [
      'Go to "Migration Order" tab',
      'View tables organized by dependency levels',
      'Level 0 tables have no dependencies (migrate first)',
      'Higher levels depend on lower levels',
      'Generate SQL scripts for migration',
    ],
    tip: 'Foreign keys determine the order. Migrate parent tables before child tables.',
  },
  {
    label: 'Auto-Generate Mappings',
    icon: <AutoMapIcon />,
    description: 'Automatically match source tables/columns to target schema.',
    details: [
      'Go to "Auto Mapping" tab',
      'Choose "From Data" to use loaded schemas',
      'Or upload new SQL files directly',
      'Review auto-generated mappings with confidence scores',
      'Click "Apply Mappings" to use them',
    ],
    tip: 'Mappings are based on name similarity and type compatibility. Review and adjust as needed.',
  },
  {
    label: 'Review & Edit Mappings',
    icon: <TableIcon />,
    description: 'Fine-tune table and column mappings. Use suggestions to find unmapped columns and set value conversions for MySQL → PostgreSQL.',
    details: [
      'Go to "Table Mappings" tab and select a table mapping.',
      'In the Column Mappings panel, see "Suggestions — columns not yet mapped": source and target columns that have no mapping yet.',
      'Click "Add Column" to add a mapping. Choose Direct, Constant, or Transform and pick source/target table and column.',
      'Under "Value conversions (MySQL → PG)" you can enable: Convert date/datetime string → epoch (seconds), and Convert tinyint (0/1) → boolean.',
      'Edit or remove column mappings as needed. Use the Preview panel to see the migration config JSON.',
    ],
    tip: 'Enable date→epoch or tinyint→boolean per column when migrating from MySQL; the migration server will convert values during run.',
  },
  {
    label: 'Transform Data',
    icon: <TransformIcon />,
    description: 'Upload CSV data and transform according to mappings.',
    details: [
      'Go to "Data Transform" tab',
      'Upload CSV file with source data',
      'Multi-table CSVs are auto-detected (tables separated by "id" header rows)',
      'Select source and target tables',
      'Click "Transform & Validate"',
      'Download successful and failed rows separately',
    ],
    tip: 'For multi-table CSV, each table starts with a header row beginning with "id".',
  },
  {
    label: 'Run Migration',
    icon: <RunIcon />,
    description: 'Test database connections and run the migration from the migration server.',
    details: [
      'Go to "Run Migration" tab. Start the migration server (e.g. npm run migrate:server) if not already running.',
      'Use "Test connection" to verify source and target (or test both at once).',
      'Run a dry run first to validate without writing data, then run the full migration.',
      'The server uses your mapping config and applies date→epoch and tinyint→boolean conversions where enabled in column mappings.',
    ],
    tip: 'Source can be MySQL or PostgreSQL; target is PostgreSQL. Set SOURCE_DB_TYPE, SOURCE_* and TARGET_* in .env for the server.',
  },
];

const stepColors = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#2F4157', '#EC4899', '#0EA5E9'];

export function HelpGuide({ open, onClose }: HelpGuideProps) {
  const [activeStep, setActiveStep] = useState(0);

  const handleNext = () => {
    setActiveStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBack = () => {
    setActiveStep((prev) => Math.max(prev - 1, 0));
  };

  const handleStepClick = (step: number) => {
    setActiveStep(step);
  };

  const currentColor = stepColors[activeStep];

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: '#FFFFFF',
          maxHeight: '90vh',
          borderRadius: 3,
          overflow: 'hidden',
        }
      }}
    >
      {/* Header */}
      <DialogTitle sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #2F4157 0%, #1F2D3E 100%)',
        pb: 2,
        pt: 2,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ 
            p: 1.5, 
            borderRadius: 2, 
            bgcolor: 'rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
          }}>
            <HelpIcon sx={{ color: '#FFFFFF', fontSize: 28 }} />
          </Box>
          <Box>
            <Typography variant="h3Bold" sx={{ color: '#FFFFFF' }}>
              How to Use ERP Data Migration
            </Typography>
            <Typography variant="caption1" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              Step-by-step guide to migrate your database
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#FFFFFF' } }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', height: '60vh' }}>
          {/* Left - Stepper */}
          <Box sx={{ 
            width: 260, 
            borderRight: 1, 
            borderColor: '#E5E7EB', 
            p: 2,
            bgcolor: '#F9FAFB',
            overflow: 'auto',
          }}>
            <Stepper activeStep={activeStep} orientation="vertical" sx={{ 
              '& .MuiStepConnector-line': { borderColor: '#E5E7EB' },
            }}>
              {steps.map((step, index) => (
                <Step key={step.label} completed={index < activeStep}>
                  <StepLabel
                    onClick={() => handleStepClick(index)}
                    sx={{ 
                      cursor: 'pointer',
                      '& .MuiStepLabel-label': { 
                        color: index === activeStep ? '#1F2937' : '#6B7280',
                        fontWeight: index === activeStep ? 600 : 400,
                        fontSize: '13px',
                      },
                      '& .MuiStepIcon-root': {
                        color: index < activeStep ? '#10B981' : (index === activeStep ? stepColors[index] : '#D1D5DB'),
                        '&.Mui-completed': { color: '#10B981' },
                        '&.Mui-active': { color: stepColors[index] },
                      },
                    }}
                  >
                    {step.label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
            
            <Divider sx={{ my: 2, borderColor: '#E5E7EB' }} />
            
            {/* Quick Reference */}
            <Typography variant="caption1Bold" sx={{ color: '#6B7280', mb: 1.5, display: 'block' }}>
              Quick Reference
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, bgcolor: '#FEF3C7', borderRadius: 1 }}>
                <KeyIcon sx={{ fontSize: 16, color: '#D97706' }} />
                <Typography variant="caption1" sx={{ color: '#92400E' }}>PK = Primary Key</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, bgcolor: '#DBEAFE', borderRadius: 1 }}>
                <LinkIcon sx={{ fontSize: 16, color: '#2563EB' }} />
                <Typography variant="caption1" sx={{ color: '#1E40AF' }}>FK = Foreign Key</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, bgcolor: '#D1FAE5', borderRadius: 1 }}>
                <CheckIcon sx={{ fontSize: 16, color: '#059669' }} />
                <Typography variant="caption1" sx={{ color: '#065F46' }}>NN = Not Nullable</Typography>
              </Box>
            </Box>
          </Box>
          
          {/* Right - Content */}
          <Box sx={{ flex: 1, p: 3, overflow: 'auto', bgcolor: '#FFFFFF' }}>
            {steps.map((step, index) => (
              <Box
                key={step.label}
                sx={{ display: index === activeStep ? 'block' : 'none' }}
              >
                {/* Step Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                  <Box sx={{ 
                    p: 1.5, 
                    borderRadius: 2, 
                    bgcolor: currentColor,
                    display: 'flex',
                    alignItems: 'center',
                    color: '#FFFFFF',
                  }}>
                    {step.icon}
                  </Box>
                  <Box>
                    <Chip 
                      label={`Step ${index + 1} of ${steps.length}`}
                      size="small"
                      sx={{ bgcolor: '#F3F4F6', color: '#6B7280', mb: 0.5, fontWeight: 500 }}
                    />
                    <Typography variant="h2Bold" sx={{ color: '#1F2937' }}>
                      {step.label}
                    </Typography>
                  </Box>
                </Box>
                
                {/* Description */}
                <Typography variant="body1" sx={{ color: '#4B5563', mb: 3, lineHeight: 1.6 }}>
                  {step.description}
                </Typography>
                
                {/* Details */}
                <Paper sx={{ 
                  p: 2.5, 
                  bgcolor: '#F9FAFB', 
                  borderRadius: 2,
                  mb: 2,
                  border: '1px solid #E5E7EB',
                }}>
                  <Typography variant="body2Bold" sx={{ color: '#374151', mb: 1.5 }}>
                    📋 What to do:
                  </Typography>
                  <Box component="ol" sx={{ m: 0, pl: 2 }}>
                    {step.details.map((detail, i) => (
                      <Box 
                        component="li" 
                        key={i}
                        sx={{ 
                          color: '#4B5563', 
                          mb: 1,
                          pl: 0.5,
                          '&::marker': { color: currentColor, fontWeight: 600 },
                        }}
                      >
                        <Typography variant="body2" sx={{ color: '#4B5563' }}>{detail}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Paper>
                
                {/* Tip */}
                <Paper sx={{ 
                  p: 2, 
                  bgcolor: '#FFFBEB', 
                  borderRadius: 2,
                  border: '1px solid #FDE68A',
                  display: 'flex',
                  gap: 1.5,
                  alignItems: 'flex-start',
                }}>
                  <TipIcon sx={{ color: '#D97706', fontSize: 20, mt: 0.25 }} />
                  <Box>
                    <Typography variant="body2Bold" sx={{ color: '#92400E', mb: 0.5 }}>
                      Tip
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#78350F', lineHeight: 1.5 }}>
                      {step.tip}
                    </Typography>
                  </Box>
                </Paper>
                
                {/* Navigation */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
                  <Button
                    disabled={activeStep === 0}
                    onClick={handleBack}
                    sx={{ color: '#6B7280', '&:hover': { bgcolor: '#F3F4F6' } }}
                  >
                    ← Back
                  </Button>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {activeStep === steps.length - 1 ? (
                      <Button
                        variant="contained"
                        onClick={onClose}
                        startIcon={<CheckIcon />}
                        sx={{ 
                          bgcolor: '#10B981', 
                          '&:hover': { bgcolor: '#059669' },
                          textTransform: 'none',
                          fontWeight: 600,
                          px: 3,
                        }}
                      >
                        Get Started!
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        onClick={handleNext}
                        endIcon={<ArrowIcon />}
                        sx={{ 
                          bgcolor: currentColor, 
                          '&:hover': { bgcolor: currentColor, filter: 'brightness(0.9)' },
                          textTransform: 'none',
                          fontWeight: 600,
                          px: 3,
                        }}
                      >
                        Next Step
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        
        {/* Footer - Workflow Summary */}
        <Box sx={{ 
          px: 3,
          py: 2, 
          borderTop: 1, 
          borderColor: '#E5E7EB',
          bgcolor: '#F9FAFB',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}>
          <Typography variant="caption1" sx={{ color: '#6B7280', mr: 1 }}>Workflow:</Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#DBEAFE', borderRadius: 1 }}>
            <UploadIcon sx={{ fontSize: 14, color: '#2563EB' }} />
            <Typography variant="caption1" sx={{ color: '#1E40AF', fontWeight: 500 }}>Schema</Typography>
          </Box>
          <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#E0F2FE', borderRadius: 1 }}>
            <ReadSchemaIcon sx={{ fontSize: 14, color: '#0284C7' }} />
            <Typography variant="caption1" sx={{ color: '#0369A1', fontWeight: 500 }}>Read Schema</Typography>
          </Box>
          <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#D1FAE5', borderRadius: 1 }}>
            <AutoMapIcon sx={{ fontSize: 14, color: '#059669' }} />
            <Typography variant="caption1" sx={{ color: '#065F46', fontWeight: 500 }}>Map</Typography>
          </Box>
          <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#FEF3C7', borderRadius: 1 }}>
            <MigrationIcon sx={{ fontSize: 14, color: '#D97706' }} />
            <Typography variant="caption1" sx={{ color: '#92400E', fontWeight: 500 }}>Order</Typography>
          </Box>
          <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#FCE7F3', borderRadius: 1 }}>
            <TransformIcon sx={{ fontSize: 14, color: '#DB2777' }} />
            <Typography variant="caption1" sx={{ color: '#9D174D', fontWeight: 500 }}>Transform</Typography>
          </Box>
          <ArrowIcon sx={{ fontSize: 14, color: '#9CA3AF' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#E0F2FE', borderRadius: 1 }}>
            <RunIcon sx={{ fontSize: 14, color: '#0284C7' }} />
            <Typography variant="caption1" sx={{ color: '#0369A1', fontWeight: 500 }}>Run</Typography>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

export default HelpGuide;
