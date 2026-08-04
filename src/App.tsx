import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  AccountTree as MappingIcon,
  Timeline as OrderIcon,
  Storage as SQLIcon,
  AutoFixHigh as AutoMapIcon,
  Transform as TransformIcon,
  Sync as MigrateIcon,
  ChevronRight as CollapseRightIcon,
  KeyboardDoubleArrowLeft as ExpandLeftIcon,
  Refresh as ResetIcon,
  Help as HelpIcon,
  Schema as SchemaIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
} from '@mui/icons-material';
import { useAppDispatch } from './store';
import { 
  setSchema as setSourceSchema, 
  loadSchemaFromStorage as loadSourceSchemaFromStorage,
  hasPersistedSourceSchema,
  clearSchema as clearSourceSchema,
} from './features/sourceSchema/sourceSchemaSlice';
import { 
  setSchema as setTargetSchema, 
  loadSchemaFromStorage as loadTargetSchemaFromStorage,
  hasPersistedTargetSchema,
  clearSchema as clearTargetSchema,
} from './features/targetSchema/targetSchemaSlice';
import { loadMappings, hasPersistedMappings, getPersistedMappings, clearPersistedData } from './features/mapping/mappingSlice';
import { sourceSchema, targetSchema, initialMappings } from './data';
import { clearAllAppData } from './utils/localStorage';
import { MappingCanvas } from './features/mapping';
import { PreviewPanel } from './features/preview';
import { MigrationOrderPage } from './features/migrationOrder';
import { SQLAnalyzerPage } from './features/sqlAnalyzer';
import { AutoMappingPage } from './features/autoMapping';
import { DataTransformerPage } from './features/dataTransformer';
import { MigrationPage } from './features/migration';
import { SchemaViewerPage } from './features/schema';
import { ReadSchemaPage } from './features/readSchema';
import { SchemaDdlPage } from './features/schemaDdl';
import { HelpGuide } from './components/shared';
import { CloudDownload as ReadSchemaIcon, Code as SchemaDdlIcon } from '@mui/icons-material';

// Navigation items — each tab is a real route. Order here drives the sidebar order.
const navItems = [
  { path: '/read-schema', label: 'Read Schema', icon: ReadSchemaIcon, description: 'Fetch schema from database' },
  { path: '/schema-ddl', label: 'Schema DDL', icon: SchemaDdlIcon, description: 'View schema as CREATE TABLE DDL' },
  { path: '/schema', label: 'Schema', icon: SchemaIcon, description: 'View database schemas' },
  { path: '/sql-analyzer', label: 'SQL Analyzer', icon: SQLIcon, description: 'Analyze SQL files' },
  { path: '/auto-mapping', label: 'Auto Mapping', icon: AutoMapIcon, description: 'Auto-generate mappings' },
  { path: '/mapping-order', label: 'Mapping Order', icon: OrderIcon, description: 'Set table copy/migration order' },
  { path: '/table-mappings', label: 'Table Mappings', icon: MappingIcon, description: 'Configure mappings' },
  { path: '/data-transform', label: 'Data Transform', icon: TransformIcon, description: 'Transform CSV data' },
  { path: '/run-migration', label: 'Run Migration', icon: MigrateIcon, description: 'Execute migration' },
];

// Table Mappings tab: the mapping canvas plus a collapsible preview panel.
function TableMappingsView() {
  const [showPreviewPanel, setShowPreviewPanel] = useState(false);
  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minWidth: 0, bgcolor: 'neutral.100' }}>
        <MappingCanvas />
      </Box>
      <Box
        sx={{
          width: showPreviewPanel ? 420 : 40,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'neutral.200',
          transition: 'width 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'white.main',
          position: 'relative',
        }}
      >
        {showPreviewPanel ? (
          <>
            <Tooltip title="Collapse Preview Panel" placement="left">
              <IconButton
                size="small"
                onClick={() => setShowPreviewPanel(false)}
                sx={{
                  position: 'absolute',
                  left: -12,
                  top: '20px',
                  bgcolor: 'info.main',
                  color: 'white.main',
                  width: 24,
                  height: 24,
                  zIndex: 10,
                  '&:hover': { bgcolor: 'info.600' },
                }}
              >
                <CollapseRightIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <PreviewPanel />
          </>
        ) : (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pt: 2,
              bgcolor: 'info.700',
            }}
          >
            <Tooltip title="Expand Preview Panel" placement="left">
              <IconButton
                size="small"
                onClick={() => setShowPreviewPanel(true)}
                sx={{ color: 'white.main', '&:hover': { bgcolor: 'info.600' } }}
              >
                <ExpandLeftIcon />
              </IconButton>
            </Tooltip>
            <Typography
              variant="caption"
              sx={{ writingMode: 'vertical-rl', textOrientation: 'mixed', color: 'white.main', mt: 2, letterSpacing: 1 }}
            >
              PREVIEW
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function App() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const activeItem = navItems.find((n) => n.path === location.pathname) ?? navItems[0];
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(() => {
    const hasSeenGuide = localStorage.getItem('erp_migration_seen_guide');
    return !hasSeenGuide;
  });
  
  const handleCloseHelpGuide = () => {
    localStorage.setItem('erp_migration_seen_guide', 'true');
    setShowHelpGuide(false);
  };
  
  const [dataSource, setDataSource] = useState<{
    mappings: 'localStorage' | 'file';
    sourceSchema: 'localStorage' | 'file';
    targetSchema: 'localStorage' | 'file';
  }>({ mappings: 'file', sourceSchema: 'file', targetSchema: 'file' });

  const handleResetData = () => {
    if (window.confirm('Are you sure you want to reset all data? This will clear localStorage and reload schemas and mappings from the default files.')) {
      clearAllAppData();
      dispatch(clearPersistedData());
      dispatch(loadMappings(initialMappings));
      dispatch(clearSourceSchema());
      dispatch(clearTargetSchema());
      dispatch(setSourceSchema(sourceSchema));
      dispatch(setTargetSchema(targetSchema));
      setDataSource({ mappings: 'file', sourceSchema: 'file', targetSchema: 'file' });
      localStorage.removeItem('erp_migration_seen_guide');
      console.log('🔄 All data reset - loaded from default files');
    }
  };

  useEffect(() => {
    type DataSourceType = 'localStorage' | 'file';
    const newDataSource: {
      mappings: DataSourceType;
      sourceSchema: DataSourceType;
      targetSchema: DataSourceType;
    } = { 
      mappings: 'file', 
      sourceSchema: 'file', 
      targetSchema: 'file' 
    };
    
    if (hasPersistedSourceSchema()) {
      dispatch(loadSourceSchemaFromStorage());
      newDataSource.sourceSchema = 'localStorage';
      console.log('📦 Loaded source schema from localStorage');
    } else {
    dispatch(setSourceSchema(sourceSchema));
      console.log('📄 Loaded source schema from default file');
    }
    
    if (hasPersistedTargetSchema()) {
      dispatch(loadTargetSchemaFromStorage());
      newDataSource.targetSchema = 'localStorage';
      console.log('📦 Loaded target schema from localStorage');
    } else {
    dispatch(setTargetSchema(targetSchema));
      console.log('📄 Loaded target schema from default file');
    }
    
    if (hasPersistedMappings()) {
      const persistedMappings = getPersistedMappings();
      if (persistedMappings) {
        console.log('📦 Loaded mappings from localStorage:', persistedMappings.length, 'mappings');
        dispatch(loadMappings(persistedMappings));
        newDataSource.mappings = 'localStorage';
      }
    } else {
      console.log('📄 Loaded mappings from JSON file:', initialMappings?.length, 'mappings');
    dispatch(loadMappings(initialMappings));
    }
    
    setDataSource(newDataSource);
  }, [dispatch]);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'neutral.100' }}>
      {/* Sidebar */}
      <Box
        sx={{
          width: sidebarWidth,
          flexShrink: 0,
          background: 'linear-gradient(180deg, #1E293B 0%, #0F172A 100%)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.3s ease',
          overflow: 'hidden',
          boxShadow: '4px 0 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Logo Header */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
            minHeight: 64,
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {!sidebarCollapsed && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography 
                variant="h3Bold" 
                sx={{ 
                  color: '#F8FAFC',
                  background: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                ⬡ DataMigrate
              </Typography>
              <Chip 
                label="v1.0" 
                size="small" 
                sx={{ 
                  bgcolor: 'rgba(16, 185, 129, 0.2)', 
                  color: '#10B981',
                  fontSize: '10px',
                  height: '18px',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }} 
              />
            </Box>
          )}
          {sidebarCollapsed && (
            <Typography 
              variant="h2Bold" 
              sx={{ 
                background: 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              ⬡
            </Typography>
          )}
        </Box>

        {/* Navigation Items */}
        <List sx={{ flex: 1, py: 2, overflow: 'auto' }}>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <ListItem key={item.path} disablePadding sx={{ px: 1.5, mb: 0.5 }}>
                <Tooltip title={sidebarCollapsed ? item.label : ''} placement="right">
                  <ListItemButton
                    selected={isActive}
                    onClick={() => navigate(item.path)}
                    sx={{
                      borderRadius: 2,
                      minHeight: 52,
                      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                      px: sidebarCollapsed ? 1.5 : 2,
                      bgcolor: isActive ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                      border: isActive ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid transparent',
                      '&:hover': {
                        bgcolor: isActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.08)',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: sidebarCollapsed ? 0 : 40,
                        color: isActive ? '#10B981' : '#94A3B8',
                        justifyContent: 'center',
                      }}
                    >
                      <item.icon sx={{ fontSize: 22 }} />
                    </ListItemIcon>
                    {!sidebarCollapsed && (
                      <ListItemText
                        primary={item.label}
                        secondary={item.description}
                        primaryTypographyProps={{
                          variant: 'body2',
                          fontWeight: isActive ? 600 : 500,
                          color: isActive ? '#F8FAFC' : '#CBD5E1',
                        }}
                        secondaryTypographyProps={{
                          variant: 'caption',
                          color: '#64748B',
                          fontSize: '10px',
                        }}
                      />
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            );
          })}
        </List>

        <Divider sx={{ borderColor: 'rgba(148, 163, 184, 0.1)', mx: 1.5 }} />

        {/* Bottom Actions */}
        <Box sx={{ p: 1.5 }}>
          {/* Help Button */}
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <Tooltip title={sidebarCollapsed ? 'Help Guide' : ''} placement="right">
              <ListItemButton
                onClick={() => setShowHelpGuide(true)}
                sx={{
                  borderRadius: 2,
                  minHeight: 44,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  px: sidebarCollapsed ? 1.5 : 2,
                  '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.08)' },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: sidebarCollapsed ? 0 : 40,
                    color: '#94A3B8',
                    justifyContent: 'center',
                  }}
                >
                  <HelpIcon sx={{ fontSize: 20 }} />
                </ListItemIcon>
                {!sidebarCollapsed && (
                  <ListItemText
                    primary="Help Guide"
                    primaryTypographyProps={{
                      variant: 'body2',
                      color: '#CBD5E1',
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>

          {/* Reset Button */}
          {(dataSource.sourceSchema === 'localStorage' || dataSource.targetSchema === 'localStorage' || dataSource.mappings === 'localStorage') && (
            <ListItem disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={sidebarCollapsed ? 'Reset Data' : ''} placement="right">
                <ListItemButton
                  onClick={handleResetData}
                  sx={{
                    borderRadius: 2,
                    minHeight: 44,
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    px: sidebarCollapsed ? 1.5 : 2,
                    '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.15)' },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: sidebarCollapsed ? 0 : 40,
                      color: '#F87171',
                      justifyContent: 'center',
                    }}
                  >
                    <ResetIcon sx={{ fontSize: 20 }} />
                  </ListItemIcon>
                  {!sidebarCollapsed && (
                    <ListItemText
                      primary="Reset Data"
                      primaryTypographyProps={{
                        variant: 'body2',
                        color: '#F87171',
                      }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          )}

          {/* Collapse Toggle */}
          <ListItem disablePadding>
            <Tooltip title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} placement="right">
              <ListItemButton
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                sx={{
                  borderRadius: 2,
                  minHeight: 44,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  px: sidebarCollapsed ? 1.5 : 2,
                  '&:hover': { bgcolor: 'rgba(148, 163, 184, 0.08)' },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: sidebarCollapsed ? 0 : 40,
                    color: '#94A3B8',
                    justifyContent: 'center',
                  }}
                >
                  {sidebarCollapsed ? <ExpandIcon sx={{ fontSize: 20 }} /> : <CollapseIcon sx={{ fontSize: 20 }} />}
                </ListItemIcon>
                {!sidebarCollapsed && (
                  <ListItemText
                    primary="Collapse"
                    primaryTypographyProps={{
                      variant: 'body2',
                      color: '#CBD5E1',
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        </Box>

        {/* Data Source Indicators */}
        {!sidebarCollapsed && (
          <Box sx={{ px: 2, pb: 2 }}>
            <Typography variant="caption" sx={{ color: '#64748B', fontSize: '9px', fontWeight: 500 }}>
              DATA SOURCES
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <Chip 
                size="small"
                label={`Source ${dataSource.sourceSchema === 'localStorage' ? '💾' : '📄'}`}
                sx={{ 
                  height: 20,
                  fontSize: '9px',
                  bgcolor: dataSource.sourceSchema === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.2)' 
                    : 'rgba(148, 163, 184, 0.1)',
                  color: dataSource.sourceSchema === 'localStorage' ? '#10B981' : '#94A3B8',
                  border: '1px solid',
                  borderColor: dataSource.sourceSchema === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.3)' 
                    : 'rgba(148, 163, 184, 0.2)',
                }}
              />
              <Chip 
                size="small"
                label={`Target ${dataSource.targetSchema === 'localStorage' ? '💾' : '📄'}`}
                sx={{ 
                  height: 20,
                  fontSize: '9px',
                  bgcolor: dataSource.targetSchema === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.2)' 
                    : 'rgba(148, 163, 184, 0.1)',
                  color: dataSource.targetSchema === 'localStorage' ? '#10B981' : '#94A3B8',
                  border: '1px solid',
                  borderColor: dataSource.targetSchema === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.3)' 
                    : 'rgba(148, 163, 184, 0.2)',
                }}
              />
              <Chip 
                size="small"
                label={`Maps ${dataSource.mappings === 'localStorage' ? '💾' : '📄'}`}
                sx={{ 
                  height: 20,
                  fontSize: '9px',
                  bgcolor: dataSource.mappings === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.2)' 
                    : 'rgba(148, 163, 184, 0.1)',
                  color: dataSource.mappings === 'localStorage' ? '#10B981' : '#94A3B8',
                  border: '1px solid',
                  borderColor: dataSource.mappings === 'localStorage' 
                    ? 'rgba(16, 185, 129, 0.3)' 
                    : 'rgba(148, 163, 184, 0.2)',
                }}
              />
            </Box>
          </Box>
        )}
      </Box>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Page Header */}
      <Box 
        sx={{ 
            px: 3,
            py: 2,
            bgcolor: 'white.main',
            borderBottom: 1,
            borderColor: 'neutral.200',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {(() => {
              const CurrentIcon = activeItem.icon;
              return (
                <>
                  <CurrentIcon sx={{ fontSize: 28, color: 'primary.main' }} />
                  <Box>
                    <Typography variant="h2Bold" sx={{ color: 'primary.main' }}>
                      {activeItem.label}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'neutral.500' }}>
                      {activeItem.description}
                    </Typography>
                  </Box>
                </>
              );
            })()}
          </Box>
          <Typography variant="caption" sx={{ color: 'neutral.400' }}>
            ERP Data Migration Tool
          </Typography>
        </Box>

        {/* Content Area */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/read-schema" replace />} />
            <Route path="/read-schema" element={<ReadSchemaPage />} />
            <Route path="/schema-ddl" element={<SchemaDdlPage />} />
            <Route path="/schema" element={<SchemaViewerPage />} />
            <Route path="/sql-analyzer" element={<SQLAnalyzerPage />} />
            <Route path="/auto-mapping" element={<AutoMappingPage />} />
            <Route path="/mapping-order" element={<MigrationOrderPage />} />
            <Route path="/table-mappings" element={<TableMappingsView />} />
            <Route path="/data-transform" element={<DataTransformerPage />} />
            <Route path="/run-migration" element={<MigrationPage />} />
            <Route path="*" element={<Navigate to="/read-schema" replace />} />
          </Routes>
        </Box>
      </Box>

      {/* Help Guide Dialog */}
      <HelpGuide open={showHelpGuide} onClose={handleCloseHelpGuide} />
    </Box>
  );
}

export default App;
