/**
 * The application sidebar.
 *
 * Lifted out of App.tsx, where it was ~265 lines of inline JSX around a flat
 * eleven-item array. The visual language (gradient, active-item treatment,
 * bottom actions) is unchanged; what is new is the grouping and the step
 * badges, which come from navConfig and useNavStatus respectively.
 */
import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Tooltip,
  Collapse,
} from '@mui/material';
import {
  Check as DoneIcon,
  Refresh as ResetIcon,
  Help as HelpIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
  ExpandMore as SectionChevron,
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_SECTIONS, TOTAL_STEPS, type NavItem } from './navConfig';
import { useNavStatus, type ConfigLoadState, type NavStatus } from './useNavStatus';

export const SIDEBAR_WIDTH_EXPANDED = 260;
export const SIDEBAR_WIDTH_COLLAPSED = 64;

/**
 * Sidebar palette — Dark Slate Gray, from the brand set.
 *
 * A white sidebar barely used the palette; this puts its strongest colour where
 * it carries the whole frame. Every pairing below is measured against the
 * #2A4954 ground:
 *
 *   Deep Saffron active   4.52:1   text
 *   Label (primary.200)   6.66:1   text
 *   Muted (primary.300)   4.78:1   text
 *   Iguana Green tick     4.01:1   icon (needs 3:1, not 4.5:1)
 *
 * primary.400 (#6494A3) is deliberately NOT used for text here — it lands at
 * 2.89:1 on this ground and would be unreadable.
 */
const SURFACE = '#2A4954'; // Dark Slate Gray
const ACCENT = '#FF9933'; // Deep Saffron — the active item
const TICK = '#73B682'; // Iguana Green — a completed step
const LABEL = '#C7DADF'; // nav labels
const MUTED = '#9CBCC6'; // section headers, secondary detail
const BORDER = 'rgba(255, 255, 255, 0.10)';
const ACTIVE_BG = 'rgba(255, 255, 255, 0.10)';
const HOVER_BG = 'rgba(255, 255, 255, 0.06)';
const TEXT = '#FFFFFF';

/**
 * Which section headers are folded shut.
 *
 * Kept in localStorage but deliberately NOT in SIGN_OUT_KEYS: this is a display
 * preference holding no user data, exactly like the help-guide flag. Re-opening
 * every section at each sign-in would be a small, pointless annoyance.
 */
const FOLDED_SECTIONS_KEY = 'erp_migration_sidebar_sections';

function loadFoldedSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLDED_SECTIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onShowHelp: () => void;
  onReset: () => void;
  /** Reset only makes sense once something is loaded to reset to. */
  canReset: boolean;
  configLoadState: ConfigLoadState;
}

/** The number-or-tick marker to the left of a step's icon. */
function StepBadge({ step, done }: { step: number; done: boolean }) {
  return (
    <Box
      sx={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        bgcolor: done ? 'rgba(115, 182, 130, 0.18)' : 'rgba(255, 255, 255, 0.08)',
        color: done ? TICK : MUTED,
        border: `1px solid ${done ? 'rgba(115, 182, 130, 0.45)' : BORDER}`,
      }}
    >
      {done ? <DoneIcon sx={{ fontSize: 13 }} /> : step}
    </Box>
  );
}

function detailColor(tone: NavStatus['tone']): string {
  if (tone === 'ok') return TICK;
  if (tone === 'warn') return ACCENT;
  return MUTED;
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  onShowHelp,
  onReset,
  canReset,
  configLoadState,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const status = useNavStatus(configLoadState);
  const [foldedSections, setFoldedSections] = useState<Record<string, boolean>>(loadFoldedSections);

  const toggleSection = (id: string) => {
    setFoldedSections((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        localStorage.setItem(FOLDED_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // A preference that cannot be stored is not worth failing over.
      }
      return next;
    });
  };

  // The section holding the current page is always shown, even if it is folded
  // shut — a sidebar with no visible active item looks broken. The stored
  // preference is left alone, so it folds again once you navigate away.
  const activeSectionId = NAV_SECTIONS.find((section) =>
    section.items.some((item) => item.path === location.pathname),
  )?.id;

  const renderItem = (item: NavItem) => {
    const isActive = location.pathname === item.path;
    const itemStatus = status[item.path];
    const done = itemStatus?.done ?? false;
    const secondary = itemStatus?.detail ?? item.description;

    // Hovering explains the row in full — the second line is clipped to keep
    // every row the same height, and when collapsed there is no text at all.
    const stepPrefix = item.step ? `Step ${item.step} of ${TOTAL_STEPS} · ` : '';
    const tooltip = collapsed ? `${stepPrefix}${item.label} — ${secondary}` : secondary;

    return (
      <ListItem key={item.path} disablePadding sx={{ px: 1.5, mb: 0.5 }}>
        <Tooltip title={tooltip} placement="right">
          <ListItemButton
            selected={isActive}
            onClick={() => navigate(item.path)}
            sx={{
              borderRadius: 2,
              minHeight: 48,
              justifyContent: collapsed ? 'center' : 'flex-start',
              px: 1.5,
              gap: collapsed ? 0 : 1,
              bgcolor: isActive ? ACTIVE_BG : 'transparent',
              border: '1px solid transparent',
              '&:hover': {
                bgcolor: isActive ? ACTIVE_BG : HOVER_BG,
              },
            }}
          >
            {/* Expanded: the badge sits in its own column so helper rows and
                step rows keep their icons on the same vertical line. */}
            {!collapsed &&
              (item.step ? (
                <StepBadge step={item.step} done={done} />
              ) : (
                <Box sx={{ width: 20, flexShrink: 0 }} />
              ))}

            <ListItemIcon
              sx={{
                minWidth: collapsed ? 0 : 30,
                color: isActive ? ACCENT : MUTED,
                justifyContent: 'center',
                // Collapsed there is no room for a badge beside the icon, so a
                // step's state becomes a dot on the icon's shoulder.
                position: 'relative',
              }}
            >
              <item.icon sx={{ fontSize: 22 }} />
              {collapsed && item.step !== undefined && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: -2,
                    right: 2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: done ? TICK : 'rgba(255, 255, 255, 0.35)',
                    border: `1.5px solid ${SURFACE}`,
                  }}
                />
              )}
            </ListItemIcon>

            {!collapsed && (
              <ListItemText
                sx={{ my: 0 }}
                primary={item.label}
                secondary={secondary}
                primaryTypographyProps={{
                  variant: 'body2',
                  noWrap: true,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? ACCENT : LABEL,
                }}
                secondaryTypographyProps={{
                  variant: 'caption',
                  noWrap: true,
                  color: detailColor(itemStatus?.tone),
                  fontSize: '10px',
                }}
              />
            )}
          </ListItemButton>
        </Tooltip>
      </ListItem>
    );
  };

  return (
    <Box
      sx={{
        width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED,
        flexShrink: 0,
        bgcolor: SURFACE,
        borderRight: `1px solid ${BORDER}`,
        boxShadow: '2px 0 12px rgba(39, 38, 38, 0.10)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.3s ease',
        overflow: 'hidden',
      }}
    >
      {/* Logo Header */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: `1px solid ${BORDER}`,
          minHeight: 64,
        }}
      >
        {!collapsed ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="h3Bold"
              sx={{ color: TEXT }}
            >
              ⬡ DataMigrate
            </Typography>
            <Chip
              label="v1.0"
              size="small"
              sx={{
                bgcolor: 'rgba(255, 153, 51, 0.18)',
                color: ACCENT,
                fontSize: '10px',
                height: '18px',
              }}
            />
          </Box>
        ) : (
          <Typography
            variant="h2Bold"
            sx={{ color: ACCENT }}
          >
            ⬡
          </Typography>
        )}
      </Box>

      {/* Grouped navigation */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 1.5 }}>
        {NAV_SECTIONS.map((section, index) => {
          // Folding needs a header to click, and at 64px there is no header —
          // so a collapsed sidebar always shows everything. Without this you
          // could fold a section, collapse the sidebar, and have no way back.
          const folded =
            !collapsed && Boolean(foldedSections[section.id]) && section.id !== activeSectionId;

          const steps = section.items.filter((item) => item.step !== undefined);
          const doneSteps = steps.filter((item) => status[item.path]?.done).length;

          return (
            <Box key={section.id} component="section">
              {collapsed ? (
                // No room for a heading at 64px; a rule keeps the grouping
                // legible without one.
                index > 0 && (
                  <Divider sx={{ borderColor: BORDER, mx: 1.5, my: 1 }} />
                )
              ) : (
                <ListItemButton
                  onClick={() => toggleSection(section.id)}
                  sx={{
                    px: 2.5,
                    py: 0.5,
                    mt: index === 0 ? 0.5 : 1.5,
                    mb: 0.75,
                    gap: 0.75,
                    borderRadius: 0,
                    '&:hover': { bgcolor: HOVER_BG },
                  }}
                >
                  <Typography
                    sx={{
                      flex: 1,
                      color: MUTED,
                      fontSize: '10px',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {section.title}
                  </Typography>

                  {/* Folded away, the progress is the one thing worth keeping
                      on screen — otherwise hiding a section hides its state. */}
                  {folded && steps.length > 0 && (
                    <Typography
                      sx={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: doneSteps === steps.length ? TICK : MUTED,
                      }}
                    >
                      {doneSteps}/{steps.length}
                    </Typography>
                  )}

                  <SectionChevron
                    sx={{
                      fontSize: 16,
                      color: MUTED,
                      transform: folded ? 'rotate(-90deg)' : 'none',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </ListItemButton>
              )}

              <Collapse in={!folded} timeout="auto" unmountOnExit>
                <List disablePadding>{section.items.map(renderItem)}</List>
              </Collapse>
            </Box>
          );
        })}
      </Box>

      <Divider sx={{ borderColor: BORDER, mx: 1.5 }} />

      {/* Bottom Actions */}
      <Box sx={{ p: 1.5 }}>
        <ListItem disablePadding sx={{ mb: 0.5 }}>
          <Tooltip title={collapsed ? 'Help Guide' : ''} placement="right">
            <ListItemButton
              onClick={onShowHelp}
              sx={{
                borderRadius: 2,
                minHeight: 44,
                justifyContent: collapsed ? 'center' : 'flex-start',
                px: collapsed ? 1.5 : 2,
                '&:hover': { bgcolor: HOVER_BG },
              }}
            >
              <ListItemIcon
                sx={{ minWidth: collapsed ? 0 : 40, color: MUTED, justifyContent: 'center' }}
              >
                <HelpIcon sx={{ fontSize: 20 }} />
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary="Help Guide"
                  primaryTypographyProps={{ variant: 'body2', color: LABEL }}
                />
              )}
            </ListItemButton>
          </Tooltip>
        </ListItem>

        {canReset && (
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <Tooltip title={collapsed ? 'Reset Data' : ''} placement="right">
              <ListItemButton
                onClick={onReset}
                sx={{
                  borderRadius: 2,
                  minHeight: 44,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  px: collapsed ? 1.5 : 2,
                  '&:hover': { bgcolor: 'rgba(192, 69, 60, 0.20)' },
                }}
              >
                <ListItemIcon
                  sx={{ minWidth: collapsed ? 0 : 40, color: '#E5978F', justifyContent: 'center' }}
                >
                  <ResetIcon sx={{ fontSize: 20 }} />
                </ListItemIcon>
                {!collapsed && (
                  <ListItemText
                    primary="Reset Data"
                    primaryTypographyProps={{ variant: 'body2', color: '#E5978F' }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        )}

        <ListItem disablePadding>
          <Tooltip title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} placement="right">
            <ListItemButton
              onClick={onToggleCollapse}
              sx={{
                borderRadius: 2,
                minHeight: 44,
                justifyContent: collapsed ? 'center' : 'flex-start',
                px: collapsed ? 1.5 : 2,
                '&:hover': { bgcolor: HOVER_BG },
              }}
            >
              <ListItemIcon
                sx={{ minWidth: collapsed ? 0 : 40, color: MUTED, justifyContent: 'center' }}
              >
                {collapsed ? <ExpandIcon sx={{ fontSize: 20 }} /> : <CollapseIcon sx={{ fontSize: 20 }} />}
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary="Collapse"
                  primaryTypographyProps={{ variant: 'body2', color: LABEL }}
                />
              )}
            </ListItemButton>
          </Tooltip>
        </ListItem>
      </Box>
    </Box>
  );
}
