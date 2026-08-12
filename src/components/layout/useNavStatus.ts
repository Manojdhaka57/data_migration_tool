/**
 * Live state for each sidebar row: is this step done, and what should its
 * second line say.
 *
 * "Done" means THE STATE THIS STEP PRODUCES EXISTS — not that you opened the
 * page. That distinction is the whole point: a tick you earn by clicking is
 * decoration, a tick you earn by having 155 mappings loaded is information.
 * Everything here is derived from selectors that already exist, so it updates
 * itself and cannot go stale.
 *
 * Every selector passed to useAppSelector below must return a REFERENCE-STABLE
 * value. Selectors that build a new object or array on each call (selectSourceStats,
 * selectGroupedByLevel, selectSortedDependencies) would return a fresh reference
 * for every dispatched action and re-render the sidebar constantly — so the raw
 * state is selected and the derived numbers are computed in the useMemo instead.
 */
import { useMemo } from 'react';
import { useAppSelector } from '../../store';
import { selectSourceSchema, selectSourceIsLoaded } from '../../features/sourceSchema/sourceSchemaSlice';
import { selectTargetSchema, selectTargetIsLoaded } from '../../features/targetSchema/targetSchemaSlice';
import { selectTableMappings, selectValidationErrors } from '../../features/mapping/mappingSlice';
import {
  selectIsAnalyzed,
  selectCircularDependency,
  selectDependencies,
} from '../../features/migrationOrder/migrationOrderSlice';
import { selectMigrationResults } from '../../features/migration/migrationResultsSlice';
import { selectLoadedConfiguration } from '../../features/configurations/configurationSlice';

/** How the app-level configuration load went, mirrored from AppShell. */
export type ConfigLoadState = 'database' | 'none' | 'error' | 'pending';

export interface NavStatus {
  /** Step complete — the sidebar shows a tick instead of the number. */
  done: boolean;
  /** Replaces the static description on the row's second line. */
  detail?: string;
  tone?: 'ok' | 'warn';
}

/** Status by route path. Paths with nothing to say are simply absent. */
export type NavStatusMap = Record<string, NavStatus>;

export function useNavStatus(configLoadState: ConfigLoadState = 'pending'): NavStatusMap {
  const sourceSchema = useAppSelector(selectSourceSchema);
  const targetSchema = useAppSelector(selectTargetSchema);
  const sourceLoaded = useAppSelector(selectSourceIsLoaded);
  const targetLoaded = useAppSelector(selectTargetIsLoaded);
  const tableMappings = useAppSelector(selectTableMappings);
  const validationErrors = useAppSelector(selectValidationErrors);
  const isAnalyzed = useAppSelector(selectIsAnalyzed);
  const circularDependency = useAppSelector(selectCircularDependency);
  const dependencies = useAppSelector(selectDependencies);
  const results = useAppSelector(selectMigrationResults);
  const loadedConfiguration = useAppSelector(selectLoadedConfiguration);

  return useMemo(() => {
    const status: NavStatusMap = {};

    // --- Saved Configs: which configuration is open right now ---------------
    if (loadedConfiguration) {
      status['/configurations'] = {
        done: true,
        detail: `${loadedConfiguration.name} · v${loadedConfiguration.version}`,
        tone: 'ok',
      };
    } else if (configLoadState === 'error') {
      status['/configurations'] = { done: false, detail: 'Could not load — open to retry', tone: 'warn' };
    } else if (configLoadState === 'pending') {
      status['/configurations'] = { done: false, detail: 'Loading…' };
    } else {
      status['/configurations'] = { done: false, detail: 'None loaded — open one' };
    }

    // --- Step 1: schemas on both sides --------------------------------------
    const sourceTables = sourceSchema?.tables.length ?? 0;
    const targetTables = targetSchema?.tables.length ?? 0;
    status['/read-schema'] = {
      done: sourceLoaded && targetLoaded,
      detail:
        sourceLoaded || targetLoaded
          ? `${sourceTables} → ${targetTables} tables`
          : 'Fetch schema from database',
      tone: sourceLoaded && targetLoaded ? 'ok' : undefined,
    };

    // --- Step 2: mappings exist by any route --------------------------------
    // Keyed on the mappings themselves rather than autoMapping.mappingResult:
    // that slice is not persisted and is not restored by applyConfiguration, so
    // it would read "not done" after every reload even with a full config open.
    const hasMappings = tableMappings.length > 0;
    status['/auto-mapping'] = {
      done: hasMappings,
      detail: hasMappings ? `${tableMappings.length} mappings generated` : 'Optional — generates mappings',
      tone: hasMappings ? 'ok' : undefined,
    };

    // --- Step 3: mappings, and whether any are complaining -------------------
    status['/table-mappings'] = {
      done: hasMappings,
      detail: hasMappings
        ? validationErrors.length > 0
          ? `${tableMappings.length} mappings · ${validationErrors.length} need attention`
          : `${tableMappings.length} mappings`
        : 'Configure mappings',
      tone: validationErrors.length > 0 ? 'warn' : hasMappings ? 'ok' : undefined,
    };

    // --- Step 4: dependency order analysed, and acyclic ----------------------
    // Honest limitation: isAnalyzed is only set by the Mapping Order page, so
    // this stays unticked until that page is opened at least once.
    const levels = new Set(dependencies.map((dep) => dep.level)).size;
    if (circularDependency) {
      status['/mapping-order'] = { done: false, detail: 'Circular dependency found', tone: 'warn' };
    } else if (isAnalyzed) {
      status['/mapping-order'] = {
        done: true,
        detail: `${dependencies.length} tables · ${levels} levels`,
        tone: 'ok',
      };
    } else {
      status['/mapping-order'] = { done: false, detail: 'Set table copy/migration order' };
    }

    // --- Step 5: a real run, not a dry run -----------------------------------
    const lastRealRun = results.find((result) => !result.dryRun);
    if (lastRealRun) {
      status['/run-migration'] = {
        done: lastRealRun.failedTables === 0,
        detail:
          lastRealRun.failedTables === 0
            ? `Last run ${lastRealRun.successTables}/${lastRealRun.totalTables} tables`
            : `Last run failed ${lastRealRun.failedTables} of ${lastRealRun.totalTables}`,
        tone: lastRealRun.failedTables === 0 ? 'ok' : 'warn',
      };
    } else {
      status['/run-migration'] = { done: false, detail: 'Execute migration' };
    }

    return status;
  }, [
    configLoadState,
    loadedConfiguration,
    sourceSchema,
    targetSchema,
    sourceLoaded,
    targetLoaded,
    tableMappings,
    validationErrors,
    isAnalyzed,
    circularDependency,
    dependencies,
    results,
  ]);
}
