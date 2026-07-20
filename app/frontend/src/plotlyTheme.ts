import type { Layout } from "plotly.js-dist-min";

export const plotColors = {
  bg: "#f8f9fa",
  surface: "#ffffff",
  grid: "#e8eaed",
  text: "#3c4043",
  muted: "#5f6368",
  accent: "#1a73e8",
  success: "#1e8e3e",
  danger: "#d93025",
  warning: "#ea8600",
};

export const basePlotLayout: Partial<Layout> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { family: "Roboto, Google Sans, system-ui, sans-serif", color: plotColors.text, size: 12 },
  margin: { l: 48, r: 24, t: 32, b: 48 },
  hoverlabel: {
    bgcolor: "#ffffff",
    bordercolor: "#dadce0",
    font: { color: "#202124", size: 12 },
  },
};

export const axisStyle = {
  gridcolor: plotColors.grid,
  zerolinecolor: plotColors.grid,
  linecolor: "#dadce0",
  tickcolor: plotColors.muted,
};
