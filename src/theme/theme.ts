import { createTheme } from "@mui/material/styles";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";

declare module "@mui/material/styles" {
  interface Palette {
    neutral: Palette["primary"];
    dark: { primary: string };
    white: { main: string };
  }
  interface PaletteOptions {
    neutral?: PaletteOptions["primary"];
    dark?: { primary: string };
    white?: { main: string };
  }
  interface PaletteColor {
    50?: string;
    100?: string;
    200?: string;
    300?: string;
    400?: string;
    500?: string;
    600?: string;
    700?: string;
    800?: string;
  }
  interface SimplePaletteColorOptions {
    50?: string;
    100?: string;
    200?: string;
    300?: string;
    400?: string;
    500?: string;
    600?: string;
    700?: string;
    800?: string;
  }
  interface TypographyVariants {
    h1Medium: React.CSSProperties;
    h1Bold: React.CSSProperties;
    h2Medium: React.CSSProperties;
    h2Bold: React.CSSProperties;
    h3Medium: React.CSSProperties;
    h3Bold: React.CSSProperties;
    body1Medium: React.CSSProperties;
    body1SemiBold: React.CSSProperties;
    body1Bold: React.CSSProperties;
    body2Medium: React.CSSProperties;
    body2SemiBold: React.CSSProperties;
    body2Bold: React.CSSProperties;
    caption1: React.CSSProperties;
    caption1Medium: React.CSSProperties;
    caption1Bold: React.CSSProperties;
    caption2: React.CSSProperties;
    caption2Bold: React.CSSProperties;
    supportingText: React.CSSProperties;
    supportingTextMedium: React.CSSProperties;
    supportingTextBold: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    h1Medium?: React.CSSProperties;
    h1Bold?: React.CSSProperties;
    h2Medium?: React.CSSProperties;
    h2Bold?: React.CSSProperties;
    h3Medium?: React.CSSProperties;
    h3Bold?: React.CSSProperties;
    body1Medium?: React.CSSProperties;
    body1SemiBold?: React.CSSProperties;
    body1Bold?: React.CSSProperties;
    body2Medium?: React.CSSProperties;
    body2SemiBold?: React.CSSProperties;
    body2Bold?: React.CSSProperties;
    caption1?: React.CSSProperties;
    caption1Medium?: React.CSSProperties;
    caption1Bold?: React.CSSProperties;
    caption2?: React.CSSProperties;
    caption2Bold?: React.CSSProperties;
    supportingText?: React.CSSProperties;
    supportingTextMedium?: React.CSSProperties;
    supportingTextBold?: React.CSSProperties;
  }
}

declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    h1Medium: true;
    h1Bold: true;
    h2Medium: true;
    h2Bold: true;
    h3Medium: true;
    h3Bold: true;
    body1Medium: true;
    body1SemiBold: true;
    body1Bold: true;
    body2Medium: true;
    body2SemiBold: true;
    body2Bold: true;
    caption1: true;
    caption1Medium: true;
    caption1Bold: true;
    caption2: true;
    caption2Bold: true;
    supportingText: true;
    supportingTextMedium: true;
    supportingTextBold: true;
  }
}

const theme = createTheme({
  palette: {
    primary: {
      main: "#2F4157",
      100: "#F4F8FB",
      200: "#E7EEF6",
      300: "#C8D7E6",
      400: "#91A5BC",
      500: "#4C5F77",
      600: "#2F4157",
      700: "#1F2D3E",
      800: "#111A24",
    },
    secondary: {
      main: "#6E3F8A",
      light: "#9A5BC1",
      dark: "#452557",
      100: "#FBF9FD",
      200: "#EFE7F6",
      300: "#D1B8E5",
      400: "#B58AD4",
      500: "#9A5BC1",
      600: "#6E3F8A",
      700: "#452557",
      800: "#1F0E29",
    },
    success: {
      main: "#49B847",
      50: "rgba(73, 184, 71, 0.5)",
      100: "#F3FEF3",
      200: "#CFFCCF",
      300: "#5CE45A",
      400: "#49B847",
      500: "#378E35",
      600: "#256624",
      700: "#154114",
      800: "#062006",
    },
    warning: {
      main: "#FFAD0D",
      50: "rgba(255, 173, 13, 0.5)",
      100: "#FFF7F1",
      200: "#FFE0C6",
      300: "#FFAD0D",
      400: "#CD8A00",
      500: "#9C6800",
      600: "#6E4800",
      700: "#432A00",
      800: "#1C0F00",
    },
    error: {
      main: "#F64C4C",
      50: "rgba(246, 76, 76, 0.5)",
      100: "#FEF2F2",
      200: "#FBCCCC",
      300: "#F89494",
      400: "#F64C4C",
      500: "#C71F1F",
      600: "#891212",
      700: "#4F0606",
      800: "#2B0202",
    },
    info: {
      main: "#3B82F6",
      100: "#FBFBFF",
      200: "#EDF0FE",
      300: "#C4D1FC",
      400: "#8AA9F9",
      500: "#3B82F6",
      600: "#1E5FBD",
      700: "#113E80",
      800: "#052048",
    },
    neutral: {
      main: "#4D535E",
      50: "#00000080",
      100: "#F6F7FA",
      200: "#D5D8DF",
      300: "#B5BAC4",
      400: "#8F96A3",
      500: "#6C7380",
      600: "#4D535E",
      700: "#2E323A",
      800: "#15171A",
    },
    text: {
      secondary: "#4D4D4D",
    },
    dark: {
      primary: "#000000",
    },
    white: {
      main: "#FFFFFF",
    },
    divider: "#D5D8DF",
    action: {
      disabledBackground: "#F6F7FA",
    },
  },
  typography: {
    fontFamily: "'Poppins', Roboto, sans-serif",

    h1: {
      fontSize: "2.25rem",
      fontWeight: 400,
      lineHeight: 1.5,
    },
    h1Medium: {
      fontSize: "2.25rem",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    h1Bold: {
      fontSize: "2.25rem",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    h2: {
      fontSize: "1.5rem",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    h2Medium: {
      fontSize: "1.5rem",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    h2Bold: {
      fontSize: "1.5rem",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    h3: {
      fontSize: "1.25rem",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    h3Medium: {
      fontSize: "1.25rem",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    h3Bold: {
      fontSize: "1.25rem",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    body1: {
      fontSize: "1rem",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body1Medium: {
      fontSize: "1rem",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body1SemiBold: {
      fontSize: "1rem",
      fontWeight: 600,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body1Bold: {
      fontSize: "1rem",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    body2: {
      fontSize: "0.875rem",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body2Medium: {
      fontSize: "0.875rem",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body2SemiBold: {
      fontSize: "0.875rem",
      fontWeight: 600,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    body2Bold: {
      fontSize: "0.875rem",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    caption1: {
      fontSize: "12px",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    caption1Medium: {
      fontSize: "12px",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    caption1Bold: {
      fontSize: "12px",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },

    caption2: {
      fontSize: "12px",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
      fontStyle: "italic",
    },

    caption2Bold: {
      fontSize: "12px",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
      fontStyle: "italic",
    },

    supportingText: {
      fontSize: "10px",
      fontWeight: 400,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    supportingTextMedium: {
      fontSize: "10px",
      fontWeight: 500,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
    supportingTextBold: {
      fontSize: "10px",
      fontWeight: 700,
      lineHeight: 1.5,
      fontFamily: "'Poppins', Roboto, sans-serif",
    },
  },

  components: {
    MuiButton: {},
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "rgba(255, 255, 255, 0.15)",
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "::-webkit-scrollbar": {
          width: "6px",
          height: "6px",
        },
        "::-webkit-scrollbar-track": {
          borderRadius: "12px",
          background: "#F6F7FA", // neutral.100
        },
        "::-webkit-scrollbar-thumb": {
          borderRadius: "12px",
          background: "#B5BAC4", // neutral.300
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: "#8F96A3", // neutral.400
        },
      },
    },
    MuiTypography: {
      defaultProps: {
        variantMapping: {
          h1Bold: "h1",
          h1Medium: "h1",
          h2Bold: "h2",
          h2Medium: "h2",
          h3Medium: "h3",
          h3Bold: "h3",
          body1Medium: "p",
          body1Bold: "p",
          body2Medium: "p",
          body2Bold: "p",
          caption1: "p",
          caption1Medium: "p",
          caption1Bold: "p",
          caption2: "p",
          caption2Bold: "p",
          supportingText: "p",
          supportingTextMedium: "p",
          supportingTextBold: "p",
          body1SemiBold: "p",
          body2SemiBold: "p",
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        root: {
          "& .MuiAutocomplete-inputRoot.Mui-disabled": {
            backgroundColor: "#F6F7FA",
            cursor: "not-allowed",
            "& fieldset": {
              borderColor: "action.disabled",
            },
            "&:hover fieldset": {
              borderColor: "action.disabled",
              cursor: "not-allowed",
            },
          },
          "& .MuiInputBase-input.Mui-disabled": {
            cursor: "not-allowed",
            color: "text.disabled",
            WebkitTextFillColor: "text.disabled",
          },
          "& .MuiInputLabel-root.Mui-disabled": {
            color: "text.disabled",
          },
          "& .MuiFormHelperText-root.Mui-disabled": {
            color: "text.disabled",
          },
          "& .MuiAutocomplete-endAdornment .Mui-disabled": {
            color: "action.disabled",
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          "&.Mui-disabled": {
            backgroundColor: "#F6F7FA",
            cursor: "not-allowed",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "action.disabled",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "action.disabled",
              cursor: "not-allowed",
            },
            "& .MuiSelect-icon": {
              color: "action.disabled",
              cursor: "not-allowed",
            },
          },
          "& .MuiSelect-select.Mui-disabled": {
            cursor: "not-allowed",
            color: "text.disabled",
            WebkitTextFillColor: "text.disabled",
          },
        },
      },
    },
  },
});

export default theme;
