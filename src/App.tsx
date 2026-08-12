import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, Button } from '@mui/material';
import {
  ChevronRight as CollapseRightIcon,
  KeyboardDoubleArrowLeft as ExpandLeftIcon,
  ArrowForward as NextStepIcon,
} from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from './store';
import { clearSchema as clearSourceSchema } from './features/sourceSchema/sourceSchemaSlice';
import { clearSchema as clearTargetSchema } from './features/targetSchema/targetSchemaSlice';
import { clearPersistedData, getPersistedMappings } from './features/mapping/mappingSlice';
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
import { ConnectionSettingsPage, restoreConnectionSettings } from './features/connection';
import { LoginPage, UserMenu, RequireAuth, bootstrapAuth } from './features/auth';
import {
  ConfigurationsPage,
  SaveChangesBar,
  applyConfiguration,
  getActiveConfiguration,
} from './features/configurations';
import { listConfigurations } from './api/endpoints/configurations';
import { selectAuth } from './features/auth';
import { ErrorBoundary } from './components/feedback';
import { Sidebar, NAV_ITEMS, TOTAL_STEPS, findNavItem, nextStep } from './components/layout';

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

/** The main application: sidebar, page header and the routed content area. */
function AppShell() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const active = findNavItem(location.pathname);
  const activeItem = active?.item ?? NAV_ITEMS[0];
  const activeSection = active?.section;
  const upcoming = nextStep(location.pathname);
  const { appDbReachable } = useAppSelector(selectAuth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(() => {
    const hasSeenGuide = localStorage.getItem('erp_migration_seen_guide');
    return !hasSeenGuide;
  });
  
  const handleCloseHelpGuide = () => {
    localStorage.setItem('erp_migration_seen_guide', 'true');
    setShowHelpGuide(false);
  };
  
  /** What is currently loaded, and where it came from. */
  const [dataSource, setDataSource] = useState<{
    loaded: boolean;
    from: 'database' | 'none' | 'error' | 'pending';
    name?: string;
    version?: number;
  }>({ loaded: false, from: 'pending' });

  /**
   * This browser holds a draft that differs from what the database returned.
   * Surfaced rather than ignored: the draft may be newer work that has never
   * been saved, and quietly showing the smaller set is how it gets lost.
   */
  const [draftMismatch, setDraftMismatch] = useState<{ inBrowser: number; loaded: number } | null>(
    null,
  );

  const handleResetData = () => {
    if (
      window.confirm(
        'Discard local changes?\n\n' +
          'This clears the unsaved draft in this browser and reloads the saved ' +
          'configuration from the database. Saved configurations and their ' +
          'version history are not affected.',
      )
    ) {
      // Only the local draft is cleared. The database is the record, so
      // "reset" now means "throw away my unsaved edits", not "wipe the data".
      clearAllAppData();
      dispatch(clearPersistedData());
      dispatch(clearSourceSchema());
      dispatch(clearTargetSchema());
      localStorage.removeItem('erp_migration_seen_guide');

      const pointer = getActiveConfiguration();
      if (pointer) {
        void dispatch(applyConfiguration({ configurationId: pointer.configurationId }))
          .unwrap()
          .then((summary) =>
            setDataSource({ loaded: true, from: 'database', name: summary.name, version: summary.version }),
          )
          .catch(() => setDataSource({ loaded: false, from: 'error' }));
      } else {
        setDataSource({ loaded: false, from: 'none' });
      }
    }
  };

  // The API server keeps connection settings in memory only, so re-send the
  // ones saved in this browser. Runs before any page reads a schema, and is a
  // no-op when nothing has been configured in the Connection tab.
  useEffect(() => {
    void restoreConnectionSettings();
  }, []);

  /**
   * Load the working data.
   *
   * The metadata database is the record. This reopens whichever saved
   * configuration this browser was last working on — schemas, mappings, order
   * and run options together — instead of rebuilding state from localStorage
   * and bundled JSON files.
   *
   * localStorage is still read, but only as a DRAFT: unsaved edits made since
   * the last save. It is never preferred over the database, and it is never
   * the source of a configuration.
   */
  useEffect(() => {
    if (!appDbReachable) return;

    let cancelled = false;

    void (async () => {
      const pointer = getActiveConfiguration();
      let configurationId = pointer?.configurationId ?? null;

      // No bookmark yet: fall back to the most recently updated configuration
      // so a fresh browser opens something rather than nothing.
      if (configurationId === null) {
        try {
          const configurations = await listConfigurations();
          configurationId = configurations[0]?.id ?? null;
        } catch {
          configurationId = null;
        }
      }

      if (configurationId === null || cancelled) {
        setDataSource({ loaded: false, from: 'none' });
        return;
      }

      try {
        const summary = await dispatch(applyConfiguration({ configurationId })).unwrap();
        if (cancelled) return;
        setDataSource({ loaded: true, from: 'database', name: summary.name, version: summary.version });

        // Loading from the database replaced what was on screen. If this
        // browser holds a draft that does NOT match what we just loaded, say
        // so — silently showing fewer mappings than the user had is how work
        // gets lost without anyone noticing.
        const draft = getPersistedMappings();
        if (draft && draft.length !== summary.tableMappings) {
          setDraftMismatch({ inBrowser: draft.length, loaded: summary.tableMappings });
        }
      } catch {
        // A configuration that will not load must not blank the app — every
        // page still works, just without a loaded configuration.
        if (!cancelled) setDataSource({ loaded: false, from: 'error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch, appDbReachable]);

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'neutral.100' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onShowHelp={() => setShowHelpGuide(true)}
        onReset={handleResetData}
        canReset={dataSource.loaded}
        configLoadState={dataSource.from}
      />

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
                    {/* Where this page sits: which group, and — on a workflow
                        page — how far along the migration path you are. */}
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        color: 'neutral.400',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {activeSection?.title ?? ''}
                      {activeItem.step !== undefined &&
                        ` · Step ${activeItem.step} of ${TOTAL_STEPS}`}
                    </Typography>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="caption" sx={{ color: 'neutral.400', display: { xs: 'none', lg: 'block' } }}>
              ERP Data Migration Tool
            </Typography>
            {/* On a workflow page, the obvious next move. Helper pages have no
                "next", so nothing is shown there. */}
            {upcoming && (
              <Button
                size="small"
                endIcon={<NextStepIcon fontSize="small" />}
                onClick={() => navigate(upcoming.path)}
                sx={{ textTransform: 'none', color: 'primary.main' }}
              >
                Next: {upcoming.label}
              </Button>
            )}
            <SaveChangesBar />
            <UserMenu />
          </Box>
        </Box>

        {/* This browser holds work that the loaded configuration does not. */}
        {draftMismatch && (
          <Box
            sx={{
              px: 3,
              py: 1.25,
              bgcolor: '#FEF3C7',
              borderBottom: 1,
              borderColor: '#FCD34D',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Typography variant="caption1Medium" sx={{ color: '#92400E', flex: 1 }}>
              This browser has <strong>{draftMismatch.inBrowser}</strong> table mappings saved
              locally, but the configuration loaded from the database has{' '}
              <strong>{draftMismatch.loaded}</strong>. Your local copy has not been touched — save it
              as a new version to keep it.
            </Typography>
            <Chip
              label="Open Saved Configs"
              size="small"
              onClick={() => navigate('/configurations')}
              sx={{ bgcolor: '#F59E0B', color: '#fff', cursor: 'pointer' }}
            />
            <Chip
              label="Dismiss"
              size="small"
              variant="outlined"
              onClick={() => setDraftMismatch(null)}
              sx={{ cursor: 'pointer', borderColor: '#D97706', color: '#92400E' }}
            />
          </Box>
        )}

        {/* Content Area */}
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          {/* Keyed on the path so navigating away from a crashed page recovers. */}
          <ErrorBoundary key={location.pathname} label={activeItem.label}>
          <Routes>
            <Route path="/" element={<Navigate to="/read-schema" replace />} />
            <Route path="/connection" element={<ConnectionSettingsPage />} />
            <Route path="/read-schema" element={<ReadSchemaPage />} />
            <Route path="/schema-ddl" element={<SchemaDdlPage />} />
            <Route path="/schema" element={<SchemaViewerPage />} />
            <Route path="/sql-analyzer" element={<SQLAnalyzerPage />} />
            <Route path="/auto-mapping" element={<AutoMappingPage />} />
            <Route path="/mapping-order" element={<MigrationOrderPage />} />
            <Route path="/table-mappings" element={<TableMappingsView />} />
            <Route path="/configurations" element={<ConfigurationsPage />} />
            <Route path="/data-transform" element={<DataTransformerPage />} />
            <Route path="/run-migration" element={<MigrationPage />} />
            <Route path="*" element={<Navigate to="/read-schema" replace />} />
          </Routes>
          </ErrorBoundary>
        </Box>
      </Box>

      {/* Help Guide Dialog */}
      <HelpGuide open={showHelpGuide} onClose={handleCloseHelpGuide} />
    </Box>
  );
}

/**
 * Top-level routing.
 *
 * The login screen deliberately sits OUTSIDE the shell — it has no sidebar,
 * no page header and no user menu, so it cannot be rendered inside AppShell.
 * Everything else keeps the layout it has always had.
 */
function App() {
  const dispatch = useAppDispatch();

  // One probe at startup: is auth enforced, is the metadata database there,
  // and does the stored token still identify anyone? Both endpoints are
  // unguarded and safe with no metadata database, and failure is non-fatal —
  // every pre-existing page works without it.
  useEffect(() => {
    void dispatch(bootstrapAuth());
  }, [dispatch]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
