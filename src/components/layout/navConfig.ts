/**
 * What the sidebar shows, and in what order.
 *
 * The list used to be flat: eleven equal-looking rows, with no hint that Read
 * Schema comes before Table Mappings or that SQL Analyzer is a side tool you
 * may never open. It is now grouped by subject, with the two configuration
 * pages first because those are what you set up first and return to most.
 *
 * Within a group, an item either carries a `step` number — it is part of the
 * migration path, and the sidebar ticks it once its work exists — or it does
 * not, in which case it is a helper that supports that group's subject.
 *
 * This module is data only. Whether a step is DONE is derived separately in
 * useNavStatus, because that depends on live application state and this does
 * not.
 */
import type { SvgIconComponent } from '@mui/icons-material';
import {
  AccountTree as MappingIcon,
  Timeline as OrderIcon,
  Storage as SQLIcon,
  AutoFixHigh as AutoMapIcon,
  Transform as TransformIcon,
  Sync as MigrateIcon,
  Schema as SchemaIcon,
  CloudDownload as ReadSchemaIcon,
  Code as SchemaDdlIcon,
  SettingsEthernet as ConnectionIcon,
  Inventory2 as SavedConfigIcon,
} from '@mui/icons-material';

export interface NavItem {
  /** Route path. These are unchanged from the original flat list — existing
   *  bookmarks and links must keep working. */
  path: string;
  label: string;
  icon: SvgIconComponent;
  /** Fallback secondary line, used when useNavStatus has nothing live to say. */
  description: string;
  /** Set only on workflow steps; absent means "helper page". */
  step?: number;
  /** A step you can legitimately skip. Shown, but never nags. */
  optional?: boolean;
}

export interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'configuration',
    title: 'Configuration',
    items: [
      {
        path: '/connection',
        label: 'Connection',
        icon: ConnectionIcon,
        description: 'Database connection settings',
      },
      {
        path: '/configurations',
        label: 'Saved Configs',
        icon: SavedConfigIcon,
        description: 'Configurations saved in the database',
      },
    ],
  },
  {
    id: 'schema',
    title: 'Schema',
    items: [
      {
        path: '/read-schema',
        label: 'Read Schema',
        icon: ReadSchemaIcon,
        description: 'Fetch schema from database',
        step: 1,
      },
      // Deliberately not a step: viewing the schema is satisfied by exactly the
      // same state as fetching it, so numbering both would tick two steps at
      // once and tell you nothing.
      {
        path: '/schema',
        label: 'Schema',
        icon: SchemaIcon,
        description: 'View database schemas',
      },
      {
        path: '/schema-ddl',
        label: 'Schema DDL',
        icon: SchemaDdlIcon,
        description: 'View schema as CREATE TABLE DDL',
      },
      {
        path: '/sql-analyzer',
        label: 'SQL Analyzer',
        icon: SQLIcon,
        description: 'Analyze SQL files',
      },
    ],
  },
  {
    id: 'mapping',
    title: 'Mapping',
    items: [
      {
        path: '/auto-mapping',
        label: 'Auto Mapping',
        icon: AutoMapIcon,
        description: 'Auto-generate mappings',
        step: 2,
        optional: true,
      },
      {
        path: '/table-mappings',
        label: 'Table Mappings',
        icon: MappingIcon,
        description: 'Configure mappings',
        step: 3,
      },
      {
        path: '/mapping-order',
        label: 'Mapping Order',
        icon: OrderIcon,
        description: 'Set table copy/migration order',
        step: 4,
      },
    ],
  },
  {
    id: 'run',
    title: 'Run',
    items: [
      {
        path: '/run-migration',
        label: 'Run Migration',
        icon: MigrateIcon,
        description: 'Execute migration',
        step: 5,
      },
      {
        path: '/data-transform',
        label: 'Data Transform',
        icon: TransformIcon,
        description: 'Transform CSV data',
      },
    ],
  },
];

/** Every item, flattened — for route lookups and the page header. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Workflow steps in order. Derived, so renumbering above is enough. */
export const STEPS: NavItem[] = NAV_ITEMS.filter((item) => item.step !== undefined).sort(
  (a, b) => (a.step ?? 0) - (b.step ?? 0),
);

export const TOTAL_STEPS = STEPS.length;

/** The nav item for a path, together with the section it lives in. */
export function findNavItem(path: string): { item: NavItem; section: NavSection } | undefined {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((candidate) => candidate.path === path);
    if (item) return { item, section };
  }
  return undefined;
}

/** The step after this one, or undefined on a helper page or the last step. */
export function nextStep(path: string): NavItem | undefined {
  const index = STEPS.findIndex((item) => item.path === path);
  if (index === -1) return undefined;
  return STEPS[index + 1];
}
