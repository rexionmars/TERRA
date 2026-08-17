#!/usr/bin/env Rscript
# Figures for the Sentinel-2 baseline 04.00 offset experiment.
#
# Input:  experiments/data/*.csv, written by spectral_response_and_offset.py
# Output: experiments/figures/*.{svg,pdf,tiff}
#
# CORE CONCLUSION THE FIGURE DEFENDS. Reading Sentinel-2 L2A as DN / 10000
# inflates reflectance by 0.1 in every band; applying BOA_ADD_OFFSET restores
# spectra that are physically possible and moves every downstream index.
#
# EVIDENCE CHAIN, one question per panel:
#   a  do the land-cover classes become physically coherent?   (hero)
#   b  is the AOI-wide reading plausible at all?
#   c  what does that do to a normalised index?
#   d  does an independent library agree any better?
#
# Panel a is the hero because Forest Formation is the proof: chlorophyll
# absorption puts blue and red near 0.02, and only the corrected convention
# produces that.

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
  library(dplyr)
  library(readr)
  library(scales)
})

here <- function(...) file.path("experiments", ...)
dir.create(here("figures"), showWarnings = FALSE, recursive = TRUE)

# ---------------------------------------------------------------- theme
# Declared rather than left to the device default, and checked rather than
# assumed: an unavailable family falls back silently, which is how a figure
# reaches a journal in a font nobody chose.
PUB_FONT <- "Arial"
stopifnot(any(systemfonts::system_fonts()$family == PUB_FONT))

theme_set(
  theme_classic(base_size = 6.5, base_family = PUB_FONT) +
    theme(
      axis.line = element_line(linewidth = 0.35, colour = "black"),
      axis.ticks = element_line(linewidth = 0.35, colour = "black"),
      axis.text = element_text(size = 5.8, colour = "black"),
      legend.title = element_text(size = 6.2),
      legend.text = element_text(size = 5.8),
      legend.key.size = unit(3, "mm"),
      strip.text = element_text(size = 6.2, face = "bold"),
      strip.background = element_blank(),
      plot.title = element_text(size = 7, face = "bold"),
      plot.tag = element_text(size = 8, face = "bold"),
      panel.grid = element_blank()
    )
)

save_pub_r <- function(plot, filename, width_mm = 183, height_mm = 120, dpi = 600) {
  w <- width_mm / 25.4
  h <- height_mm / 25.4
  svglite::svglite(paste0(filename, ".svg"), width = w, height = h,
                   system_fonts = list(sans = PUB_FONT))
  print(plot); dev.off()
  grDevices::cairo_pdf(paste0(filename, ".pdf"), width = w, height = h,
                       family = PUB_FONT)
  print(plot); dev.off()
  ragg::agg_tiff(paste0(filename, ".tiff"), width = w, height = h,
                 units = "in", res = dpi)
  print(plot); dev.off()
  # A web copy as well. The TIFF is the archival master and runs to tens of
  # megabytes, which no forum or issue tracker will inline; 200 dpi keeps the
  # 5.8 pt type legible on screen at a size that uploads.
  ragg::agg_png(paste0(filename, ".png"), width = w, height = h,
                units = "in", res = 200)
  print(plot); dev.off()
}

# ------------------------------------------------------------- palette
# The MapBiomas colours are the legend this domain reads, so the hue is kept.
# They are made to fill map polygons, though, and against white the pale ones
# measure 1.1:1 and 1.7:1, which no line can be followed at. Each is darkened
# along its own hue until it clears 3:1, the WCAG floor for a graphical object.
# Recognition survives; legibility is gained.
contrast_on_white <- function(hex) {
  rgb <- col2rgb(hex) / 255
  lin <- ifelse(rgb <= 0.03928, rgb / 12.92, ((rgb + 0.055) / 1.055)^2.4)
  L <- 0.2126 * lin[1] + 0.7152 * lin[2] + 0.0722 * lin[3]
  1.05 / (L + 0.05)
}

darken_to_contrast <- function(hex, target = 3.0) {
  k <- 1.0
  while (contrast_on_white(hex) < target && k > 0.05) {
    k <- k - 0.02
    rgb <- col2rgb(hex) / 255
    hsv_ <- rgb2hsv(col2rgb(hex))
    hex <- hsv(hsv_[1], min(1, hsv_[2] * 1.12), hsv_[3] * 0.98)
  }
  hex
}

legend_tbl <- read_csv(here("data", "class_legend.csv"), show_col_types = FALSE) |>
  rowwise() |>
  mutate(plot_colour = darken_to_contrast(color)) |>
  ungroup()
class_colours <- setNames(legend_tbl$plot_colour, legend_tbl$class_name)
cat("class colours, MapBiomas hue darkened for line legibility:\n")
for (i in seq_len(nrow(legend_tbl))) {
  cat(sprintf("  %-28s %s -> %s (%.2f:1)\n", legend_tbl$class_name[i],
              legend_tbl$color[i], legend_tbl$plot_colour[i],
              contrast_on_white(legend_tbl$plot_colour[i])))
}

CONV <- c("DN / 10000", "offset applied")
conv_f <- function(x) factor(x, levels = CONV)

# ------------------------------------------------------- a. per-class spectra
class_spectra <- read_csv(here("data", "class_spectra.csv"), show_col_types = FALSE) |>
  mutate(convention = conv_f(convention))

pa <- ggplot(class_spectra, aes(wavelength_nm, mean,
                                colour = class_name, fill = class_name)) +
  geom_ribbon(aes(ymin = p05, ymax = p95), alpha = 0.10, colour = NA) +
  geom_line(linewidth = 0.45) +
  geom_point(size = 0.7) +
  facet_wrap(~convention) +
  scale_colour_manual(values = class_colours, name = NULL) +
  scale_fill_manual(values = class_colours, guide = "none") +
  scale_x_continuous(breaks = c(500, 1000, 1500, 2000)) +
  labs(x = "Wavelength (nm)",
       y = "Surface reflectance (dimensionless)",
       title = "Land-cover spectra under both reflectance conventions") +
  theme(legend.position = c(0.99, 0.99), legend.justification = c(1, 1),
        legend.background = element_blank())

# ------------------------------------------------------ b. AOI median spectrum
aoi <- read_csv(here("data", "aoi_spectrum.csv"), show_col_types = FALSE) |>
  mutate(convention = conv_f(convention))

pb <- ggplot(aoi, aes(wavelength_nm, reflectance,
                      colour = convention, shape = convention)) +
  geom_line(linewidth = 0.45) +
  geom_point(size = 1.1) +
  scale_colour_manual(values = c("#8c8c8c", "#1f4e79"), name = NULL) +
  scale_shape_manual(values = c(1, 16), name = NULL) +
  scale_x_continuous(breaks = c(500, 1000, 1500, 2000)) +
  labs(x = "Wavelength (nm)", y = "Reflectance",
       title = "AOI median") +
  theme(legend.position = c(0.98, 0.02), legend.justification = c(1, 0))

# ------------------------------------------------------------------ c. NDVI
ndvi_pairs <- read_csv(here("data", "ndvi_pairs.csv"), show_col_types = FALSE)

# A density representation rather than 20,000 overplotted marks, so the mass of
# the distribution is readable instead of a solid blot.
pc <- ggplot(ndvi_pairs, aes(ndvi_no_offset, ndvi_with_offset)) +
  geom_bin2d(bins = 70) +
  geom_abline(slope = 1, intercept = 0, linewidth = 0.3, colour = "black") +
  scale_fill_gradient(low = "#dbe4ee", high = "#1f4e79", trans = "log10",
                      name = "Pixels", labels = label_number(accuracy = 1)) +
  coord_equal() +
  labs(x = "NDVI from DN / 10000", y = "NDVI with the offset",
       title = "Compression of a normalised index") +
  theme(legend.position = "right", legend.key.width = unit(2, "mm"))

# ------------------------------------------------- d. angle to the library
angles_path <- here("data", "spectral_angles.csv")
pd <- NULL
if (file.exists(angles_path)) {
  angles <- read_csv(angles_path, show_col_types = FALSE) |>
    mutate(convention = conv_f(convention),
           class_name = reorder(class_name, angle_rad))
  pd <- ggplot(angles, aes(angle_rad, class_name,
                           colour = convention, shape = convention)) +
    geom_line(aes(group = class_name), colour = "grey70", linewidth = 0.3) +
    geom_point(size = 1.4) +
    scale_colour_manual(values = c("#8c8c8c", "#1f4e79"), name = NULL) +
    scale_shape_manual(values = c(1, 16), name = NULL) +
    labs(x = "Spectral angle to soybean leaf reference (rad)", y = NULL,
         title = "Agreement with an independent library") +
    theme(legend.position = c(0.98, 0.02), legend.justification = c(1, 0))
}

# ------------------------------------------------------------------- layout
# Hero on top across the full width, three subordinate panels beneath it.
lower <- if (is.null(pd)) pb + pc else pb + pc + pd
fig <- (pa / lower) +
  plot_layout(heights = c(1.15, 1)) +
  plot_annotation(tag_levels = "a")

save_pub_r(fig, here("figures", "offset_evidence"),
           width_mm = 183, height_mm = 130)

cat("\nwritten:\n")
for (ext in c("svg", "pdf", "tiff")) {
  f <- here("figures", paste0("offset_evidence.", ext))
  cat(sprintf("  %s  %.1f KB\n", f, file.size(f) / 1024))
}
