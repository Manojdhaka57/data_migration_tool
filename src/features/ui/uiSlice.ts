import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type ActivePanel = 'source' | 'target' | 'mapping' | 'preview';
type ModalType = 
  | 'addTableMapping' 
  | 'addColumnMapping' 
  | 'editColumnMapping'
  | 'addConstant'
  | 'addTransform'
  | 'importSchema'
  | 'exportConfig'
  | null;

interface UIState {
  activePanel: ActivePanel;
  isPreviewOpen: boolean;
  currentModal: ModalType;
  modalData: Record<string, unknown> | null;
  isDarkMode: boolean;
  showValidationPanel: boolean;
}

const initialState: UIState = {
  activePanel: 'mapping',
  isPreviewOpen: false,
  currentModal: null,
  modalData: null,
  isDarkMode: true,
  showValidationPanel: true,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActivePanel: (state, action: PayloadAction<ActivePanel>) => {
      state.activePanel = action.payload;
    },
    togglePreview: (state) => {
      state.isPreviewOpen = !state.isPreviewOpen;
    },
    setPreviewOpen: (state, action: PayloadAction<boolean>) => {
      state.isPreviewOpen = action.payload;
    },
    openModal: (state, action: PayloadAction<{ 
      type: ModalType; 
      data?: Record<string, unknown>;
    }>) => {
      state.currentModal = action.payload.type;
      state.modalData = action.payload.data ?? null;
    },
    closeModal: (state) => {
      state.currentModal = null;
      state.modalData = null;
    },
    toggleDarkMode: (state) => {
      state.isDarkMode = !state.isDarkMode;
    },
    toggleValidationPanel: (state) => {
      state.showValidationPanel = !state.showValidationPanel;
    },
  },
});

// Selectors
export const selectActivePanel = (state: { ui: UIState }) => state.ui.activePanel;
export const selectIsPreviewOpen = (state: { ui: UIState }) => state.ui.isPreviewOpen;
export const selectCurrentModal = (state: { ui: UIState }) => state.ui.currentModal;
export const selectModalData = (state: { ui: UIState }) => state.ui.modalData;
export const selectIsDarkMode = (state: { ui: UIState }) => state.ui.isDarkMode;
export const selectShowValidationPanel = (state: { ui: UIState }) => state.ui.showValidationPanel;

export const { 
  setActivePanel,
  togglePreview,
  setPreviewOpen,
  openModal,
  closeModal,
  toggleDarkMode,
  toggleValidationPanel,
} = uiSlice.actions;

export default uiSlice.reducer;
