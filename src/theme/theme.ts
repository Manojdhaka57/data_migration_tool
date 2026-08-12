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

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    /** Lavender fill with indigo text — the reference's "Run" button. */
    soft: true;
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
    /**
     * Brand palette: Iguana Green, Blue-Gray, Deep Saffron, Dark Slate Gray,
     * Raisin Black.
     *
     * Two deliberate departures, both about legibility rather than taste:
     *
     *  1. The palette has NO RED, and a failed migration must not look like a
     *     warning. `error` is a harmonised brick red mixed to sit with Deep
     *     Saffron and Dark Slate Gray. It is the only colour here that is not
     *     from the source palette.
     *  2. The brand hexes are used as FILLS (bars, tiles, chips, dots, buttons)
     *     where they are accurate. As small TEXT on white they fail contrast —
     *     #73B682 on white is about 2.2:1 — so each `main` is a darkened
     *     sibling and the exact brand hex lives at the `400` step.
     */
    primary: {
      // Dark Slate Gray #2A4954
      main: "#2A4954",
      light: "#3D6675",
      dark: "#1E353D",
      50: "#F2F6F7",
      100: "#E4EDEF", // soft action background
      200: "#C7DADF",
      300: "#9CBCC6",
      400: "#6494A3",
      500: "#3D6675",
      600: "#2A4954", // brand
      700: "#1E353D",
      800: "#142329",
    },
    secondary: {
      // Blue-Gray #62A8CB lives at 400; darkened for text (5.99:1).
      main: "#2D6079",
      light: "#85BBD9",
      dark: "#2D6079",
      50: "#F2F7FA",
      100: "#E7F1F7",
      200: "#CFE4EF",
      300: "#A8CFE1",
      400: "#62A8CB", // brand
      500: "#3D82A6",
      600: "#2D6079",
      700: "#1F4657",
      800: "#10222C",
      900: "#0A161C",
    },
    success: {
      // Iguana Green #73B682 lives at 400; `main` is darkened so pill and
      // tile text passes AA on the 100 tint (5.64:1).
      main: "#356B43",
      50: "rgba(115, 182, 130, 0.5)",
      100: "#EBF5EE",
      200: "#D3E9DA",
      300: "#A9D4B6",
      400: "#73B682", // brand
      500: "#4E9A61",
      600: "#3E7C4E",
      700: "#2A5636",
      800: "#16291B",
    },
    warning: {
      // Deep Saffron #FF9933 lives at 400; darkened for text (4.50:1).
      main: "#A85C13",
      50: "rgba(255, 153, 51, 0.5)",
      100: "#FFF1E2",
      200: "#FFDFC0",
      300: "#FFC28C",
      400: "#FF9933", // brand
      500: "#D97B1F",
      600: "#A85C13",
      700: "#75400C",
      800: "#3D2105",
      900: "#1F1103",
    },
    error: {
      // NOT from the source palette — see the note above. 5.12:1 on its tint.
      main: "#B03B33",
      50: "rgba(192, 69, 60, 0.5)",
      100: "#FBEAE8",
      200: "#F5CFCB",
      300: "#E5978F",
      400: "#D25F53",
      500: "#C0453C",
      600: "#96332C",
      700: "#6A221D",
      800: "#3A1310",
    },
    info: {
      // Blue-Gray again: the palette has one blue, and info/secondary are
      // never adjacent in this UI.
      main: "#2D6079",
      50: "#F2F7FA",
      100: "#E7F1F7",
      200: "#CFE4EF",
      300: "#A8CFE1",
      400: "#62A8CB", // brand
      500: "#3D82A6",
      600: "#2D6079",
      700: "#1F4657",
      800: "#10222C",
    },
    neutral: {
      // Raisin Black #272626 and a warm grey ramp derived from it.
      main: "#6E6D6B",
      50: "#00000080",
      100: "#F7F7F6", // page background
      200: "#E9E9E7", // card border
      300: "#D2D2CF",
      400: "#767573", // muted label — 4.60:1 on white
      500: "#6E6D6B", // secondary text
      600: "#4F4E4C",
      700: "#3A3938",
      800: "#272626", // Raisin Black — primary text
    },
    text: {
      primary: "#272626",
      secondary: "#6E6D6B",
    },
    dark: {
      primary: "#000000",
    },
    white: {
      main: "#FFFFFF",
    },
    divider: "#E9E9E7",
    action: {
      disabledBackground: "#F7F7F6",
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
    // Surface language from the reference dashboard: white cards, a hairline
    // border rather than a heavy shadow, generous radius. Set here so every
    // unstyled Card/Paper in the app already matches without being touched.
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: "1px solid #E9E9E7",
          boxShadow: "0 1px 2px rgba(39, 38, 38, 0.05)",
          backgroundImage: "none",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        rounded: { borderRadius: 14 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: "none",
          fontWeight: 600,
        },
      },
      variants: [
        {
          // The reference's full-width lavender "Run" button.
          props: { variant: "soft" },
          style: {
            backgroundColor: "#E4EDEF",
            color: "#2A4954",
            "&:hover": { backgroundColor: "#C7DADF" },
            "&.Mui-disabled": { backgroundColor: "#F7F7F6", color: "#9B9A98" },
          },
        },
      ],
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 600 },
        sizeSmall: { height: 24 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600 },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "#E9E9E7",
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
          background: "#F7F7F6", // neutral.100
        },
        "::-webkit-scrollbar-thumb": {
          borderRadius: "12px",
          background: "#D2D2CF", // neutral.300
        },
        "::-webkit-scrollbar-thumb:hover": {
          background: "#9B9A98", // neutral.400
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
