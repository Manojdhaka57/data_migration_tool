import { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Chip,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
} from '@mui/material';
import { Save as SaveIcon, SaveAs as SaveAsIcon } from '@mui/icons-material';
import { useAppDispatch, useAppSelector } from '../../store';
import { selectCan } from '../auth/authSlice';
import { selectLoadedConfiguration, selectConfigurationSaveState, clearSaveState } from './configurationSlice';
import { saveCurrentConfiguration, saveAsNewConfiguration } from './saveConfiguration';

/**
 * Always-available way to push the current editor state back to the loaded
 * configuration, from any page.
 *
 * There is no "unsaved changes" dot here on purpose. Whether anything actually
 * changed is decided by the server, which hashes the canonical snapshot;
 * re-implementing that in the browser would eventually disagree with it. So the
 * button is always live, and the answer comes back as either "saved as version
 * N" or "no changes".
 */
export default function SaveChangesBar() {
  const dispatch = useAppDispatch();
  const loaded = useAppSelector(selectLoadedConfiguration);
  const { saving, lastSave, error } = useAppSelector(selectConfigurationSaveState);
  const canWrite = useAppSelector(selectCan('operator'));
  const mappingCount = useAppSelector((s) => s.mapping.tableMappings.length);

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const save = async (withNote?: string) => {
    setNoteOpen(false);
    await dispatch(saveCurrentConfiguration({ note: withNote || undefined }));
    setNote('');
  };

  if (!loaded) {
    // Nothing loaded — offer to save what is in the editor as a new one.
    if (mappingCount === 0) return null;
    return (
      <>
        <Tooltip title={canWrite ? 'Save what is in the editor as a new configuration' : 'Requires the operator role'}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SaveAsIcon fontSize="small" />}
              disabled={!canWrite}
              onClick={() => setSaveAsOpen(true)}
              sx={{ textTransform: 'none' }}
            >
              Save as configuration
            </Button>
          </span>
        </Tooltip>
        <SaveAsDialog
          open={saveAsOpen}
          onClose={() => setSaveAsOpen(false)}
          name={newName}
          setName={setNewName}
          mappingCount={mappingCount}
          onSave={async () => {
            const result = await dispatch(saveAsNewConfiguration({ name: newName.trim() }));
            if (saveAsNewConfiguration.fulfilled.match(result)) {
              setSaveAsOpen(false);
              setNewName('');
            }
          }}
          saving={saving}
          error={error}
        />
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ textAlign: 'right', lineHeight: 1.2 }}>
        <Typography variant="caption1Medium" sx={{ display: 'block', color: 'neutral.800' }}>
          {loaded.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
          <Typography variant="caption2" sx={{ color: 'neutral.500' }}>
            v{loaded.version}
          </Typography>
          {lastSave && (
            <Chip
              size="small"
              label={lastSave.created ? `saved v${lastSave.version}` : 'no changes'}
              color={lastSave.created ? 'success' : 'default'}
              variant={lastSave.created ? 'filled' : 'outlined'}
              onClick={() => dispatch(clearSaveState())}
              sx={{ height: 16, fontSize: 9, cursor: 'pointer' }}
            />
          )}
          {error && (
            <Tooltip title={error}>
              <Chip size="small" label="save failed" color="error" sx={{ height: 16, fontSize: 9 }} />
            </Tooltip>
          )}
        </Box>
      </Box>

      <Tooltip
        title={
          canWrite
            ? 'Save the current schemas, mappings, order and run options as a new version of this configuration'
            : 'Requires the operator role'
        }
      >
        <span>
          <Button
            size="small"
            variant="contained"
            startIcon={saving ? <CircularProgress size={13} color="inherit" /> : <SaveIcon fontSize="small" />}
            disabled={!canWrite || saving}
            onClick={() => setNoteOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </span>
      </Tooltip>

      {/* Note dialog: a version is much easier to find later with a reason attached. */}
      <Dialog open={noteOpen} onClose={() => setNoteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Typography variant="h3Bold">Save changes to “{loaded.name}”</Typography>
          <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
            Creates version {loaded.version + 1}. Version {loaded.version} is kept exactly as it is.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <TextField
            label="What changed? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            placeholder="e.g. remapped courses → university_courses"
            sx={{ mt: 1 }}
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="caption1">
              If nothing has actually changed, no new version is created and you will be told so.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNoteOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void save(note)} sx={{ textTransform: 'none' }}>
            Save as version {loaded.version + 1}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SaveAsDialog({
  open,
  onClose,
  name,
  setName,
  mappingCount,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  mappingCount: number;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Typography variant="h3Bold">Save as a new configuration</Typography>
        <Typography variant="caption1" sx={{ color: 'neutral.500' }}>
          {mappingCount} table mapping{mappingCount === 1 ? '' : 's'}, plus the current schemas, order
          and run options.
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving || !name.trim()}
          onClick={onSave}
          startIcon={saving ? <CircularProgress size={13} color="inherit" /> : undefined}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
